/**
 * Availability snapshot freshness attribution tests (TIN-945 row 3).
 *
 * The ledger row: cold Acuity/CalDAV reads run 7–15s vs 1–2ms cache hits, so
 * a consumer caching the availability path needs freshness + cold-read-cost
 * metadata to attribute the cost and decide whether to reuse. These are the
 * acceptance tests for `getAvailabilitySnapshot` and its reuse predicates,
 * layered over the same substrate path #114 landed (`getSubstrateAvailability`).
 *
 * Calendar facts reused from availability-substrate.test.ts (verified):
 *   - 2026-06-01 Mon, 2026-06-03 Wed, 2026-06-05 Fri; June 2026 is EDT.
 *
 * The engine's Date is frozen (as in the sibling suite) so slot generation is
 * deterministic; the snapshot's own clock is injected via `policy.now`, kept
 * independent so cold-read timing is controlled without moving engine time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlotConfig } from '../availability-engine.js';
import {
  getAvailabilitySnapshot,
  getSubstrateAvailability,
  isSnapshotExpired,
  isSnapshotReusable,
  isSnapshotStale,
} from '../availability-substrate.js';

const FROZEN_NOW = new Date('2026-05-01T00:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const CONFIG: SlotConfig = {
  duration: 60,
  interval: 60,
  buffer: 0,
  minAdvanceHours: 0,
  timezone: 'UTC',
};

/** Mon/Wed/Fri 09:00–12:00 window (three 60-minute slots per day). */
const MWF_HOURS = [
  {
    rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
    dtstart: '2026-06-01',
    window: { opens: '09:00', closes: '12:00' },
  },
];

const WEEK = { start: '2026-06-01', end: '2026-06-05' };

const MINUTE = 60_000;
/** The instant the injected read "completes" — aligned to the frozen engine clock. */
const OBSERVED = FROZEN_NOW.getTime();

/** A clock stub returning each queued value on successive calls, holding the last. */
const clockOf = (...valuesMs: number[]): (() => number) => {
  let i = 0;
  return () => {
    const value = valuesMs[Math.min(i, valuesMs.length - 1)]!;
    i += 1;
    return value;
  };
};

describe('getAvailabilitySnapshot — fresh snapshot stamping', () => {
  it('reports observedAt at read completion and derives staleAt/expiresAt from the policy', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
      staleAfterMs: 5 * MINUTE,
      expiresAfterMs: 15 * MINUTE,
      now: () => OBSERVED,
    });

    expect(snap.freshness.observedAt).toBe(new Date(OBSERVED).toISOString());
    expect(snap.freshness.staleAt).toBe(new Date(OBSERVED + 5 * MINUTE).toISOString());
    expect(snap.freshness.expiresAt).toBe(new Date(OBSERVED + 15 * MINUTE).toISOString());

    // A just-observed snapshot is neither stale nor expired.
    expect(isSnapshotStale(snap, OBSERVED)).toBe(false);
    expect(isSnapshotExpired(snap, OBSERVED)).toBe(false);
    expect(isSnapshotReusable(snap, OBSERVED)).toBe(true);
  });

  it('passes the days payload through unchanged from getSubstrateAvailability', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
      staleAfterMs: MINUTE,
      expiresAfterMs: 2 * MINUTE,
      now: () => OBSERVED,
    });
    const direct = await getSubstrateAvailability({ hours: MWF_HOURS }, WEEK, CONFIG);

    expect(snap.days).toEqual(direct);
    expect(snap.days.map((d) => d.date)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
  });
});

describe('getAvailabilitySnapshot — cold-read cost attribution', () => {
  it('attributes a cold read: readMs is the elapsed clock across the read', async () => {
    // Clock advances 8_000ms between read start and completion — a cold Acuity read.
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
      staleAfterMs: MINUTE,
      expiresAfterMs: 2 * MINUTE,
      now: clockOf(OBSERVED, OBSERVED + 8_000),
    });

    expect(snap.freshness.readMs).toBe(8_000);
    // observedAt is stamped at completion, not start.
    expect(snap.freshness.observedAt).toBe(new Date(OBSERVED + 8_000).toISOString());
    expect(snap.freshness.staleAt).toBe(new Date(OBSERVED + 8_000 + MINUTE).toISOString());
  });

  it('attributes a warm serve: readMs is 0 when the clock does not advance', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
      staleAfterMs: MINUTE,
      expiresAfterMs: 2 * MINUTE,
      now: () => OBSERVED,
    });

    expect(snap.freshness.readMs).toBe(0);
  });
});

describe('isSnapshotStale — staleAt bounds freshness', () => {
  const freshPolicy = {
    staleAfterMs: 5 * MINUTE,
    expiresAfterMs: 15 * MINUTE,
    now: () => OBSERVED,
  };

  it('is fresh up to and at staleAt, stale strictly after (matches core/cache.ts)', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, freshPolicy);
    const staleAt = OBSERVED + 5 * MINUTE;

    expect(isSnapshotStale(snap, staleAt - 1)).toBe(false);
    expect(isSnapshotStale(snap, staleAt)).toBe(false);
    expect(isSnapshotStale(snap, staleAt + 1)).toBe(true);
  });
});

describe('isSnapshotExpired / isSnapshotReusable — expiresAt bounds reuse', () => {
  const freshPolicy = {
    staleAfterMs: 5 * MINUTE,
    expiresAfterMs: 15 * MINUTE,
    now: () => OBSERVED,
  };

  it('stays reusable through expiresAt and must not be reused strictly after', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, freshPolicy);
    const expiresAt = OBSERVED + 15 * MINUTE;

    expect(isSnapshotExpired(snap, expiresAt)).toBe(false);
    expect(isSnapshotReusable(snap, expiresAt)).toBe(true);

    expect(isSnapshotExpired(snap, expiresAt + 1)).toBe(true);
    expect(isSnapshotReusable(snap, expiresAt + 1)).toBe(false);
  });

  it('is stale yet still reusable between staleAt and expiresAt', async () => {
    const snap = await getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, freshPolicy);
    const between = OBSERVED + 10 * MINUTE; // past staleAt (5m), before expiresAt (15m)

    expect(isSnapshotStale(snap, between)).toBe(true);
    expect(isSnapshotReusable(snap, between)).toBe(true);
  });
});

describe('getAvailabilitySnapshot — fail-loud policy validation', () => {
  it('rejects an expiry that precedes staleness', async () => {
    await expect(
      getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
        staleAfterMs: 10 * MINUTE,
        expiresAfterMs: 5 * MINUTE,
        now: () => OBSERVED,
      }),
    ).rejects.toThrow(/cannot expire before it goes stale/);
  });

  it('rejects a negative staleAfterMs', async () => {
    await expect(
      getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
        staleAfterMs: -1,
        expiresAfterMs: 5 * MINUTE,
        now: () => OBSERVED,
      }),
    ).rejects.toThrow(/staleAfterMs must be a non-negative/);
  });

  it('rejects a non-finite expiresAfterMs', async () => {
    await expect(
      getAvailabilitySnapshot({ hours: MWF_HOURS }, WEEK, CONFIG, {
        staleAfterMs: MINUTE,
        expiresAfterMs: Number.POSITIVE_INFINITY,
        now: () => OBSERVED,
      }),
    ).rejects.toThrow(/expiresAfterMs must be a non-negative/);
  });
});
