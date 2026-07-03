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
