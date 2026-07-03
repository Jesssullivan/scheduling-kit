/**
 * Availability substrate (TIN-1996, slice 2): RRULE windows minus busy.
 *
 * The first real availability path over the substrate modules: RRULE-backed
 * recurring availability windows (expanded by `./recurrence.ts` via the
 * optional peer `@tummycrypt/tinyland-calendar`) minus a CalDAV busy overlay
 * (`./caldav-busy.ts`, events from the optional peer
 * `@tummycrypt/tinyland-caldav-client` or any structural equivalent).
 *
 * The availability engine stays pure and untouched: this module only
 * composes `expandRecurrence` + `busyBlocksFromEvents` into the engine's
 * existing inputs and calls `getAvailableSlots` per window date.
 */

import {
  getAvailableSlots,
  type GeneratedSlot,
  type HoursWindow,
  type OccupiedBlock,
  type SlotConfig,
} from './availability-engine.js';
import {
  busyBlocksFromEvents,
  fetchCalDavBusy,
  type CalDavBusyEvent,
  type CalDavBusySource,
} from './caldav-busy.js';
import {
  expandRecurrence,
  type RecurrenceExpansionRange,
  type RecurringBlock,
  type RecurringHoursRule,
} from './recurrence.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AvailabilitySubstrate {
  /** RRULE-backed recurring availability windows (the only hours source). */
  hours: RecurringHoursRule[];
  /** Recurring in-house closures/blocks (expanded to busy time). */
  blocks?: RecurringBlock[];
  /** Pre-fetched external-calendar events overlaid as busy time. */
  busyEvents?: CalDavBusyEvent[];
  /** CalDAV source queried for additional busy events over the range. */
  busySource?: CalDavBusySource;
  /** Already-materialized occupied blocks (bookings, holds, reservations). */
  occupied?: OccupiedBlock[];
}

export interface SubstrateDayAvailability {
  /** Window date (YYYY-MM-DD). */
  date: string;
  /** Effective hours window for the date. */
  window: HoursWindow;
  /** Available slots after subtracting every busy input (may be empty). */
  slots: GeneratedSlot[];
}

// ---------------------------------------------------------------------------
// Windows minus busy
// ---------------------------------------------------------------------------

/**
 * Compute per-date availability over an inclusive range: expand the
 * substrate's RRULE windows into date-specific hours, union every busy
 * input (recurring blocks, external-calendar events, materialized
 * occupied blocks), and generate slots for each window date.
 *
 * Returns one entry per date that has an availability window, in date
 * order, including dates whose slots were fully consumed by busy time
 * (empty `slots`). Dates without a window are omitted (closed).
 *
 * When multiple hours rules land on the same date, the first rule's window
 * wins — the same `overrides.find(...)` semantics the engine's
 * `getDatesWithAvailability` applies.
 *
 * The optional peers load lazily: `@tummycrypt/tinyland-calendar` on first
 * RRULE expansion (rejecting with `RecurrencePeerUnavailableError` when
 * absent), and the CalDAV peer never — `busySource` is injected, so any
 * structurally compatible client works. `busySource` is only queried when
 * at least one window date exists in the range.
 */
export const getSubstrateAvailability = async (
  substrate: AvailabilitySubstrate,
  range: RecurrenceExpansionRange,
  config: SlotConfig,
): Promise<SubstrateDayAvailability[]> => {
  const { overrides, occupied: recurringBusy } = await expandRecurrence(
    { hours: substrate.hours, blocks: substrate.blocks },
    range,
  );
  if (overrides.length === 0) return [];

  const eventBusy = substrate.busyEvents?.length
    ? await busyBlocksFromEvents(substrate.busyEvents, range)
    : [];
  const fetchedBusy = substrate.busySource
    ? await fetchCalDavBusy(substrate.busySource, range)
    : [];

  const occupied: OccupiedBlock[] = [
    ...recurringBusy,
    ...eventBusy,
    ...fetchedBusy,
    ...(substrate.occupied ?? []),
  ];

  const seen = new Set<string>();
  const days: SubstrateDayAvailability[] = [];
  for (const override of overrides) {
    if (seen.has(override.date)) continue; // first rule wins per engine semantics
    seen.add(override.date);
    if (override.opens === null || override.closes === null) continue; // unreachable for expanded windows
    const window: HoursWindow = {
      opens: override.opens,
      closes: override.closes,
    };
    days.push({
      date: override.date,
      window,
      slots: getAvailableSlots(override.date, null, override, occupied, config),
    });
  }
  return days;
};

// ---------------------------------------------------------------------------
// Snapshot freshness attribution (TIN-945 row 3)
// ---------------------------------------------------------------------------

/**
 * Freshness + cost metadata carried alongside a materialized availability
 * read so a consumer that caches the result can attribute cold-read cost
 * (a fresh Acuity/CalDAV read is 7–15s vs a 1–2ms cache hit — TIN-945 row 3)
 * and reason about reuse without instrumenting the read site itself.
 *
 * All instants are ISO 8601 strings for wire/JSON parity with the rest of
 * the kit's public surface (bookings, soft holds, payment intents).
 */
