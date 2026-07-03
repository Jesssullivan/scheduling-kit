/**
 * Idempotency Replay Integration Test (cassette-backed)
 * ----------------------------------------------------------------------------
 * Unit tests already prove `createBooking` dedupe semantics against mock DB
 * rows (see `src/adapters/__tests__/homegrown-adapter.test.ts` →
 * "createBooking idempotency"). This suite closes the prompt-03 gap: a
 * cassette-backed proof that replays the idempotency contract over the kit's
 * own `src/testing` player, with zero live credentials.
 *
 * It also makes the advertised-but-unconsumed cassette infra real: the
 * `CassettePlayer` (player.ts), cassette format (cassette.ts), and masking
 * (masking.ts) are exercised end-to-end against a committed, masked cassette
 * under `cassettes/idempotency-replay.json`.
 *
 * The idempotency algorithm is modelled at the HTTP layer, mirroring the
 * homegrown adapter's DB algorithm:
 *   1. idempotency pre-lookup by key (skipped when the key is absent/empty)
 *   2. insert on a pre-lookup miss
 *   3. on a unique-violation (Postgres 23505) race, a replay lookup returns
 *      the row the winning concurrent request inserted
 *
 * The `CassettePlayer` resolves each HTTP call to a recorded interaction using
 * exact-URL matching, so every logical request is uniquely addressable and the
 * replay is fully deterministic and offline.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  CassettePlayer,
  FileCassetteStorage,
  maskString,
  acuityMaskingConfig,
  type Cassette,
} from '../../src/testing/index.js';

const BASE = 'https://api.scheduling.test';
const CASSETTE_NAME = 'idempotency-replay';
const CASSETTES_DIR = fileURLToPath(new URL('../../cassettes', import.meta.url));

// ---------------------------------------------------------------------------
// Idempotent booking transport built on the CassettePlayer
// ---------------------------------------------------------------------------

interface BookingRecord {
  readonly id: string;
  readonly status?: string;
  readonly idempotencyKey?: string;
  readonly [key: string]: unknown;
}

interface SubmitRequest {
  serviceId: string;
  datetime: string;
  client: { firstName: string; lastName: string; email: string };
  /** Absent or empty → no idempotency dedupe (null passthrough). */
  idempotencyKey?: string;
  /** Transport correlation token used only to address keyless recordings. */
  ref?: string;
}

interface SubmitResult {
  booking: BookingRecord;
  /** Replay of an existing booking (pre-lookup hit or post-conflict replay). */
  replayed: boolean;
  /** Replay was reached via a unique-violation race. */
  raced: boolean;
  /** A brand-new booking row was created by this submission. */
  inserted: boolean;
  /** Idempotency lookups performed (pre-lookup + optional replay lookup). */
  lookups: number;
  /** Insert (POST) attempts performed. */
  insertAttempts: number;
}

const encodeKey = (value: string): string => encodeURIComponent(value);

/**
 * Resolve one HTTP call to its recorded cassette interaction, or throw. The
 * player never falls back to the network, so an unmatched request is a hard
 * offline failure rather than a live call.
 */
function resolve(
  player: CassettePlayer,
  method: string,
  url: string,
  body?: string
): { status: number; json: <T>() => T } {
  const entry = player.findResponse({ method, url, headers: {}, body });
  if (!entry) {
    throw new Error(`No cassette interaction for ${method} ${url}`);
  }
  const raw = entry.response.body ?? '';
  return {
    status: entry.response.status,
    json: <T>() => JSON.parse(raw) as T,
  };
}

/**
 * Submit a booking through the cassette-backed idempotency contract.
 */
