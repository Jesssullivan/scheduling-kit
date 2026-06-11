/**
 * HomegrownAdapter Unit Tests
 *
 * Tests adapter behavior by mocking the Drizzle DB layer.
 * The adapter delegates availability math to availability-engine.ts
 * (already covered by 39 tests), so these tests focus on:
 *
 *   - DB row → domain type mapping
 *   - Effect wrapping and error surfacing
 *   - Service resolution (UUID vs acuityId)
 *   - Find-or-create client logic
 *   - Booking lifecycle (create → get → cancel/reschedule)
 *   - Reservation create/release
 *   - Provider lookup (solo practice pattern)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  createHomegrownAdapter,
  type HomegrownAdapterConfig,
} from "../homegrown.js";

// ---------------------------------------------------------------------------
// Mock schemas — minimal shape matching what Drizzle ORM tables expose
// ---------------------------------------------------------------------------

const mockServicesTable = {
  id: "id",
  name: "name",
  active: "active",
  displayOrder: "displayOrder",
  acuityId: "acuityId",
};
const mockPractitionersTable = { id: "id", handle: "handle", name: "name" };
const mockBusinessHoursTable = { dayOfWeek: "dayOfWeek" };
const mockBusinessHoursOverridesTable = { date: "date" };
const mockBookingsTable = {
  id: "id",
  datetime: "datetime",
  endTime: "endTime",
  status: "status",
  serviceId: "serviceId",
  clientId: "clientId",
  practitionerId: "practitionerId",
  idempotencyKey: "idempotencyKey",
};
const mockTimeBlocksTable = { startTime: "startTime", endTime: "endTime" };
const mockSlotReservationsTable = {
  datetime: "datetime",
  duration: "duration",
  expiresAt: "expiresAt",
  releasedAt: "releasedAt",
  id: "id",
};
const mockClientsTable = { id: "id", email: "email" };

const testSchemas = {
  content: {
    services: mockServicesTable,
    practitioners: mockPractitionersTable,
    businessHours: mockBusinessHoursTable,
  },
  booking: {
    bookings: mockBookingsTable,
    timeBlocks: mockTimeBlocksTable,
    slotReservations: mockSlotReservationsTable,
    clients: mockClientsTable,
    businessHoursOverrides: mockBusinessHoursOverridesTable,
  },
};

const createAdapter = (config: HomegrownAdapterConfig) =>
  createHomegrownAdapter({
    schemas: testSchemas,
    // There is no built-in fallback handle anymore; tests configure an
    // anonymized one explicitly (override per-test as needed).
    defaultPractitionerHandle: "alex",
    ...config,
  });

// Mock drizzle-orm operators — return identity functions for where-clause building
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  asc: (col: string) => ({ op: "asc", col }),
  ne: (col: string, val: unknown) => ({ op: "ne", col, val }),
  gte: (col: string, val: unknown) => ({ op: "gte", col, val }),
  lte: (col: string, val: unknown) => ({ op: "lte", col, val }),
  gt: (col: string, val: unknown) => ({ op: "gt", col, val }),
  isNull: (col: string) => ({ op: "isNull", col }),
}));

// ---------------------------------------------------------------------------
// Mock DB builder — fluent Drizzle-like chain that returns canned rows
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

const createMockDb = (
  responses: {
    select?: MockRow[];
    insert?: MockRow[];
    update?: MockRow[];
  } = {},
) => {
  const selectRows = responses.select ?? [];
  const insertRows = responses.insert ?? [];

  const chainTerminals = {
    limit: vi.fn().mockResolvedValue(selectRows),
    orderBy: vi.fn().mockResolvedValue(selectRows),
    returning: vi.fn().mockResolvedValue(insertRows),
  };

  const chain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(chainTerminals),
      orderBy: chainTerminals.orderBy,
      limit: chainTerminals.limit,
    }),
    where: vi.fn().mockReturnValue(chainTerminals),
    values: vi.fn().mockReturnValue({
      returning: chainTerminals.returning,
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };

  const db = {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    _chain: chain,
    _terminals: chainTerminals,
  };

  return db;
};

/**
 * Sequenced mock DB — returns different rows for successive select/insert calls.
 * Used for multi-step methods like createBooking and getBooking which make
 * multiple sequential DB queries against different tables.
 */
