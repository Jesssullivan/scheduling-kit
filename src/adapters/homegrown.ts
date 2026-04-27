/**
 * Homegrown Scheduling Adapter
 *
 * Direct PG-backed scheduling — replaces Acuity browser automation.
 * Implements the full SchedulingAdapter interface (16 methods) using
 * Drizzle ORM queries against Neon PostgreSQL.
 *
 * Feature-flagged: only active when SCHEDULING_BACKEND=homegrown
 */

import { Effect } from 'effect';

import type { SchedulingAdapter } from './types.js';
import type {
  Service,
  Provider,
  TimeSlot,
  AvailableDate,
  Booking,
  BookingRequest,
  SlotReservation,
  ClientInfo,
  SchedulingResult,
  BookingStatus,
  PaymentStatus,
} from '../core/types.js';
import { Errors } from '../core/types.js';
import {
  getAvailableSlots as computeSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  generateConfirmationCode,
  type HoursWindow,
  type HoursOverride,
  type OccupiedBlock,
  type SlotConfig,
} from './availability-engine.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HomegrownAdapterConfig {
  /** Drizzle database instance (lazy, to avoid import-time DB connection). */
  getDb?: () => Promise<any>;
  /**
   * Optional scoped database executor.
   *
   * Consumers with transaction-local RLS, tenant pinning, or connection
   * middleware should provide this instead of exposing a raw database handle.
   * The callback receives a Drizzle database/transaction object and the adapter
   * awaits the callback result before leaving the scope.
   */
  withDb?: <T>(fn: (db: any) => Promise<T>) => Promise<T>;
  /** Timezone for availability calculations */
  timezone?: string;
  /** Slot interval in minutes */
  slotInterval?: number;
  /** Buffer between appointments in minutes */
  bufferMinutes?: number;
  /** Minimum advance booking hours */
  minAdvanceHours?: number;
  /** Default practitioner handle (solo practice) */
  defaultPractitionerHandle?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createHomegrownAdapter = (config: HomegrownAdapterConfig): SchedulingAdapter => {
  const tz = config.timezone ?? 'America/New_York';
  const interval = config.slotInterval ?? 30;
  const buffer = config.bufferMinutes ?? 0;
  const minAdvance = config.minAdvanceHours ?? 2;
  const practitionerHandle = config.defaultPractitionerHandle ?? 'jen';

  const withDb = async <T>(fn: (db: any) => Promise<T>): Promise<T> => {
    if (config.withDb) return config.withDb(fn);
    if (!config.getDb) {
      throw new Error('HomegrownAdapter requires either getDb or withDb');
    }
    return fn(await config.getDb());
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Wrap an async operation in Effect */
  const fromAsync = <A>(fn: () => Promise<A>): SchedulingResult<A> =>
    Effect.tryPromise({
      try: fn,
      catch: (e) =>
        Errors.infrastructure(
          'UNKNOWN',
          e instanceof Error ? e.message : 'Unknown error',
          e instanceof Error ? e : undefined,
        ),
    });

  /** Resolve a service by UUID or acuityId */
  const resolveService = async (serviceId: string): Promise<any> => {
    const { services: servicesTable } = await import(
      '@tummycrypt/tinyland-auth-pg/content-schema'
    );
    const { eq, or } = await import('drizzle-orm');

    // UUID regex — only compare against UUID column if input looks like one
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId);

    const condition = isUuid
      ? or(eq(servicesTable.id, serviceId), eq(servicesTable.acuityId, serviceId))
      : eq(servicesTable.acuityId, serviceId);

    return withDb(async (d) => {
      const [row] = await d
        .select()
        .from(servicesTable)
        .where(condition)
        .limit(1);

      return row ?? null;
    });
  };

  /** Load business hours as a Map<dayOfWeek, HoursWindow> */
  const loadHoursMap = async (): Promise<Map<number, HoursWindow>> => {
    const { businessHours } = await import('@tummycrypt/tinyland-auth-pg/content-schema');
    const { asc } = await import('drizzle-orm');
    return withDb(async (d) => {
      const rows = await d.select().from(businessHours).orderBy(asc(businessHours.dayOfWeek));
      const map = new Map<number, HoursWindow>();
      for (const row of rows) {
        map.set(row.dayOfWeek, { opens: row.opens, closes: row.closes });
      }
      return map;
    });
  };

  /** Load overrides for a date range */
  const loadOverrides = async (startDate: string, endDate: string): Promise<HoursOverride[]> => {
    const { businessHoursOverrides } = await import('@tummycrypt/tinyland-auth-pg/booking-schema');
    const { gte, lte, and } = await import('drizzle-orm');
    return withDb(async (d) => {
      const rows = await d
        .select()
        .from(businessHoursOverrides)
        .where(
          and(
            gte(businessHoursOverrides.date, startDate),
            lte(businessHoursOverrides.date, endDate),
          ),
        );
      return rows.map((r: any) => ({
        date: r.date,
        opens: r.opens,
        closes: r.closes,
      }));
    });
  };

  /** Load occupied blocks (bookings + time_blocks + active reservations) for a date range */
  const loadOccupied = async (startDate: string, endDate: string): Promise<OccupiedBlock[]> => {
    const { bookings: bookingsTable, timeBlocks, slotReservations } = await import(
      '@tummycrypt/tinyland-auth-pg/booking-schema'
    );
    const { gte, lte, and, ne, isNull, or, gt } = await import('drizzle-orm');

    const startIso = `${startDate}T00:00:00Z`;
    const endIso = `${endDate}T23:59:59Z`;

    return withDb(async (d) => {
      // Active bookings (not cancelled)
      const bookingRows = await d
        .select({ datetime: bookingsTable.datetime, endTime: bookingsTable.endTime })
        .from(bookingsTable)
        .where(
          and(
            gte(bookingsTable.datetime, startIso),
            lte(bookingsTable.datetime, endIso),
            ne(bookingsTable.status, 'cancelled'),
          ),
        );

      // Time blocks
      const blockRows = await d
        .select({ startTime: timeBlocks.startTime, endTime: timeBlocks.endTime })
        .from(timeBlocks)
        .where(
          and(
            gte(timeBlocks.startTime, startIso),
            lte(timeBlocks.startTime, endIso),
          ),
        );

      // Active reservations (not expired, not released)
      const reservationRows = await d
        .select({
          datetime: slotReservations.datetime,
          duration: slotReservations.duration,
        })
        .from(slotReservations)
        .where(
          and(
            gte(slotReservations.datetime, startIso),
            lte(slotReservations.datetime, endIso),
            gt(slotReservations.expiresAt, new Date().toISOString()),
            isNull(slotReservations.releasedAt),
          ),
        );

      const occupied: OccupiedBlock[] = [];

      for (const r of bookingRows) {
        occupied.push({ start: new Date(r.datetime), end: new Date(r.endTime) });
      }
      for (const r of blockRows) {
        occupied.push({ start: new Date(r.startTime), end: new Date(r.endTime) });
      }
      for (const r of reservationRows) {
        const start = new Date(r.datetime);
        occupied.push({
          start,
          end: new Date(start.getTime() + r.duration * 60_000),
        });
      }

      return occupied;
    });
  };

  /** Get the default practitioner */
  const getDefaultPractitioner = async (): Promise<any> => {
    const { practitioners } = await import('@tummycrypt/tinyland-auth-pg/content-schema');
    const { eq } = await import('drizzle-orm');
    return withDb(async (d) => {
      const [row] = await d
        .select()
        .from(practitioners)
        .where(eq(practitioners.handle, practitionerHandle))
        .limit(1);
      return row ?? null;
    });
  };

  // ---------------------------------------------------------------------------
  // SchedulingAdapter implementation
  // ---------------------------------------------------------------------------

  const adapter: SchedulingAdapter = {
    name: 'homegrown',

    // --- Services ---

    getServices: () =>
      fromAsync(async () => {
        const { services: servicesTable } = await import(
          '@tummycrypt/tinyland-auth-pg/content-schema'
        );
        const { asc, eq } = await import('drizzle-orm');
        const rows = await withDb<any[]>((d) =>
          d
            .select()
            .from(servicesTable)
            .where(eq(servicesTable.active, true))
            .orderBy(asc(servicesTable.displayOrder)),
        );

        return rows.map(
          (r: any): Service => ({
            id: r.id,
            name: r.name,
            description: r.description ?? undefined,
            duration: r.durationMinutes,
            price: r.priceCents,
            currency: r.currency,
            category: r.category ?? undefined,
            active: r.active,
          }),
        );
      }),

    getService: (serviceId: string) =>
      fromAsync(async () => {
        const row = await resolveService(serviceId);
        if (!row) throw new Error(`Service ${serviceId} not found`);

        return {
          id: row.id,
          name: row.name,
          description: row.description ?? undefined,
          duration: row.durationMinutes,
          price: row.priceCents,
          currency: row.currency,
          category: row.category ?? undefined,
          active: row.active,
        } satisfies Service;
      }),

    // --- Providers ---

    getProviders: () =>
      fromAsync(async () => {
        const prac = await getDefaultPractitioner();
        if (!prac) return [];
        return [
          {
            id: prac.id,
            name: prac.name,
            email: undefined,
            description: prac.title ?? undefined,
            image: prac.photoUrl ?? undefined,
            timezone: tz,
          } satisfies Provider,
        ];
      }),

    getProvider: (providerId: string) =>
      fromAsync(async () => {
        const { practitioners } = await import(
          '@tummycrypt/tinyland-auth-pg/content-schema'
        );
        const { eq } = await import('drizzle-orm');
        const [row] = await withDb<any[]>((d) =>
          d
            .select()
            .from(practitioners)
            .where(eq(practitioners.id, providerId))
            .limit(1),
        );

        if (!row) throw new Error(`Provider ${providerId} not found`);

        return {
          id: row.id,
          name: row.name,
          email: undefined,
          description: row.title ?? undefined,
          image: row.photoUrl ?? undefined,
          timezone: tz,
        } satisfies Provider;
      }),

    getProvidersForService: (_serviceId: string) =>
      // Solo practice — same as getProviders
      adapter.getProviders(),

    // --- Availability ---

    getAvailableDates: (params) =>
      fromAsync(async () => {
        const hoursMap = await loadHoursMap();
        const overrides = await loadOverrides(params.startDate, params.endDate);
        const occupied = await loadOccupied(params.startDate, params.endDate);

        const svc = await resolveService(params.serviceId);
        if (!svc) throw new Error(`Service ${params.serviceId} not found`);

        const slotConfig: SlotConfig = {
          duration: svc.durationMinutes,
          interval,
          buffer,
          minAdvanceHours: minAdvance,
          timezone: tz,
        };

        return getDatesWithAvailability(
          params.startDate,
          params.endDate,
          hoursMap,
          overrides,
          occupied,
          slotConfig,
        ).map(
          (r): AvailableDate => ({
            date: r.date,
            slots: r.slots,
          }),
        );
      }),

    getAvailableSlots: (params) =>
      fromAsync(async () => {
        const hoursMap = await loadHoursMap();
        const dayOfWeek = new Date(params.date + 'T12:00:00Z').getDay();
        const dayHours = hoursMap.get(dayOfWeek) ?? null;
        const overrides = await loadOverrides(params.date, params.date);
        const override = overrides[0] ?? null;
        const occupied = await loadOccupied(params.date, params.date);

        const svc = await resolveService(params.serviceId);
        if (!svc) throw new Error(`Service ${params.serviceId} not found`);

        const slotConfig: SlotConfig = {
          duration: svc.durationMinutes,
          interval,
          buffer,
          minAdvanceHours: minAdvance,
          timezone: tz,
        };

        const slots = computeSlots(params.date, dayHours, override, occupied, slotConfig);

        return slots.map(
          (s): TimeSlot => ({
            datetime: s.datetime,
            available: true,
            providerId: params.providerId,
          }),
        );
      }),

    checkSlotAvailability: (params) =>
      fromAsync(async () => {
        const date = params.datetime.slice(0, 10);
        const hoursMap = await loadHoursMap();
        const dayOfWeek = new Date(date + 'T12:00:00Z').getDay();
        const dayHours = hoursMap.get(dayOfWeek) ?? null;
        const overrides = await loadOverrides(date, date);
        const override = overrides[0] ?? null;
        const occupied = await loadOccupied(date, date);

        const svc = await resolveService(params.serviceId);
        if (!svc) throw new Error(`Service ${params.serviceId} not found`);

        return isSlotAvailable(
          params.datetime,
          dayHours,
          override,
          occupied,
          {
            duration: svc.durationMinutes,
            interval,
            buffer,
            minAdvanceHours: minAdvance,
            timezone: tz,
          },
        );
      }),

    // --- Reservations ---

    createReservation: (params) =>
      fromAsync(async () => {
        const { slotReservations } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const expirationMinutes = params.expirationMinutes ?? 10;
        const expiresAt = new Date(
          Date.now() + expirationMinutes * 60_000,
        ).toISOString();

        const [row] = await withDb<any[]>((d) =>
          d
            .insert(slotReservations)
            .values({
              datetime: params.datetime,
              duration: params.duration,
              expiresAt,
            })
            .returning(),
        );

        return {
          id: row.id,
          datetime: row.datetime,
          duration: row.duration,
          expiresAt: row.expiresAt,
          providerId: params.providerId,
        } satisfies SlotReservation;
      }),

    releaseReservation: (reservationId: string) =>
      fromAsync(async () => {
        const { slotReservations } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { eq } = await import('drizzle-orm');
        await withDb((d) =>
          d
            .update(slotReservations)
            .set({ releasedAt: new Date().toISOString() })
            .where(eq(slotReservations.id, reservationId)),
        );
      }),

    // --- Bookings ---

    createBooking: (request: BookingRequest) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );

        // Resolve service (by UUID or acuityId)
        const svc = await resolveService(request.serviceId);
        if (!svc) throw new Error(`Service ${request.serviceId} not found`);

        // Find or create client
        const clientResult = await Effect.runPromise(adapter.findOrCreateClient(request.client));
        const clientId = clientResult.id;

        // Get practitioner
        const prac = await getDefaultPractitioner();

        const startDt = new Date(request.datetime);
        const endDt = new Date(startDt.getTime() + svc.durationMinutes * 60_000);
        const confirmationCode = generateConfirmationCode();

        const [row] = await withDb<any[]>((d) =>
          d
            .insert(bookingsTable)
            .values({
              confirmationCode,
              serviceId: svc.id,
              practitionerId: prac?.id,
              clientId,
              datetime: startDt.toISOString(),
              endTime: endDt.toISOString(),
              duration: svc.durationMinutes,
              status: 'confirmed',
              paymentStatus: 'pending',
              paymentMethod: request.paymentMethod ?? null,
              amountCents: svc.priceCents,
              idempotencyKey: request.idempotencyKey,
            })
            .returning(),
        );

        return {
          id: row.id,
          serviceId: svc.id,
          serviceName: svc.name,
          providerId: prac?.id,
          providerName: prac?.name,
          datetime: row.datetime,
          endTime: row.endTime,
          duration: row.duration,
          price: row.amountCents,
          currency: svc.currency,
          client: request.client,
          status: row.status as BookingStatus,
          confirmationCode: row.confirmationCode,
          paymentStatus: row.paymentStatus as PaymentStatus,
          createdAt: row.createdAt,
        } satisfies Booking;
      }),

    createBookingWithPaymentRef: (
      request: BookingRequest,
      paymentRef: string,
      paymentProcessor: string,
    ) =>
      Effect.flatMap(
        adapter.createBooking(request),
        (booking) =>
          fromAsync(async () => {
            const { bookings: bookingsTable } = await import(
              '@tummycrypt/tinyland-auth-pg/booking-schema'
            );
            const { eq } = await import('drizzle-orm');

            await withDb((d) =>
              d
                .update(bookingsTable)
                .set({
                  paymentRef,
                  paymentMethod: paymentProcessor,
                  paymentStatus: 'paid',
                })
                .where(eq(bookingsTable.id, booking.id)),
            );

            return {
              ...booking,
              paymentRef,
              paymentStatus: 'paid' as const,
            };
          }),
      ),

    getBooking: (bookingId: string) =>
      fromAsync(async () => {
        const { bookings: bookingsTable, clients: clientsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { services: servicesTable, practitioners } = await import(
          '@tummycrypt/tinyland-auth-pg/content-schema'
        );
        const { eq } = await import('drizzle-orm');
        return withDb(async (d) => {
          const [row] = await d
            .select()
            .from(bookingsTable)
            .where(eq(bookingsTable.id, bookingId))
            .limit(1);

          if (!row) throw new Error(`Booking ${bookingId} not found`);

          // Load related data
          const [svc] = await d
            .select()
            .from(servicesTable)
            .where(eq(servicesTable.id, row.serviceId))
            .limit(1);

          const [client] = await d
            .select()
            .from(clientsTable)
            .where(eq(clientsTable.id, row.clientId))
            .limit(1);

          let providerName: string | undefined;
          if (row.practitionerId) {
            const [prac] = await d
              .select()
              .from(practitioners)
              .where(eq(practitioners.id, row.practitionerId))
              .limit(1);
            providerName = prac?.name;
          }

          return {
            id: row.id,
            serviceId: row.serviceId,
            serviceName: svc?.name ?? 'Unknown',
            providerId: row.practitionerId ?? undefined,
            providerName,
            datetime: row.datetime,
            endTime: row.endTime,
            duration: row.duration,
            price: row.amountCents,
            currency: svc?.currency ?? 'USD',
            client: {
              firstName: client?.firstName ?? '',
              lastName: client?.lastName ?? '',
              email: client?.email ?? '',
              phone: client?.phone ?? undefined,
            },
            status: row.status as BookingStatus,
            confirmationCode: row.confirmationCode,
            paymentStatus: row.paymentStatus as PaymentStatus,
            paymentRef: row.paymentRef ?? undefined,
            createdAt: row.createdAt,
          } satisfies Booking;
        });
      }),

    cancelBooking: (bookingId: string, reason?: string) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { eq } = await import('drizzle-orm');

        await withDb((d) =>
          d
            .update(bookingsTable)
            .set({
              status: 'cancelled',
              cancelledAt: new Date().toISOString(),
              cancelReason: reason ?? null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(bookingsTable.id, bookingId)),
        );
      }),

    rescheduleBooking: (bookingId: string, newDatetime: string) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { eq } = await import('drizzle-orm');

        const existing = await withDb(async (d) => {
          const [row] = await d
            .select()
            .from(bookingsTable)
            .where(eq(bookingsTable.id, bookingId))
            .limit(1);
          return row ?? null;
        });

        if (!existing) throw new Error(`Booking ${bookingId} not found`);

        const newStart = new Date(newDatetime);
        const newEnd = new Date(newStart.getTime() + existing.duration * 60_000);

        await withDb((d) =>
          d
            .update(bookingsTable)
            .set({
              datetime: newStart.toISOString(),
              endTime: newEnd.toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(bookingsTable.id, bookingId)),
        );

        // Return updated booking
        return await Effect.runPromise(adapter.getBooking(bookingId));
      }),

    // --- Clients ---

    findOrCreateClient: (client: ClientInfo) =>
      fromAsync(async () => {
        const { clients: clientsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { eq } = await import('drizzle-orm');
        return withDb(async (d) => {
          // Try to find existing
          const [existing] = await d
            .select()
            .from(clientsTable)
            .where(eq(clientsTable.email, client.email))
            .limit(1);

          if (existing) {
            // Update name/phone if changed
            await d
              .update(clientsTable)
              .set({
                firstName: client.firstName,
                lastName: client.lastName,
                phone: client.phone ?? existing.phone,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(clientsTable.id, existing.id));

            return { id: existing.id, isNew: false };
          }

          // Create new
          const [row] = await d
            .insert(clientsTable)
            .values({
              firstName: client.firstName,
              lastName: client.lastName,
              email: client.email,
              phone: client.phone ?? null,
              notes: client.notes ?? null,
              customFields: client.customFields ?? {},
            })
            .returning();

          return { id: row.id, isNew: true };
        });
      }),

    getClientByEmail: (email: string) =>
      fromAsync(async () => {
        const { clients: clientsTable } = await import(
          '@tummycrypt/tinyland-auth-pg/booking-schema'
        );
        const { eq } = await import('drizzle-orm');
        const [row] = await withDb<any[]>((d) =>
          d
            .select()
            .from(clientsTable)
            .where(eq(clientsTable.email, email))
            .limit(1),
        );

        if (!row) return null;

        return {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone ?? undefined,
          notes: row.notes ?? undefined,
        } satisfies ClientInfo;
      }),
  };

  return adapter;
};
