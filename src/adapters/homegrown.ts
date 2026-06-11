/**
 * Homegrown Scheduling Adapter
 *
 * Direct PG-backed scheduling — replaces Acuity browser automation.
 * Implements the full SchedulingAdapter interface (16 methods) using
 * Drizzle ORM queries against Neon PostgreSQL.
 *
 * Feature-flagged: only active when SCHEDULING_BACKEND=homegrown
 */

import { Effect } from "effect";

import type { SchedulingAdapter } from "./types.js";
import type {
  Service,
  Provider,
  TimeSlot,
  AvailableDate,
  Booking,
  BookingRequest,
  SlotSoftHold,
  ClientInfo,
  SchedulingResult,
  SchedulingError,
  BookingStatus,
  PaymentStatus,
} from "../core/types.js";
import { Errors } from "../core/types.js";
import {
  getAvailableSlots as computeSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  generateConfirmationCode,
  type HoursWindow,
  type HoursOverride,
  type OccupiedBlock,
  type SlotConfig,
} from "./availability-engine.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HomegrownContentSchemaTables {
  services: any;
  practitioners: any;
  businessHours: any;
}

export interface HomegrownBookingSchemaTables {
  bookings: any;
  timeBlocks: any;
  slotReservations: any;
  clients: any;
  businessHoursOverrides: any;
}

export interface HomegrownAdapterSchemas {
  content: HomegrownContentSchemaTables;
  booking: HomegrownBookingSchemaTables;
}

export type HomegrownAdapterSchemaProvider =
  | HomegrownAdapterSchemas
  | (() => Promise<HomegrownAdapterSchemas>);

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
  /**
   * Drizzle table modules used by the homegrown scheduling backend.
   *
   * Pass this to keep scheduling-kit independent from any specific schema
   * package. If omitted, the adapter falls back to the legacy
   * @tummycrypt/tinyland-auth-pg schema exports for existing adopters.
   */
  schemas?: HomegrownAdapterSchemaProvider;
  /** Timezone for availability calculations */
  timezone?: string;
  /** Slot interval in minutes */
  slotInterval?: number;
  /** Buffer between appointments in minutes */
  bufferMinutes?: number;
  /** Minimum advance booking hours */
  minAdvanceHours?: number;
  /**
   * Default practitioner handle (solo practice).
   *
   * There is no built-in fallback: operations that resolve the default
   * practitioner (getProviders, getProvidersForService, createBooking) fail
   * with a typed ValidationError when this is not configured.
   */
  defaultPractitionerHandle?: string;
  /**
   * Prefix for generated booking confirmation codes (e.g. "BK" → "BK-X7K2P9").
   * Defaults to the neutral "BK". Adopters with established prefixes must set
   * this explicitly (consumer-visible change for upgraders).
   */
  confirmationCodePrefix?: string;
}

// ---------------------------------------------------------------------------
// Internal typed-error carrier
// ---------------------------------------------------------------------------

/**
 * Internal carrier that smuggles a typed SchedulingError through async
 * throw/catch boundaries so `fromAsync` can surface it as-is instead of
 * collapsing every failure to InfrastructureError("UNKNOWN").
 */
class DomainErrorCarrier extends Error {
  readonly schedulingError: SchedulingError;

  constructor(schedulingError: SchedulingError) {
    super(
      "message" in schedulingError
        ? schedulingError.message
        : schedulingError._tag,
    );
    this.name = "DomainErrorCarrier";
    this.schedulingError = schedulingError;
  }
}

/** Throw a typed domain failure (caught and unwrapped by fromAsync). */
const domainError = (error: SchedulingError): never => {
  throw new DomainErrorCarrier(error);
};

/**
 * Best-effort detection of a PostgreSQL unique-violation (SQLSTATE 23505).
 * Drivers differ in where they expose the code, so check error, error.cause,
 * and the message text.
 */