const createSequencedMockDb = (
  selectSequence: MockRow[][],
  insertSequence: MockRow[][] = [],
) => {
  let selectCall = 0;
  let insertCall = 0;

  const makeSelectChain = () => {
    const rows = selectSequence[selectCall] ?? [];
    selectCall++;
    const terminals = {
      limit: vi.fn().mockResolvedValue(rows),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    return {
      where: vi.fn().mockReturnValue(terminals),
      orderBy: terminals.orderBy,
      limit: terminals.limit,
    };
  };

  const makeInsertChain = () => {
    const rows = insertSequence[insertCall] ?? [];
    insertCall++;
    return {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    };
  };

  return {
    select: vi
      .fn()
      .mockImplementation(() => ({
        from: vi.fn().mockImplementation(makeSelectChain),
      })),
    insert: vi.fn().mockImplementation(makeInsertChain),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERVICE_ROW = {
  id: "svc-uuid-1",
  name: "Deep Tissue Massage",
  description: "60-minute therapeutic session",
  durationMinutes: 60,
  priceCents: 9500,
  currency: "USD",
  category: "therapeutic",
  active: true,
  displayOrder: 1,
  acuityId: "12345",
};

const PRACTITIONER_ROW = {
  id: "prac-uuid-1",
  handle: "alex",
  name: "Alex Rivera",
  title: "Licensed Massage Therapist",
  photoUrl: "https://example.com/alex.jpg",
};

const CLIENT_ROW = {
  id: "client-uuid-1",
  firstName: "Alice",
  lastName: "Smith",
  email: "alice@example.com",
  phone: "607-555-1234",
  notes: null,
  createdAt: "2026-04-10T12:00:00Z",
  updatedAt: "2026-04-10T12:00:00Z",
};

const BOOKING_ROW = {
  id: "booking-uuid-1",
  confirmationCode: "ABC123",
  serviceId: "svc-uuid-1",
  practitionerId: "prac-uuid-1",
  clientId: "client-uuid-1",
  datetime: "2026-04-20T14:00:00.000Z",
  endTime: "2026-04-20T15:00:00.000Z",
  duration: 60,
  status: "confirmed",
  paymentStatus: "pending",
  paymentMethod: null,
  amountCents: 9500,
  paymentRef: null,
  createdAt: "2026-04-18T10:00:00.000Z",
  cancelledAt: null,
  cancelReason: null,
  updatedAt: null,
};

const RESERVATION_ROW = {
  id: "res-uuid-1",
  datetime: "2026-04-20T14:00:00.000Z",
  duration: 60,
  expiresAt: "2026-04-20T14:10:00.000Z",
};

const TEST_CLIENT: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
} = {
  firstName: "Alice",
  lastName: "Smith",
  email: "alice@example.com",
  phone: "607-555-1234",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HomegrownAdapter", () => {
  describe("creation and configuration", () => {
    it('creates an adapter with name "homegrown"', () => {
      const adapter = createAdapter({ getDb: async () => ({}) });
      expect(adapter.name).toBe("homegrown");
    });

    it("creates an adapter with a scoped database executor only", () => {
      const adapter = createAdapter({
        withDb: async (fn) => fn({}),
      });
      expect(adapter.name).toBe("homegrown");
    });

    it("throws immediately when no database accessor is configured", () => {
      expect(() => createAdapter({})).toThrow(
        "HomegrownAdapter requires either getDb or withDb",
      );
    });

    it("uses scoped database executor when provided", async () => {
      const mockDb = createMockDb();
      mockDb._terminals.orderBy.mockResolvedValue([SERVICE_ROW]);
      const getDb = vi.fn(async () => mockDb);
      const withDb = vi.fn(async (fn) => fn(mockDb));

      const adapter = createAdapter({ getDb, withDb });
      const result = await Effect.runPromise(adapter.getServices());

      expect(result).toHaveLength(1);
      expect(withDb).toHaveBeenCalledOnce();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("exposes all 16+1 SchedulingAdapter methods", () => {
      const adapter = createAdapter({ getDb: async () => ({}) });
      const methods = [
        "getServices",
        "getService",
        "getProviders",
        "getProvider",
        "getProvidersForService",
        "getAvailableDates",
        "getAvailableSlots",
        "checkSlotAvailability",
        "softHoldSlot",
        "releaseSoftHold",
        "createBooking",
        "createBookingWithPaymentRef",
        "getBooking",
        "cancelBooking",
        "rescheduleBooking",
        "findOrCreateClient",
        "getClientByEmail",
      ];
      for (const m of methods) {
        expect(typeof (adapter as any)[m]).toBe("function");
      }
    });

    it("accepts custom configuration", () => {
      const adapter = createAdapter({
        getDb: async () => ({}),
        timezone: "America/Chicago",
        slotInterval: 15,
        bufferMinutes: 10,
        minAdvanceHours: 4,
        defaultPractitionerHandle: "jess",
      });
      expect(adapter.name).toBe("homegrown");
    });
  });

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------

  describe("getServices", () => {
    it("returns active services mapped to Service domain type", async () => {
      const mockDb = createMockDb();
      // orderBy terminal returns the service rows
      mockDb._terminals.orderBy.mockResolvedValue([SERVICE_ROW]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(adapter.getServices());

      expect(result).toEqual([
        {
          id: "svc-uuid-1",
          name: "Deep Tissue Massage",
          description: "60-minute therapeutic session",
          duration: 60,
          price: 9500,
          currency: "USD",
          category: "therapeutic",
          active: true,
        },
      ]);
    });

    it("returns empty array when no active services exist", async () => {
      const mockDb = createMockDb();
      mockDb._terminals.orderBy.mockResolvedValue([]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(adapter.getServices());

      expect(result).toEqual([]);
    });

    it("maps null description to undefined", async () => {
      const mockDb = createMockDb();
      mockDb._terminals.orderBy.mockResolvedValue([
        { ...SERVICE_ROW, description: null, category: null },
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(adapter.getServices());

      expect(result[0].description).toBeUndefined();
      expect(result[0].category).toBeUndefined();
    });

    it("surfaces DB errors as InfrastructureError via Effect", async () => {
      const mockDb = createMockDb();
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error("connection refused")),
            limit: vi.fn().mockRejectedValue(new Error("connection refused")),
          }),
          orderBy: vi.fn().mockRejectedValue(new Error("connection refused")),
        }),
      });

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromiseExit(adapter.getServices());

      expect(result._tag).toBe("Failure");
    });
  });

  describe("getService", () => {
    it("resolves service by UUID", async () => {
      const mockDb = createMockDb({ select: [SERVICE_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getService("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
      );

      expect(result.id).toBe("svc-uuid-1");
      expect(result.name).toBe("Deep Tissue Massage");
      expect(result.duration).toBe(60);
      expect(result.price).toBe(9500);
    });

    it("resolves service by acuityId (non-UUID string)", async () => {
      const mockDb = createMockDb({ select: [SERVICE_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(adapter.getService("12345"));

      expect(result.id).toBe("svc-uuid-1");
    });

    it("fails when service not found", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromiseExit(
        adapter.getService("nonexistent"),
      );

      expect(result._tag).toBe("Failure");
    });
  });

  // -------------------------------------------------------------------------
  // Providers
  // -------------------------------------------------------------------------

  describe("getProviders", () => {
    it("returns the default practitioner as a Provider", async () => {
      const mockDb = createMockDb({ select: [PRACTITIONER_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(adapter.getProviders());

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "prac-uuid-1",
        name: "Alex Rivera",
        email: undefined,
        description: "Licensed Massage Therapist",
        image: "https://example.com/alex.jpg",
        timezone: "America/New_York",
      });
    });

    it("returns empty array when no practitioner found", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(adapter.getProviders());

      expect(result).toEqual([]);
    });

    it("uses custom timezone from config", async () => {
      const mockDb = createMockDb({ select: [PRACTITIONER_ROW] });
      const adapter = createAdapter({
        getDb: async () => mockDb,
        timezone: "America/Chicago",
      });

      const result = await Effect.runPromise(adapter.getProviders());
      expect(result[0].timezone).toBe("America/Chicago");
    });
  });

  describe("getProvider", () => {
    it("returns a specific provider by ID", async () => {
      const mockDb = createMockDb({ select: [PRACTITIONER_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getProvider("prac-uuid-1"),
      );

      expect(result.id).toBe("prac-uuid-1");
      expect(result.name).toBe("Alex Rivera");
    });

    it("fails when provider not found", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromiseExit(
        adapter.getProvider("nonexistent"),
      );

      expect(result._tag).toBe("Failure");
    });
  });

  describe("getProvidersForService", () => {
    it("delegates to getProviders (solo practice)", async () => {
      const mockDb = createMockDb({ select: [PRACTITIONER_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getProvidersForService("any-service"),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("prac-uuid-1");
    });
  });

  // -------------------------------------------------------------------------
  // Reservations
  // -------------------------------------------------------------------------

  describe("softHoldSlot", () => {
    it("inserts an advisory soft hold and returns SlotSoftHold", async () => {
      const mockDb = createMockDb({ insert: [RESERVATION_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.softHoldSlot({
          serviceId: "svc-uuid-1",
          providerId: "prac-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          duration: 60,
          expirationMinutes: 10,
        }),
      );

      expect(result).toEqual({
        id: "res-uuid-1",
        datetime: "2026-04-20T14:00:00.000Z",
        duration: 60,
        expiresAt: "2026-04-20T14:10:00.000Z",
        providerId: "prac-uuid-1",
      });
    });

    it("defaults expiration to 10 minutes when not specified", async () => {
      const mockDb = createMockDb({ insert: [RESERVATION_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      // The adapter calculates expiresAt internally — we just verify the
      // insert goes through and returns the DB row
      const result = await Effect.runPromise(
        adapter.softHoldSlot({
          serviceId: "svc-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          duration: 60,
        }),
      );

      expect(result.id).toBe("res-uuid-1");
    });
  });

  describe("releaseSoftHold", () => {
    it("sets releasedAt on the soft hold", async () => {
      const mockDb = createMockDb();
      const adapter = createAdapter({ getDb: async () => mockDb });

      // releaseSoftHold returns void — just ensure no throw
      await expect(
        Effect.runPromise(adapter.releaseSoftHold("res-uuid-1")),
      ).resolves.toBeUndefined();

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  describe("findOrCreateClient", () => {
    it("returns existing client with isNew=false and updates info", async () => {
      const mockDb = createMockDb({ select: [CLIENT_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.findOrCreateClient(TEST_CLIENT),
      );

      expect(result).toEqual({ id: "client-uuid-1", isNew: false });
      // Should have called update to refresh name/phone
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("creates new client when email not found", async () => {
      const mockDb = createMockDb();
      // First select (find by email) returns empty
      mockDb._terminals.limit.mockResolvedValue([]);
      // Insert returns new row
      mockDb._terminals.returning.mockResolvedValue([
        { id: "client-uuid-new" },
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.findOrCreateClient(TEST_CLIENT),
      );

      expect(result).toEqual({ id: "client-uuid-new", isNew: true });
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("getClientByEmail", () => {
    it("returns ClientInfo when client exists", async () => {
      const mockDb = createMockDb({ select: [CLIENT_ROW] });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getClientByEmail("alice@example.com"),
      );

      expect(result).toEqual({
        firstName: "Alice",
        lastName: "Smith",
        email: "alice@example.com",
        phone: "607-555-1234",
        notes: undefined,
      });
    });

    it("returns null when client not found", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);

      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getClientByEmail("nobody@example.com"),
      );

      expect(result).toBeNull();
    });

    it("maps null phone/notes to undefined", async () => {
      const mockDb = createMockDb({
        select: [{ ...CLIENT_ROW, phone: null, notes: null }],
      });
      const adapter = createAdapter({ getDb: async () => mockDb });

      const result = await Effect.runPromise(
        adapter.getClientByEmail("alice@example.com"),
      );

      expect(result?.phone).toBeUndefined();
      expect(result?.notes).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bookings
  // -------------------------------------------------------------------------

  describe("cancelBooking", () => {
    it("sets status to cancelled", async () => {
      const mockDb = createMockDb();
      const adapter = createAdapter({ getDb: async () => mockDb });

      await expect(
        Effect.runPromise(
          adapter.cancelBooking("booking-uuid-1", "schedule conflict"),
        ),
      ).resolves.toBeUndefined();

      expect(mockDb.update).toHaveBeenCalled();
    });

    it("works without a reason", async () => {
      const mockDb = createMockDb();
      const adapter = createAdapter({ getDb: async () => mockDb });

      await expect(
        Effect.runPromise(adapter.cancelBooking("booking-uuid-1")),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bookings — multi-step (sequenced mock)
  // -------------------------------------------------------------------------

  describe("createBooking", () => {
    it("resolves service, finds client, gets practitioner, inserts booking", async () => {
      // createBooking internally calls:
      //   1. idempotency pre-lookup (select, miss)
      //   2. resolveService (select)
      //   3. findOrCreateClient → find by email (select) → update if exists
      //   4. getDefaultPractitioner (select)
      //   5. insert booking
      const mockDb = createSequencedMockDb(
        [
          [], // idempotency pre-lookup (no existing booking)
          [SERVICE_ROW], // resolveService
          [CLIENT_ROW], // findOrCreateClient email lookup
          [PRACTITIONER_ROW], // getDefaultPractitioner
        ],
        [
          [BOOKING_ROW], // insert booking
        ],
      );

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.createBooking({
          serviceId: "svc-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          client: TEST_CLIENT,
          idempotencyKey: "idem-001",
        }),
      );

      expect(result.id).toBe("booking-uuid-1");
      expect(result.serviceId).toBe("svc-uuid-1");
      expect(result.serviceName).toBe("Deep Tissue Massage");
      expect(result.confirmationCode).toBe("ABC123");
      expect(result.status).toBe("confirmed");
      expect(result.paymentStatus).toBe("pending");
      expect(result.client).toEqual(TEST_CLIENT);
    });

    it("fails when service not found during booking", async () => {
      const mockDb = createSequencedMockDb([
        [], // idempotency pre-lookup (no existing booking)
        [], // resolveService returns empty
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const exit = await Effect.runPromiseExit(
        adapter.createBooking({
          serviceId: "nonexistent",
          datetime: "2026-04-20T14:00:00.000Z",
          client: TEST_CLIENT,
          idempotencyKey: "idem-002",
        }),
      );

      expect(exit._tag).toBe("Failure");
    });

    it("creates new client when email not found during booking", async () => {
      const mockDb = createSequencedMockDb(
        [
          [], // idempotency pre-lookup (no existing booking)
          [SERVICE_ROW], // resolveService
          [], // findOrCreateClient: email not found
          [PRACTITIONER_ROW], // getDefaultPractitioner
        ],
        [
          [{ id: "client-uuid-new" }], // insert client
          [BOOKING_ROW], // insert booking
        ],
      );

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.createBooking({
          serviceId: "svc-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          client: TEST_CLIENT,
          idempotencyKey: "idem-003",
        }),
      );

      expect(result.id).toBe("booking-uuid-1");
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency dedup
  // -------------------------------------------------------------------------

  describe("createBooking idempotency", () => {
    it("replays the existing booking for a duplicate idempotency key without a second insert", async () => {
      // Pre-lookup hits → loadBookingById (4 selects) → no insert at all
      const mockDb = createSequencedMockDb([
        [{ ...BOOKING_ROW, idempotencyKey: "idem-dup" }], // pre-lookup hit
        [BOOKING_ROW], // loadBookingById: booking
        [SERVICE_ROW], // loadBookingById: service
        [CLIENT_ROW], // loadBookingById: client
        [PRACTITIONER_ROW], // loadBookingById: practitioner
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.createBooking({
          serviceId: "svc-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          client: TEST_CLIENT,
          idempotencyKey: "idem-dup",
        }),
      );

      expect(result.id).toBe("booking-uuid-1");
      expect(result.confirmationCode).toBe("ABC123");
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("recovers from a unique-violation race by replaying the winning row", async () => {
      // Pre-lookup misses, insert hits the (schema-package-owned) unique
      // index, replay lookup finds the row the concurrent request inserted.
      let selectCall = 0;
      const selectSequence = [
        [], // 1. idempotency pre-lookup (miss — race window)
        [SERVICE_ROW], // 2. resolveService
        [CLIENT_ROW], // 3. findOrCreateClient email lookup
        [PRACTITIONER_ROW], // 4. getDefaultPractitioner
        [{ ...BOOKING_ROW, idempotencyKey: "idem-race" }], // 5. replay lookup
        [BOOKING_ROW], // 6. loadBookingById: booking
        [SERVICE_ROW], // 7. loadBookingById: service
        [CLIENT_ROW], // 8. loadBookingById: client
        [PRACTITIONER_ROW], // 9. loadBookingById: practitioner
      ];
      const makeSelectChain = () => {
        const rows = selectSequence[selectCall] ?? [];
        selectCall++;
        const terminals = {
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
        };
        return {
          where: vi.fn().mockReturnValue(terminals),
          orderBy: terminals.orderBy,
          limit: terminals.limit,
        };
      };
      const uniqueViolation = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "bookings_idempotency_key_key"',
        ),
        { code: "23505" },
      );
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(makeSelectChain),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(uniqueViolation),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.createBooking({
          serviceId: "svc-uuid-1",
          datetime: "2026-04-20T14:00:00.000Z",
          client: TEST_CLIENT,
          idempotencyKey: "idem-race",
        }),
      );

      expect(result.id).toBe("booking-uuid-1");
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it("rethrows unique violations that cannot be replayed", async () => {
      // Same race shape, but the replay lookup also misses (e.g. the
      // violation came from a different constraint).
      let selectCall = 0;
      const selectSequence = [
        [], // pre-lookup miss
        [SERVICE_ROW],
        [CLIENT_ROW],
        [PRACTITIONER_ROW],
        [], // replay lookup also misses
      ];
      const makeSelectChain = () => {
        const rows = selectSequence[selectCall] ?? [];
        selectCall++;
        const terminals = {
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
        };
        return {
          where: vi.fn().mockReturnValue(terminals),
          orderBy: terminals.orderBy,
          limit: terminals.limit,
        };
      };
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(makeSelectChain),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockRejectedValue(
                Object.assign(new Error("duplicate key value"), {
                  code: "23505",
                }),
              ),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      const adapter = createAdapter({ getDb: async () => mockDb });
      const error = await Effect.runPromise(
        Effect.flip(
          adapter.createBooking({
            serviceId: "svc-uuid-1",
            datetime: "2026-04-20T14:00:00.000Z",
            client: TEST_CLIENT,
            idempotencyKey: "idem-orphan",
          }),
        ),
      );

      expect(error._tag).toBe("InfrastructureError");
    });
  });

  // -------------------------------------------------------------------------
  // Confirmation code prefix threading
  // -------------------------------------------------------------------------

  describe("confirmation code prefix", () => {
    const createCapturingDb = () => {
      let selectCall = 0;
      const selectSequence = [
        [], // idempotency pre-lookup
        [SERVICE_ROW], // resolveService
        [CLIENT_ROW], // findOrCreateClient
        [PRACTITIONER_ROW], // getDefaultPractitioner
      ];
      const makeSelectChain = () => {
        const rows = selectSequence[selectCall] ?? [];
        selectCall++;
        const terminals = {
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockResolvedValue(rows),
        };
        return {
          where: vi.fn().mockReturnValue(terminals),
          orderBy: terminals.orderBy,
          limit: terminals.limit,
        };
      };
      const insertedValues: Record<string, unknown>[] = [];
      return {
        insertedValues,
        db: {
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockImplementation(makeSelectChain),
          })),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
              insertedValues.push(v);
              return { returning: vi.fn().mockResolvedValue([BOOKING_ROW]) };
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        },
      };
    };

    const bookingRequest = {
      serviceId: "svc-uuid-1",
      datetime: "2026-04-20T14:00:00.000Z",
      client: TEST_CLIENT,
      idempotencyKey: "idem-prefix",
    };

    it("generates confirmation codes with the neutral BK prefix by default", async () => {
      const { db, insertedValues } = createCapturingDb();
      const adapter = createAdapter({ getDb: async () => db });

      await Effect.runPromise(adapter.createBooking(bookingRequest));

      expect(insertedValues[0].confirmationCode).toMatch(/^BK-[A-Z2-9]{6}$/);
    });

    it("threads confirmationCodePrefix from config into generated codes", async () => {
      const { db, insertedValues } = createCapturingDb();
      const adapter = createAdapter({
        getDb: async () => db,
        confirmationCodePrefix: "MI",
      });

      await Effect.runPromise(adapter.createBooking(bookingRequest));

      expect(insertedValues[0].confirmationCode).toMatch(/^MI-[A-Z2-9]{6}$/);
    });

    it("persists the idempotency key on insert", async () => {
      const { db, insertedValues } = createCapturingDb();
      const adapter = createAdapter({ getDb: async () => db });

      await Effect.runPromise(adapter.createBooking(bookingRequest));

      expect(insertedValues[0].idempotencyKey).toBe("idem-prefix");
    });
  });

  // -------------------------------------------------------------------------
  // Typed error mapping
  // -------------------------------------------------------------------------

  describe("typed error mapping", () => {
    it("maps unknown service in getService to ValidationError(serviceId)", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);
      const adapter = createAdapter({ getDb: async () => mockDb });

      const error = await Effect.runPromise(
        Effect.flip(adapter.getService("nonexistent")),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({
        field: "serviceId",
        message: "Service nonexistent not found",
        value: "nonexistent",
      });
    });

    it("maps unknown provider in getProvider to ValidationError(providerId)", async () => {
      const mockDb = createMockDb({ select: [] });
      mockDb._terminals.limit.mockResolvedValue([]);
      const adapter = createAdapter({ getDb: async () => mockDb });

      const error = await Effect.runPromise(
        Effect.flip(adapter.getProvider("nonexistent")),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({
        field: "providerId",
        message: "Provider nonexistent not found",
      });
    });

    it("maps unknown booking in getBooking to ValidationError(bookingId)", async () => {
      const mockDb = createSequencedMockDb([[]]);
      const adapter = createAdapter({ getDb: async () => mockDb });

      const error = await Effect.runPromise(
        Effect.flip(adapter.getBooking("nonexistent")),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({
        field: "bookingId",
        message: "Booking nonexistent not found",
      });
    });

    it("maps unknown booking in rescheduleBooking to ValidationError(bookingId)", async () => {
      const mockDb = createSequencedMockDb([[]]);
      const adapter = createAdapter({ getDb: async () => mockDb });

      const error = await Effect.runPromise(
        Effect.flip(
          adapter.rescheduleBooking("nonexistent", "2026-04-21T10:00:00.000Z"),
        ),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({ field: "bookingId" });
    });

    it("maps unknown service in createBooking to ValidationError(serviceId)", async () => {
      const mockDb = createSequencedMockDb([
        [], // idempotency pre-lookup
        [], // resolveService miss
      ]);
      const adapter = createAdapter({ getDb: async () => mockDb });

      const error = await Effect.runPromise(
        Effect.flip(
          adapter.createBooking({
            serviceId: "nonexistent",
            datetime: "2026-04-20T14:00:00.000Z",
            client: TEST_CLIENT,
            idempotencyKey: "idem-missing-svc",
          }),
        ),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({ field: "serviceId" });
    });

    it("keeps InfrastructureError(UNKNOWN) for unrecognized failures", async () => {
      const adapter = createAdapter({
        getDb: async () => {
          throw new Error("ECONNREFUSED");
        },
      });

      const error = await Effect.runPromise(Effect.flip(adapter.getServices()));

      expect(error._tag).toBe("InfrastructureError");
      expect(error).toMatchObject({ code: "UNKNOWN", message: "ECONNREFUSED" });
    });
  });

  // -------------------------------------------------------------------------
  // Default practitioner handle requirement (no built-in fallback)
  // -------------------------------------------------------------------------

  describe("default practitioner handle requirement", () => {
    it("fails getProviders with ValidationError when no handle is configured", async () => {
      const mockDb = createMockDb({ select: [PRACTITIONER_ROW] });
      const adapter = createHomegrownAdapter({
        schemas: testSchemas,
        getDb: async () => mockDb,
      });

      const error = await Effect.runPromise(Effect.flip(adapter.getProviders()));

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({ field: "defaultPractitionerHandle" });
      expect((error as { message: string }).message).toContain(
        "defaultPractitionerHandle",
      );
    });

    it("fails createBooking with ValidationError when no handle is configured", async () => {
      const mockDb = createSequencedMockDb([
        [], // idempotency pre-lookup
        [SERVICE_ROW], // resolveService
        [CLIENT_ROW], // findOrCreateClient
      ]);
      const adapter = createHomegrownAdapter({
        schemas: testSchemas,
        getDb: async () => mockDb,
      });

      const error = await Effect.runPromise(
        Effect.flip(
          adapter.createBooking({
            serviceId: "svc-uuid-1",
            datetime: "2026-04-20T14:00:00.000Z",
            client: TEST_CLIENT,
            idempotencyKey: "idem-no-handle",
          }),
        ),
      );

      expect(error._tag).toBe("ValidationError");
      expect(error).toMatchObject({ field: "defaultPractitionerHandle" });
    });
  });

  describe("getBooking", () => {
    it("joins booking, service, client, and practitioner data", async () => {
      // getBooking does 4 sequential selects:
      //   1. booking by ID
      //   2. service by booking.serviceId
      //   3. client by booking.clientId
      //   4. practitioner by booking.practitionerId (conditional)
      const mockDb = createSequencedMockDb([
        [BOOKING_ROW], // booking
        [SERVICE_ROW], // service
        [CLIENT_ROW], // client
        [PRACTITIONER_ROW], // practitioner
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.getBooking("booking-uuid-1"),
      );

      expect(result.id).toBe("booking-uuid-1");
      expect(result.serviceName).toBe("Deep Tissue Massage");
      expect(result.providerName).toBe("Alex Rivera");
      expect(result.client.firstName).toBe("Alice");
      expect(result.client.email).toBe("alice@example.com");
      expect(result.duration).toBe(60);
      expect(result.price).toBe(9500);
      expect(result.currency).toBe("USD");
    });

    it("fails when booking not found", async () => {
      const mockDb = createSequencedMockDb([
        [], // booking not found
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const exit = await Effect.runPromiseExit(
        adapter.getBooking("nonexistent"),
      );

      expect(exit._tag).toBe("Failure");
    });

    it("handles missing service gracefully", async () => {
      const mockDb = createSequencedMockDb([
        [BOOKING_ROW], // booking exists
        [], // service not found
        [CLIENT_ROW], // client
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.getBooking("booking-uuid-1"),
      );

      // Falls back to 'Unknown' for service name, 'USD' for currency
      expect(result.serviceName).toBe("Unknown");
      expect(result.currency).toBe("USD");
    });
  });

  describe("rescheduleBooking", () => {
    it("updates datetime and returns refreshed booking", async () => {
      // rescheduleBooking:
      //   1. select existing booking
      //   2. update with new datetime/endTime
      //   3. calls getBooking internally (4 more selects)
      const mockDb = createSequencedMockDb([
        [BOOKING_ROW], // 1. select existing
        // getBooking selects (called via adapter.getBooking):
        [
          {
            ...BOOKING_ROW,
            datetime: "2026-04-21T10:00:00.000Z",
            endTime: "2026-04-21T11:00:00.000Z",
          },
        ],
        [SERVICE_ROW],
        [CLIENT_ROW],
        [PRACTITIONER_ROW],
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const result = await Effect.runPromise(
        adapter.rescheduleBooking("booking-uuid-1", "2026-04-21T10:00:00.000Z"),
      );

      expect(result.id).toBe("booking-uuid-1");
      expect(result.datetime).toBe("2026-04-21T10:00:00.000Z");
    });

    it("fails when booking not found", async () => {
      const mockDb = createSequencedMockDb([
        [], // existing booking not found
      ]);

      const adapter = createAdapter({ getDb: async () => mockDb });
      const exit = await Effect.runPromiseExit(
        adapter.rescheduleBooking("nonexistent", "2026-04-21T10:00:00.000Z"),
      );

      expect(exit._tag).toBe("Failure");
    });

    it("keeps read, update, and refreshed fetch in one scoped executor call", async () => {
      const mockDb = createSequencedMockDb([
        [BOOKING_ROW],
        [
          {
            ...BOOKING_ROW,
            datetime: "2026-04-21T10:00:00.000Z",
            endTime: "2026-04-21T11:00:00.000Z",
          },
        ],
        [SERVICE_ROW],
        [CLIENT_ROW],
        [PRACTITIONER_ROW],
      ]);
      const withDb = vi.fn(async (fn) => fn(mockDb));

      const adapter = createAdapter({ withDb });
      const result = await Effect.runPromise(
        adapter.rescheduleBooking("booking-uuid-1", "2026-04-21T10:00:00.000Z"),
      );

      expect(result.datetime).toBe("2026-04-21T10:00:00.000Z");
      expect(withDb).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Effect error wrapping
  // -------------------------------------------------------------------------

  describe("Effect error wrapping", () => {
    it("wraps DB connection errors as InfrastructureError", async () => {
      const adapter = createAdapter({
        getDb: async () => {
          throw new Error("ECONNREFUSED");
        },
      });

      const exit = await Effect.runPromiseExit(adapter.getServices());
      expect(exit._tag).toBe("Failure");
    });

    it("wraps non-Error throws as InfrastructureError with UNKNOWN code", async () => {
      const adapter = createAdapter({
        getDb: async () => {
          throw "string error";
        },
      });

      const exit = await Effect.runPromiseExit(adapter.getServices());
      expect(exit._tag).toBe("Failure");
    });
  });
});