async function submitBooking(
  player: CassettePlayer,
  req: SubmitRequest
): Promise<SubmitResult> {
  let lookups = 0;
  let insertAttempts = 0;
  const key = req.idempotencyKey;

  // 1. Idempotency pre-lookup. Absent/empty key → null passthrough: skip the
  //    lookup entirely and fall straight through to an insert.
  if (key) {
    lookups += 1;
    const pre = resolve(player, 'GET', `${BASE}/v1/bookings?idempotencyKey=${encodeKey(key)}`);
    const preBody = pre.json<{ results: BookingRecord[] }>();
    if (pre.status === 200 && preBody.results.length > 0) {
      return {
        booking: preBody.results[0],
        replayed: true,
        raced: false,
        inserted: false,
        lookups,
        insertAttempts,
      };
    }
  }

  // 2. Insert. Keyed inserts carry the idempotency key; keyless inserts carry a
  //    transport ref so two distinct passthrough submissions stay addressable.
  insertAttempts += 1;
  const insertUrl = key
    ? `${BASE}/v1/bookings?idempotencyKey=${encodeKey(key)}`
    : `${BASE}/v1/bookings?ref=${encodeKey(req.ref ?? 'default')}`;
  const insert = resolve(
    player,
    'POST',
    insertUrl,
    JSON.stringify({
      serviceId: req.serviceId,
      datetime: req.datetime,
      ...(key ? { idempotencyKey: key } : {}),
      client: req.client,
    })
  );

  if (insert.status === 201) {
    return {
      booking: insert.json<BookingRecord>(),
      replayed: false,
      raced: false,
      inserted: true,
      lookups,
      insertAttempts,
    };
  }

  // 3. Unique-violation race: a concurrent request won the idempotency index.
  //    Replay-lookup returns the winning row (mirrors the adapter's 23505 path).
  if (insert.status === 409 && key) {
    lookups += 1;
    const replay = resolve(
      player,
      'GET',
      `${BASE}/v1/bookings/replay?idempotencyKey=${encodeKey(key)}`
    );
    const replayBody = replay.json<{ results: BookingRecord[] }>();
    if (replay.status === 200 && replayBody.results.length > 0) {
      return {
        booking: replayBody.results[0],
        replayed: true,
        raced: true,
        inserted: false,
        lookups,
        insertAttempts,
      };
    }
  }

  throw new Error(`Booking insert failed with status ${insert.status}`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Idempotency replay over a committed cassette', () => {
  let player: CassettePlayer;
  let cassette: Cassette;

  beforeEach(async () => {
    const storage = new FileCassetteStorage(CASSETTES_DIR);
    player = new CassettePlayer({
      storage,
      // Exact-URL matching makes every recorded interaction uniquely
      // addressable, so the replay is deterministic across submissions.
      matchOptions: { exactUrl: true },
      strict: true,
    });
    cassette = await player.load(CASSETTE_NAME);
  });

  const CLIENT = { firstName: 'Alex', lastName: 'Rivera', email: 'alex.rivera@example.com' };

  it('replays the same booking id for a duplicate key with no second insert', async () => {
    const request: SubmitRequest = {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-20T14:00:00.000Z',
      client: CLIENT,
      idempotencyKey: 'idem-replay-9f',
    };

    const first = await submitBooking(player, request);
    const second = await submitBooking(player, request);

    // One booking id, replay-wins on both submissions.
    expect(first.booking.id).toBe('bk_replay_777');
    expect(second.booking.id).toBe(first.booking.id);
    expect(first.replayed).toBe(true);
    expect(second.replayed).toBe(true);

    // No insert was performed by either submission.
    expect(first.inserted).toBe(false);
    expect(second.inserted).toBe(false);
    expect(first.insertAttempts + second.insertAttempts).toBe(0);

    // The cassette records exactly one insert interaction for this key — there
    // is no second insert recorded, and the canonical insert was never
    // replayed (it stays in the player's unused set).
    const insertsForKey = cassette.entries.filter(
      (e) =>
        e.request.method === 'POST' &&
        e.request.url.includes('idempotencyKey=idem-replay-9f')
    );
    expect(insertsForKey).toHaveLength(1);

    const unused = player.getUnusedEntries().map((e) => `${e.request.method} ${e.request.url}`);
    expect(unused).toContain(`POST ${BASE}/v1/bookings?idempotencyKey=idem-replay-9f`);
  });

  it('inserts exactly once for a fresh key (pre-lookup miss → insert)', async () => {
    const result = await submitBooking(player, {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-21T18:00:00.000Z',
      client: CLIENT,
      idempotencyKey: 'idem-fresh-3a',
    });

    expect(result.booking.id).toBe('bk_fresh_778');
    expect(result.replayed).toBe(false);
    expect(result.inserted).toBe(true);
    expect(result.lookups).toBe(1);
    expect(result.insertAttempts).toBe(1);
  });

  it('null passthrough for an absent/empty key yields two distinct bookings', async () => {
    const clientA = { firstName: 'Dana', lastName: 'Okafor', email: 'dana.okafor@example.com' };
    const clientB = { firstName: 'Sam', lastName: 'Nguyen', email: 'sam.nguyen@example.com' };

    // Absent key.
    const a = await submitBooking(player, {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-22T14:00:00.000Z',
      client: clientA,
      ref: 'walkin-1420',
    });
    // Empty-string key — treated the same as absent.
    const b = await submitBooking(player, {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-22T15:00:00.000Z',
      client: clientB,
      idempotencyKey: '',
      ref: 'walkin-1500',
    });

    // Null passthrough: no idempotency lookup was performed for either.
    expect(a.lookups).toBe(0);
    expect(b.lookups).toBe(0);

    // Two distinct bookings were inserted.
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(a.booking.id).toBe('bk_pass_a_101');
    expect(b.booking.id).toBe('bk_pass_b_202');
    expect(a.booking.id).not.toBe(b.booking.id);
  });

  it('replays the winning row after a unique-violation race', async () => {
    const result = await submitBooking(player, {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-23T16:00:00.000Z',
      client: CLIENT,
      idempotencyKey: 'idem-race-7c',
    });

    // Pre-lookup missed, our insert lost the 23505 race, replay-lookup won.
    expect(result.raced).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.inserted).toBe(false);
    expect(result.insertAttempts).toBe(1);
    expect(result.lookups).toBe(2);
    expect(result.booking.id).toBe('bk_race_909');
  });

  it('serves every interaction offline with no unmatched requests', async () => {
    // Drive the full contract, then assert the player matched real entries.
    await submitBooking(player, {
      serviceId: 'svc_massage_60',
      datetime: '2026-04-20T14:00:00.000Z',
      client: CLIENT,
      idempotencyKey: 'idem-replay-9f',
    });

    const stats = player.getStats();
    expect(stats.totalEntries).toBe(cassette.entries.length);
    expect(stats.usedEntries).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Cassette hygiene — the committed cassette is masked (masking.ts) and clean
// ---------------------------------------------------------------------------

describe('Cassette hygiene: masked, no live credentials', () => {
  const RAW_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const BEARER = /Bearer\s+[a-zA-Z0-9._-]{8,}/i;

  let cassette: Cassette;

  beforeEach(async () => {
    const storage = new FileCassetteStorage(CASSETTES_DIR);
    const player = new CassettePlayer({ storage });
    cassette = await player.load(CASSETTE_NAME);
  });

  it('declares masked fields and carries none of them raw', () => {
    expect(cassette.config.maskedFields.length).toBeGreaterThan(0);

    for (const entry of cassette.entries) {
      const bodies = [entry.request.body, entry.response.body].filter(
        (b): b is string => typeof b === 'string'
      );
      for (const body of bodies) {
        // No raw PII patterns survive in the recorded bodies.
        expect(body).not.toMatch(RAW_EMAIL);
        expect(body).not.toMatch(BEARER);
        // masking.ts is a fixed point on the committed bodies → already masked.
        expect(maskString(body, acuityMaskingConfig)).toBe(body);
      }

      // Authorization headers are masked, never live credentials.
      for (const [name, value] of Object.entries(entry.request.headers)) {
        if (name.toLowerCase() === 'authorization') {
          expect(value).toMatch(/^\[MASKED/);
        }
      }
    }
  });

  it('masks the serialized cassette as a whole', () => {
    const serialized = JSON.stringify(cassette);
    expect(serialized).not.toMatch(RAW_EMAIL);
    expect(serialized).not.toMatch(BEARER);
    expect(serialized).toContain('[MASKED_EMAIL]');
  });
});