const isUniqueViolation = (e: unknown): boolean => {
  if (e === null || typeof e !== "object") return false;
  const err = e as { code?: unknown; cause?: unknown; message?: unknown };
  if (err.code === "23505") return true;
  const cause = err.cause as { code?: unknown } | undefined;
  if (cause && cause.code === "23505") return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /duplicate key|unique constraint|unique violation/i.test(message);
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createHomegrownAdapter = (
  config: HomegrownAdapterConfig,
): SchedulingAdapter => {
  if (!config.getDb && !config.withDb) {
    throw new Error("HomegrownAdapter requires either getDb or withDb");
  }

  const tz = config.timezone ?? "America/New_York";
  const interval = config.slotInterval ?? 30;
  const buffer = config.bufferMinutes ?? 0;
  const minAdvance = config.minAdvanceHours ?? 2;
  const practitionerHandle = config.defaultPractitionerHandle;
  const confirmationCodePrefix = config.confirmationCodePrefix;
  let legacySchemasPromise: Promise<HomegrownAdapterSchemas> | undefined;

  const withDb = async <T>(fn: (db: any) => Promise<T>): Promise<T> => {
    if (config.withDb) return config.withDb(fn);
    return fn(await config.getDb!());
  };

  const loadLegacyAuthPgSchemas =
    async (): Promise<HomegrownAdapterSchemas> => {
      const importOptional = (specifier: string): Promise<any> =>
        import(specifier);

      try {
        const [content, booking] = await Promise.all([
          importOptional("@tummycrypt/tinyland-auth-pg/content-schema"),
          importOptional("@tummycrypt/tinyland-auth-pg/booking-schema"),
        ]);

        return {
          content: {
            services: content.services,
            practitioners: content.practitioners,
            businessHours: content.businessHours,
          },
          booking: {
            bookings: booking.bookings,
            timeBlocks: booking.timeBlocks,
            slotReservations: booking.slotReservations,
            clients: booking.clients,
            businessHoursOverrides: booking.businessHoursOverrides,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `HomegrownAdapter could not load legacy @tummycrypt/tinyland-auth-pg schemas. Pass config.schemas to use a dedicated schema package. Cause: ${message}`,
        );
      }
    };

  const loadSchemas = async (): Promise<HomegrownAdapterSchemas> => {
    if (typeof config.schemas === "function") {
      return config.schemas();
    }
    if (config.schemas) {
      return config.schemas;
    }

    legacySchemasPromise ??= loadLegacyAuthPgSchemas();
    return legacySchemasPromise;
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrap an async operation in Effect.
   *
   * Known domain failures thrown via `domainError` surface as their typed
   * SchedulingError variants; everything else stays mapped to
   * InfrastructureError("UNKNOWN").
   */
  const fromAsync = <A>(fn: () => Promise<A>): SchedulingResult<A> =>
    Effect.tryPromise({
      try: fn,
      catch: (e) => {
        if (e instanceof DomainErrorCarrier) return e.schedulingError;
        return Errors.infrastructure(
          "UNKNOWN",
          e instanceof Error ? e.message : "Unknown error",
          e instanceof Error ? e : undefined,
        );
      },
    });

  /** Resolve a service by UUID or acuityId */
  const resolveService = async (serviceId: string): Promise<any> => {
    const { services: servicesTable } = (await loadSchemas()).content;
    const { eq, or } = await import("drizzle-orm");

    // UUID regex — only compare against UUID column if input looks like one
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        serviceId,
      );

    const condition = isUuid
      ? or(
          eq(servicesTable.id, serviceId),
          eq(servicesTable.acuityId, serviceId),
        )
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
    const { businessHours } = (await loadSchemas()).content;
    const { asc } = await import("drizzle-orm");
    return withDb(async (d) => {
      const rows = await d
        .select()
        .from(businessHours)
        .orderBy(asc(businessHours.dayOfWeek));
      const map = new Map<number, HoursWindow>();
      for (const row of rows) {
        map.set(row.dayOfWeek, { opens: row.opens, closes: row.closes });
      }
      return map;
    });
  };

  /** Load overrides for a date range */
  const loadOverrides = async (
    startDate: string,
    endDate: string,
  ): Promise<HoursOverride[]> => {
    const { businessHoursOverrides } = (await loadSchemas()).booking;
    const { gte, lte, and } = await import("drizzle-orm");
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
  const loadOccupied = async (
    startDate: string,
    endDate: string,
  ): Promise<OccupiedBlock[]> => {
    const {
      bookings: bookingsTable,
      timeBlocks,
      slotReservations,
    } = (await loadSchemas()).booking;
    const { gte, lte, and, ne, isNull, or, gt } = await import("drizzle-orm");

    const startIso = `${startDate}T00:00:00Z`;
    const endIso = `${endDate}T23:59:59Z`;

    return withDb(async (d) => {
      // Active bookings (not cancelled)
      const bookingRows = await d
        .select({
          datetime: bookingsTable.datetime,
          endTime: bookingsTable.endTime,
        })
        .from(bookingsTable)
        .where(
          and(
            gte(bookingsTable.datetime, startIso),
            lte(bookingsTable.datetime, endIso),
            ne(bookingsTable.status, "cancelled"),
          ),
        );

      // Time blocks
      const blockRows = await d
        .select({
          startTime: timeBlocks.startTime,
          endTime: timeBlocks.endTime,
        })
        .from(timeBlocks)
        .where(
          and(
            gte(timeBlocks.startTime, startIso),
            lte(timeBlocks.startTime, endIso),
          ),
        );

      // Active soft holds (not expired, not released)
      const softHoldRows = await d
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
        occupied.push({
          start: new Date(r.datetime),
          end: new Date(r.endTime),
        });
      }
      for (const r of blockRows) {
        occupied.push({
          start: new Date(r.startTime),
          end: new Date(r.endTime),
        });
      }
      for (const r of softHoldRows) {
        const start = new Date(r.datetime);
        occupied.push({
          start,
          end: new Date(start.getTime() + r.duration * 60_000),
        });
      }

      return occupied;
    });
  };

  /** Get the default practitioner (requires defaultPractitionerHandle). */
  const getDefaultPractitioner = async (): Promise<any> => {
    if (!practitionerHandle) {
      return domainError(
        Errors.validation(
          "defaultPractitionerHandle",
          "No default practitioner handle configured. Set HomegrownAdapterConfig.defaultPractitionerHandle to the handle of your practice's default practitioner.",
        ),
      );
    }
    const { practitioners } = (await loadSchemas()).content;
    const { eq } = await import("drizzle-orm");
    return withDb(async (d) => {
      const [row] = await d
        .select()
        .from(practitioners)
        .where(eq(practitioners.handle, practitionerHandle))
        .limit(1);
      return row ?? null;
    });
  };

  const loadBookingById = async (
    d: any,
    bookingId: string,
  ): Promise<Booking> => {
    const { content, booking } = await loadSchemas();
    const { bookings: bookingsTable, clients: clientsTable } = booking;
    const { services: servicesTable, practitioners } = content;
    const { eq } = await import("drizzle-orm");

    const [row] = await d
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);

    if (!row) {
      return domainError(
        Errors.validation(
          "bookingId",
          `Booking ${bookingId} not found`,
          bookingId,
        ),
      );
    }

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
      serviceName: svc?.name ?? "Unknown",
      providerId: row.practitionerId ?? undefined,
      providerName,
      datetime: row.datetime,
      endTime: row.endTime,
      duration: row.duration,
      price: row.amountCents,
      currency: svc?.currency ?? "USD",
      client: {
        firstName: client?.firstName ?? "",
        lastName: client?.lastName ?? "",
        email: client?.email ?? "",
        phone: client?.phone ?? undefined,
      },
      status: row.status as BookingStatus,
      confirmationCode: row.confirmationCode,
      paymentStatus: row.paymentStatus as PaymentStatus,
      paymentRef: row.paymentRef ?? undefined,
      createdAt: row.createdAt,
    } satisfies Booking;
  };

  // ---------------------------------------------------------------------------
  // SchedulingAdapter implementation
  // ---------------------------------------------------------------------------

  const adapter: SchedulingAdapter = {
    name: "homegrown",

    // --- Services ---

    getServices: () =>
      fromAsync(async () => {
        const { services: servicesTable } = (await loadSchemas()).content;
        const { asc, eq } = await import("drizzle-orm");
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
        if (!row) {
          return domainError(
            Errors.validation(
              "serviceId",
              `Service ${serviceId} not found`,
              serviceId,
            ),
          );
        }

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
        const { practitioners } = (await loadSchemas()).content;
        const { eq } = await import("drizzle-orm");
        const [row] = await withDb<any[]>((d) =>
          d
            .select()
            .from(practitioners)
            .where(eq(practitioners.id, providerId))
            .limit(1),
        );

        if (!row) {
          return domainError(
            Errors.validation(
              "providerId",
              `Provider ${providerId} not found`,
              providerId,
            ),
          );
        }

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
        if (!svc) {
          return domainError(
            Errors.validation(
              "serviceId",
              `Service ${params.serviceId} not found`,
              params.serviceId,
            ),
          );
        }

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
        const dayOfWeek = new Date(params.date + "T12:00:00Z").getDay();
        const dayHours = hoursMap.get(dayOfWeek) ?? null;
        const overrides = await loadOverrides(params.date, params.date);
        const override = overrides[0] ?? null;
        const occupied = await loadOccupied(params.date, params.date);

        const svc = await resolveService(params.serviceId);
        if (!svc) {
          return domainError(
            Errors.validation(
              "serviceId",
              `Service ${params.serviceId} not found`,
              params.serviceId,
            ),
          );
        }

        const slotConfig: SlotConfig = {
          duration: svc.durationMinutes,
          interval,
          buffer,
          minAdvanceHours: minAdvance,
          timezone: tz,
        };

        const slots = computeSlots(
          params.date,
          dayHours,
          override,
          occupied,
          slotConfig,
        );

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
        const dayOfWeek = new Date(date + "T12:00:00Z").getDay();
        const dayHours = hoursMap.get(dayOfWeek) ?? null;
        const overrides = await loadOverrides(date, date);
        const override = overrides[0] ?? null;
        const occupied = await loadOccupied(date, date);

        const svc = await resolveService(params.serviceId);
        if (!svc) {
          return domainError(
            Errors.validation(
              "serviceId",
              `Service ${params.serviceId} not found`,
              params.serviceId,
            ),
          );
        }

        return isSlotAvailable(params.datetime, dayHours, override, occupied, {
          duration: svc.durationMinutes,
          interval,
          buffer,
          minAdvanceHours: minAdvance,
          timezone: tz,
        });
      }),

    // --- Advisory soft holds ---

    softHoldSlot: (params) =>
      fromAsync(async () => {
        const { slotReservations } = (await loadSchemas()).booking;
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
        } satisfies SlotSoftHold;
      }),

    releaseSoftHold: (softHoldId: string) =>
      fromAsync(async () => {
        const { slotReservations } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");
        await withDb((d) =>
          d
            .update(slotReservations)
            .set({ releasedAt: new Date().toISOString() })
            .where(eq(slotReservations.id, softHoldId)),
        );
      }),

    // --- Bookings ---

    createBooking: (request: BookingRequest) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");

        /**
         * Look up an existing booking by idempotency key inside the scoped
         * executor and return the fully mapped Booking on hit.
         */
        const findByIdempotencyKey = (): Promise<Booking | null> =>
          withDb(async (d) => {
            const [existing] = await d
              .select()
              .from(bookingsTable)
              .where(eq(bookingsTable.idempotencyKey, request.idempotencyKey))
              .limit(1);
            return existing ? loadBookingById(d, existing.id) : null;
          });

        // Idempotent replay: a duplicate submit with the same key returns the
        // original booking instead of inserting a second row.
        if (request.idempotencyKey) {
          const replay = await findByIdempotencyKey();
          if (replay) return replay;
        }

        // Resolve service (by UUID or acuityId)
        const svc = await resolveService(request.serviceId);
        if (!svc) {
          return domainError(
            Errors.validation(
              "serviceId",
              `Service ${request.serviceId} not found`,
              request.serviceId,
            ),
          );
        }

        // Find or create client
        const clientResult = await Effect.runPromise(
          adapter.findOrCreateClient(request.client),
        );
        const clientId = clientResult.id;

        // Get practitioner
        const prac = await getDefaultPractitioner();

        const startDt = new Date(request.datetime);
        const endDt = new Date(
          startDt.getTime() + svc.durationMinutes * 60_000,
        );
        const confirmationCode = generateConfirmationCode(
          confirmationCodePrefix,
        );

        let row: any;
        try {
          [row] = await withDb<any[]>((d) =>
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
                status: "confirmed",
                paymentStatus: "pending",
                paymentMethod: request.paymentMethod ?? null,
                amountCents: svc.priceCents,
                idempotencyKey: request.idempotencyKey,
              })
              .returning(),
          );
        } catch (e) {
          // Concurrent duplicate submit: if the underlying table enforces a
          // unique index on idempotency_key (schema is owned by the schema
          // package, not this kit), a race between the pre-insert lookup and
          // the insert surfaces as a unique violation. Recover by replaying
          // the winning row.
          if (request.idempotencyKey && isUniqueViolation(e)) {
            const replay = await findByIdempotencyKey();
            if (replay) return replay;
          }
          throw e;
        }

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
      Effect.flatMap(adapter.createBooking(request), (booking) =>
        fromAsync(async () => {
          const { bookings: bookingsTable } = (await loadSchemas()).booking;
          const { eq } = await import("drizzle-orm");

          await withDb((d) =>
            d
              .update(bookingsTable)
              .set({
                paymentRef,
                paymentMethod: paymentProcessor,
                paymentStatus: "paid",
              })
              .where(eq(bookingsTable.id, booking.id)),
          );

          return {
            ...booking,
            paymentRef,
            paymentStatus: "paid" as const,
          };
        }),
      ),

    getBooking: (bookingId: string) =>
      fromAsync(async () => {
        return withDb((d) => loadBookingById(d, bookingId));
      }),

    cancelBooking: (bookingId: string, reason?: string) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");

        await withDb((d) =>
          d
            .update(bookingsTable)
            .set({
              status: "cancelled",
              cancelledAt: new Date().toISOString(),
              cancelReason: reason ?? null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(bookingsTable.id, bookingId)),
        );
      }),

    rescheduleBooking: (bookingId: string, newDatetime: string) =>
      fromAsync(async () => {
        const { bookings: bookingsTable } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");

        return withDb(async (d) => {
          const [row] = await d
            .select()
            .from(bookingsTable)
            .where(eq(bookingsTable.id, bookingId))
            .limit(1);

          if (!row) {
            return domainError(
              Errors.validation(
                "bookingId",
                `Booking ${bookingId} not found`,
                bookingId,
              ),
            );
          }

          const newStart = new Date(newDatetime);
          const newEnd = new Date(newStart.getTime() + row.duration * 60_000);

          await d
            .update(bookingsTable)
            .set({
              datetime: newStart.toISOString(),
              endTime: newEnd.toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(bookingsTable.id, bookingId));

          return loadBookingById(d, bookingId);
        });
      }),

    // --- Clients ---

    findOrCreateClient: (client: ClientInfo) =>
      fromAsync(async () => {
        const { clients: clientsTable } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");
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
        const { clients: clientsTable } = (await loadSchemas()).booking;
        const { eq } = await import("drizzle-orm");
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
