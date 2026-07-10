/**
 * Homegrown Adapter Concurrency Integration Test (real Postgres)
 * ----------------------------------------------------------------------------
 * Proves the write-time double-booking gate (TIN-2764) closes the race against
 * a real Postgres, not just the mock DB. Two concurrent createBooking calls for
 * the same practitioner + slot (distinct idempotency keys, so the idempotency
 * unique index is NOT what arbitrates) must resolve to exactly one booking; the
 * loser gets a ReservationError(SLOT_TAKEN).
 *
 * The mechanism under test is the per-slot transaction-scoped advisory lock
 * (pg_advisory_xact_lock) taken inside config.withTransaction: the first writer
 * holds the lock, inserts, and commits; the second blocks on the same lock key,
 * then its re-validation sees the committed booking and refuses. A plain
 * validate-then-insert under READ COMMITTED would let both inserts through, so
 * this test FAILS against pre-fix code (which does no write-time validation).
 *
 * Env-gated: skips cleanly with no DATABASE_URL / PG_INTEGRATION. When it runs
 * it bootstraps its own tables (kit_* prefix) mirroring the homegrown adapter's
 * Drizzle schema, so no external migration is required.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  uuid,
} from 'drizzle-orm/pg-core';
import pg from 'pg';

import { createHomegrownAdapter } from '../../src/adapters/homegrown.js';
import type { BookingRequest } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Env gate
// ---------------------------------------------------------------------------

const shouldRun = Boolean(process.env.DATABASE_URL || process.env.PG_INTEGRATION);
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/scheduling_kit_test';

// vitest: describe.skip when the DB is not configured, so the suite is a clean
// no-op locally and in the shared CI lane, and only executes in the dedicated
// postgres-service job.
const suite = shouldRun ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Drizzle schema mirror (kit_* tables): the subset the adapter reads/writes.
// datetime-ish columns are text: the adapter reads/writes ISO-8601 UTC strings
// (`.toISOString()`), and fixed-format ...Z strings compare chronologically.
// ---------------------------------------------------------------------------

const services = pgTable('kit_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  category: text('category'),
  active: boolean('active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  acuityId: text('acuity_id'),
});

const practitioners = pgTable('kit_practitioners', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  title: text('title'),
  photoUrl: text('photo_url'),
});

const businessHours = pgTable('kit_business_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  dayOfWeek: integer('day_of_week').notNull(),
  opens: text('opens').notNull(),
  closes: text('closes').notNull(),
});

const businessHoursOverrides = pgTable('kit_business_hours_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: text('date').notNull(),
  opens: text('opens'),
  closes: text('closes'),
});

const clients = pgTable('kit_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  notes: text('notes'),
  customFields: jsonb('custom_fields').notNull().default({}),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

const bookings = pgTable('kit_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  confirmationCode: text('confirmation_code'),
  serviceId: uuid('service_id'),
  practitionerId: uuid('practitioner_id'),
  clientId: uuid('client_id'),
  datetime: text('datetime').notNull(),
  endTime: text('end_time').notNull(),
  duration: integer('duration').notNull(),
  status: text('status').notNull(),
  paymentStatus: text('payment_status').notNull(),
  paymentMethod: text('payment_method'),
  amountCents: integer('amount_cents'),
  paymentRef: text('payment_ref'),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: text('created_at'),
  cancelledAt: text('cancelled_at'),
  cancelReason: text('cancel_reason'),
  updatedAt: text('updated_at'),
});

const timeBlocks = pgTable('kit_time_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
});

const slotReservations = pgTable('kit_slot_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  datetime: text('datetime').notNull(),
  duration: integer('duration').notNull(),
  expiresAt: text('expires_at').notNull(),
  releasedAt: text('released_at'),
});

const schemas = {
  content: { services, practitioners, businessHours },
  booking: {
    bookings,
    timeBlocks,
    slotReservations,
    clients,
    businessHoursOverrides,
  },
};

// ---------------------------------------------------------------------------
// Bootstrap DDL: mirrors the schema above.
// ---------------------------------------------------------------------------

const DDL = sql`
  CREATE TABLE IF NOT EXISTS kit_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    duration_minutes integer NOT NULL,
    price_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    category text,
    active boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    acuity_id text
  );
  CREATE TABLE IF NOT EXISTS kit_practitioners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle text NOT NULL UNIQUE,
    name text NOT NULL,
    title text,
    photo_url text
  );
  CREATE TABLE IF NOT EXISTS kit_business_hours (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week integer NOT NULL,
    opens text NOT NULL,
    closes text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kit_business_hours_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date text NOT NULL,
    opens text,
    closes text
  );
  CREATE TABLE IF NOT EXISTS kit_clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL UNIQUE,
    phone text,
    notes text,
    custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at text,
    updated_at text
  );
  CREATE TABLE IF NOT EXISTS kit_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    confirmation_code text,
    service_id uuid,
    practitioner_id uuid,
    client_id uuid,
    datetime text NOT NULL,
    end_time text NOT NULL,
    duration integer NOT NULL,
    status text NOT NULL,
    payment_status text NOT NULL,
    payment_method text,
    amount_cents integer,
    payment_ref text,
    idempotency_key text UNIQUE,
    created_at text DEFAULT (now()::text),
    cancelled_at text,
    cancel_reason text,
    updated_at text
  );
  CREATE TABLE IF NOT EXISTS kit_time_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time text NOT NULL,
    end_time text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kit_slot_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    datetime text NOT NULL,
    duration integer NOT NULL,
    expires_at text NOT NULL,
    released_at text
  );
`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('HomegrownAdapter concurrency against real Postgres', () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;
  let serviceId: string;

  const SLOT = '2026-04-20T14:00:00.000Z';
  const HANDLE = 'alex';

  const buildAdapter = () =>
    createHomegrownAdapter({
      schemas,
      defaultPractitionerHandle: HANDLE,
      getDb: async () => db,
      // Real transaction runner: the write path takes its per-slot advisory
      // lock and re-validates inside this transaction.
      withTransaction: (fn) => db.transaction(fn),
    });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString, max: 10 });
    db = drizzle(pool);
    await db.execute(DDL);
    // Seed a service and the default practitioner.
    await db.execute(sql`
      INSERT INTO kit_services (name, duration_minutes, price_cents, currency, active, display_order, acuity_id)
      VALUES ('Deep Tissue Massage', 60, 9500, 'USD', true, 1, 'svc-massage-60')
      ON CONFLICT DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO kit_practitioners (handle, name, title)
      VALUES (${HANDLE}, 'Alex Rivera', 'Licensed Massage Therapist')
      ON CONFLICT (handle) DO NOTHING;
    `);
    const [svc] = await db
      .select({ id: services.id })
      .from(services)
      .limit(1);
    serviceId = svc.id;
  }, 30000);

  afterAll(async () => {
    if (pool) {
      await pool.query(
        'DROP TABLE IF EXISTS kit_bookings, kit_clients, kit_slot_reservations, kit_time_blocks, kit_business_hours_overrides, kit_business_hours, kit_practitioners, kit_services CASCADE;',
      );
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Clean bookings between tests; reseed the shared client so the outside-txn
    // findOrCreateClient hits the update path (no client-insert unique race).
    await db.execute(sql`DELETE FROM kit_bookings;`);
    await db.execute(sql`DELETE FROM kit_clients;`);
    await db.execute(sql`
      INSERT INTO kit_clients (first_name, last_name, email, phone)
      VALUES ('Alice', 'Smith', 'alice@example.com', '607-555-1234');
    `);
  });

  const request = (idempotencyKey: string): BookingRequest => ({
    serviceId,
    datetime: SLOT,
    client: {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      phone: '607-555-1234',
    },
    idempotencyKey,
  });

  it('lets exactly one of two concurrent bookings for the same slot win', async () => {
    const adapter = buildAdapter();

    // Distinct idempotency keys: the idempotency index cannot be what
    // arbitrates, so the slot advisory lock + re-validation must.
    const results = await Promise.allSettled([
      Effect.runPromise(adapter.createBooking(request('race-A'))),
      Effect.runPromise(adapter.createBooking(request('race-B'))),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one write won.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // And the database holds exactly one booking for the slot.
    const rows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(sql`${bookings.datetime} = ${SLOT}`);
    expect(rows).toHaveLength(1);
  }, 30000);

  it('rejects a second sequential booking for a slot already taken', async () => {
    const adapter = buildAdapter();

    const first = await Effect.runPromise(adapter.createBooking(request('seq-1')));
    expect(first.datetime).toBe(SLOT);

    const outcome = await Effect.runPromiseExit(
      adapter.createBooking(request('seq-2')),
    );
    expect(outcome._tag).toBe('Failure');

    const rows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(sql`${bookings.datetime} = ${SLOT}`);
    expect(rows).toHaveLength(1);
  }, 30000);
});