export interface AvailabilityFreshness {
  /** ISO instant the underlying read completed — when the data was observed. */
  observedAt: string;
  /**
   * ISO instant after which the snapshot is stale and SHOULD be refreshed.
   * Soft bound: a stale snapshot is still reusable, but a consumer that can
   * afford a refresh should take one.
   */
  staleAt: string;
  /**
   * ISO instant after which the snapshot MUST NOT be reused. Hard bound:
   * past this point a consumer must re-read rather than serve the cache.
   */
  expiresAt: string;
  /**
   * Wall-clock cost of the underlying read, in whole milliseconds. Lets a
   * consumer attribute a cold read (a fresh substrate/Acuity/CalDAV fetch)
   * apart from a warm serve without wrapping the read site in its own timer.
   */
  readMs: number;
}

/**
 * A materialized availability read plus its freshness/cost metadata. The
 * `days` payload is exactly what {@link getSubstrateAvailability} returns —
 * the snapshot wraps that path rather than reshaping it, so nothing
 * downstream of the days array changes.
 */
export interface AvailabilitySnapshot {
  /** Per-date availability (windows minus busy), unchanged from getSubstrateAvailability. */
  days: SubstrateDayAvailability[];
  /** Cold-read cost + staleness attribution for cache-reuse decisions. */
  freshness: AvailabilityFreshness;
}

/**
 * How long a snapshot stays fresh, then reusable. Both durations are
 * measured from `observedAt` (read completion), in milliseconds.
 */
export interface SnapshotFreshnessPolicy {
  /** ms after observedAt at which the snapshot goes stale (soft refresh). */
  staleAfterMs: number;
  /**
   * ms after observedAt at which the snapshot expires (hard, no reuse).
   * Must be >= staleAfterMs — a snapshot cannot expire before it goes stale.
   */
  expiresAfterMs: number;
  /**
   * Injectable clock (ms since epoch), defaulting to `Date.now`. Tests pin
   * it to make cold-read timing and staleness deterministic; a caller can
   * also supply a monotonic source.
   */
  now?: () => number;
}

/**
 * Materialize availability over the substrate and stamp it with freshness
 * and cold-read-cost metadata (TIN-945 row 3).
 *
 * This is a thin wrapper over {@link getSubstrateAvailability}: it times the
 * read with the policy clock, records `observedAt` at read completion, and
 * derives `staleAt`/`expiresAt` from the policy durations. The `days` payload
 * is passed through untouched, so this composes the existing availability
 * path instead of forking it.
 *
 * Fails loud on an incoherent policy (negative durations, or an expiry that
 * precedes staleness) rather than emitting a snapshot that can never be
 * trusted — matching the substrate's fail-closed posture.
 */
export const getAvailabilitySnapshot = async (
  substrate: AvailabilitySubstrate,
  range: RecurrenceExpansionRange,
  config: SlotConfig,
  policy: SnapshotFreshnessPolicy,
): Promise<AvailabilitySnapshot> => {
  if (!Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) {
    throw new Error(
      `SnapshotFreshnessPolicy.staleAfterMs must be a non-negative finite number, got ${policy.staleAfterMs}`,
    );
  }
  if (!Number.isFinite(policy.expiresAfterMs) || policy.expiresAfterMs < 0) {
    throw new Error(
      `SnapshotFreshnessPolicy.expiresAfterMs must be a non-negative finite number, got ${policy.expiresAfterMs}`,
    );
  }
  if (policy.expiresAfterMs < policy.staleAfterMs) {
    throw new Error(
      `SnapshotFreshnessPolicy.expiresAfterMs (${policy.expiresAfterMs}) must be >= ` +
        `staleAfterMs (${policy.staleAfterMs}); a snapshot cannot expire before it goes stale`,
    );
  }

  const now = policy.now ?? Date.now;
  const startedMs = now();
  const days = await getSubstrateAvailability(substrate, range, config);
  const observedMs = now();

  return {
    days,
    freshness: {
      observedAt: new Date(observedMs).toISOString(),
      staleAt: new Date(observedMs + policy.staleAfterMs).toISOString(),
      expiresAt: new Date(observedMs + policy.expiresAfterMs).toISOString(),
      readMs: Math.max(0, observedMs - startedMs),
    },
  };
};

/**
 * Whether the snapshot is past its soft freshness bound at `nowMs` (default:
 * the real clock). Stale snapshots remain reusable — this only signals that
 * a refresh is warranted. Strictly-after semantics match `core/cache.ts`.
 */
export const isSnapshotStale = (
  snapshot: AvailabilitySnapshot,
  nowMs: number = Date.now(),
): boolean => nowMs > Date.parse(snapshot.freshness.staleAt);

/**
 * Whether the snapshot is past its hard reuse bound at `nowMs` (default: the
 * real clock). An expired snapshot MUST be re-read rather than served.
 */
export const isSnapshotExpired = (
  snapshot: AvailabilitySnapshot,
  nowMs: number = Date.now(),
): boolean => nowMs > Date.parse(snapshot.freshness.expiresAt);

/**
 * Whether the snapshot may still be served at `nowMs` — i.e. it has not
 * expired. The single reuse gate a cache should consult: `expiresAt` bounds
 * reuse, `staleAt` only advises a refresh.
 */
export const isSnapshotReusable = (
  snapshot: AvailabilitySnapshot,
  nowMs: number = Date.now(),
): boolean => !isSnapshotExpired(snapshot, nowMs);
