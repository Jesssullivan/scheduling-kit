/**
 * CalDAV busy overlay (TIN-1996, slice 2)
 *
 * Converts external-calendar events — as returned by the optional peer
 * `@tummycrypt/tinyland-caldav-client`'s `CalendarClient` (`queryEvents` /
 * `listEvents`) — into the availability engine's `OccupiedBlock` inputs, so
 * external busy time subtracts from RRULE-expanded availability windows
 * ("windows minus busy", see `./availability-substrate.ts`).
 *
 * Dependency posture (mirrors `./recurrence.ts`):
 * - The peer is loaded lazily via dynamic import only inside
 *   `loadCalDavClient`. Everything else in this module is peer-free: types
 *   are structural (assignable from the peer's `CalendarEvent` without
 *   importing it), and `busyBlocksFromEvents` accepts plain objects, so
 *   consumers can fetch events however they like and kit never hard-requires
 *   the peer.
 * - When the peer is absent, `loadCalDavClient` rejects with an actionable
 *   `CalDavPeerUnavailableError`.
 *
 * Recurring busy events route through the slice-1 expander
 * (`expandRecurrence`), which uses the optional peer
 * `@tummycrypt/tinyland-calendar` for RRULE tokenization and carries the
 * documented workarounds for the verified upstream gaps at
 * tinyland-calendar 0.2.3 (BYDAY, UNTIL, silent-drop parsing — see the
 * `./recurrence.ts` module docs and TIN-1996). RRULEs outside the supported
 * subset throw `UnsupportedRecurrenceError` — an external event we cannot
 * expand faithfully fails loud instead of silently under-blocking (which
 * would risk double-booking).
 *
 * RFC 5545 semantics honored here:
 * - `status: 'cancelled'` events block nothing.
 * - A DATE-TIME `DTSTART` with no `DTEND` is a zero-duration event and
 *   blocks nothing (RFC 5545 §3.6.1).
 * - A DATE-valued (all-day) `DTSTART` with no `DTEND` blocks the whole
 *   calendar day — local to `timezone` when set, UTC otherwise.
 * - A DATE-valued `DTEND` is exclusive (the block ends at local midnight of
 *   that date).
 * - Recurring durations are minute-precision (`Math.ceil`), matching the
 *   expander's `RecurringBlock.durationMinutes` contract; all-day recurring
 *   events use a fixed 24h/day duration, so occurrences that cross a DST
 *   transition may over/under-shoot local midnight by the DST offset.
 *
 * Known upstream gap (documented in the TIN-1996 design spike): at
 * caldav-client 0.2.3, `package.json` omits its `@tummycrypt/tinyland-calendar`
 * type dependency, so kit depends on tinyland-calendar directly rather than
 * relying on transitive resolution. Additionally, whether `queryEvents`'
 * server-side time-range filter matches *recurring masters* that started
 * before the window is server-dependent; `fetchCalDavBusy` pads the query
 * window, and the Xandikos-targeted client already falls back to
 * `listEvents()` on 501/405. For strict servers, fetch with `listEvents()`
 * and hand the events to `busyBlocksFromEvents` directly.
 */

import type { OccupiedBlock } from './availability-engine.js';
import { parseTimeInTz } from './availability-engine.js';
import {
  expandRecurrence,
  type RecurrenceExpansionRange,
  type RecurringBlock,
} from './recurrence.js';

// ---------------------------------------------------------------------------
// Public types (structural — no imports from the optional peers)
// ---------------------------------------------------------------------------

/**
 * Structural subset of `@tummycrypt/tinyland-calendar`'s `CalendarEvent`
 * consumed by the busy overlay. A real `CalendarEvent` is assignable as-is.
 */
export interface CalDavBusyEvent {
  /** iCalendar UID, used only for error context. */
  uid?: string;
  /** ISO 8601 instant, or YYYY-MM-DD for all-day events. */
  dtstart: string;
  /** ISO 8601 instant, or YYYY-MM-DD (exclusive) for all-day events. */
  dtend?: string;
  /** IANA timezone for wall-clock recurrence + all-day day bounds. */
  timezone?: string;
  /** Events with status `'cancelled'` block nothing. */
  status?: string;
  /** RFC 5545 RRULE; when present the event expands as recurring busy. */
  rrule?: string;
  /** Occurrence exdates (ISO instants or YYYY-MM-DD dates). */
  exdates?: string[];
}

/** Filters accepted by `CalDavBusySource.queryEvents` (subset of the peer's `EventFilters`). */
export interface CalDavBusyQuery {
  from?: string;
  to?: string;
}

/**
 * Structural slice of the peer's `CalendarClient` needed for the busy
 * overlay. A real `CalendarClient` satisfies it; tests inject fakes.
 */
export interface CalDavBusySource {
  queryEvents(filters?: CalDavBusyQuery): Promise<CalDavBusyEvent[]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The optional peer `@tummycrypt/tinyland-caldav-client` could not be loaded. */
export class CalDavPeerUnavailableError extends Error {
  readonly code = 'CALDAV_PEER_UNAVAILABLE';

  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      'loadCalDavClient requires the optional peer dependency ' +
        '@tummycrypt/tinyland-caldav-client (^0.2.3). Install it alongside ' +
        '@tummycrypt/scheduling-kit to use the ./caldav subpath ' +
        `(e.g. \`pnpm add @tummycrypt/tinyland-caldav-client\`). Cause: ${message}`,
    );
    this.name = 'CalDavPeerUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Optional peer loading
// ---------------------------------------------------------------------------

/**
 * Lazily load the optional peer and construct a per-instance
 * `CalendarClient` (preferred over the peer's module-global `configure()`
 * singleton; note the peer only supports a global `calendarPath` today —
 * upstream constructor param tracked in TIN-1996).
 */
export const loadCalDavClient = async (
  baseUrl?: string,
): Promise<CalDavBusySource> => {
  try {
    const mod = await import('@tummycrypt/tinyland-caldav-client');
    return new mod.CalendarClient(baseUrl);
  } catch (error) {
    throw new CalDavPeerUnavailableError(error);
  }
};

// ---------------------------------------------------------------------------
// Range + interval helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Slack applied around the requested range: one-off blocks and query windows
 * keep a full day of margin so timezone offsets (±14h) between the engine's
 * business timezone and UTC range bounds never drop an edge block. Extra
 * blocks outside the range are harmless — `hasOverlap` compares instants.
 */
const RANGE_SLACK_MS = DAY_MS;

interface RangeBounds {
  startMs: number;
  endMs: number;
}

const rangeBounds = (range: RecurrenceExpansionRange): RangeBounds => {
  const startMs = DATE_ONLY.test(range.start)
    ? Date.parse(`${range.start}T00:00:00.000Z`)
    : Date.parse(range.start);
  const endMs = DATE_ONLY.test(range.end)
    ? Date.parse(`${range.end}T23:59:59.999Z`)
    : Date.parse(range.end);
  if (Number.isNaN(startMs)) {
    throw new Error(`range.start is not a parseable date: "${range.start}"`);
  }
  if (Number.isNaN(endMs)) {
    throw new Error(`range.end is not a parseable date: "${range.end}"`);
  }
  if (endMs < startMs) {
    throw new Error(
      `range.end (${range.end}) precedes range.start (${range.start})`,
    );
  }
  return { startMs, endMs };
};

const nextDateStr = (dateStr: string): string =>
  new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);

/** Local (or UTC) midnight instant of a YYYY-MM-DD date. */
const midnightInstant = (dateStr: string, tz: string | undefined): Date =>
  tz ? parseTimeInTz(dateStr, '00:00', tz) : new Date(`${dateStr}T00:00:00.000Z`);

interface EventInterval {
  start: Date;
  end: Date;
}

/**
 * Resolve an event's first-occurrence interval. Returns `undefined` for
 * zero-duration events (they block nothing); throws on unparseable or
 * inverted data — corrupt busy input fails loud rather than silently
 * showing a slot as free.
 */
const eventInterval = (event: CalDavBusyEvent): EventInterval | undefined => {
  const label = event.uid ? `CalDAV event ${event.uid}` : 'CalDAV event';
  const allDay = DATE_ONLY.test(event.dtstart);

  const start = allDay
    ? midnightInstant(event.dtstart, event.timezone)
    : new Date(event.dtstart);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`${label} has an unparseable dtstart: "${event.dtstart}"`);
  }

  let end: Date;
  if (event.dtend === undefined) {
    if (!allDay) return undefined; // RFC 5545: zero-duration, blocks nothing
    end = midnightInstant(nextDateStr(event.dtstart), event.timezone);
  } else if (DATE_ONLY.test(event.dtend)) {
    // DATE-valued DTEND is exclusive: the block ends at its local midnight.
    end = midnightInstant(event.dtend, event.timezone);
  } else {
    end = new Date(event.dtend);
  }
  if (Number.isNaN(end.getTime())) {
    throw new Error(`${label} has an unparseable dtend: "${event.dtend}"`);
  }

  if (end.getTime() < start.getTime()) {
    throw new Error(
      `${label} ends before it starts (dtstart ${event.dtstart}, dtend ${event.dtend})`,
    );
  }
  if (end.getTime() === start.getTime()) return undefined;

  return { start, end };
};

// ---------------------------------------------------------------------------
// Busy conversion
// ---------------------------------------------------------------------------

/**
 * Convert external-calendar events into `OccupiedBlock`s relevant to an
 * inclusive range (each bound a YYYY-MM-DD date or ISO instant).
 *
 * One-off events keep their exact interval; recurring events (any with an
 * `rrule`) expand through the slice-1 recurrence walker, honoring
 * `timezone` wall-clock semantics and `exdates`. The expansion window is
 * widened by the longest recurring duration plus a day of slack so
 * occurrences that start before the range but spill into it are kept.
 *
 * Loads the optional peer `@tummycrypt/tinyland-calendar` only when at
 * least one recurring event is present (via `expandRecurrence`).
 */
export const busyBlocksFromEvents = async (
  events: readonly CalDavBusyEvent[],
  range: RecurrenceExpansionRange,
): Promise<OccupiedBlock[]> => {
  const { startMs, endMs } = rangeBounds(range);

  const oneOff: OccupiedBlock[] = [];
  const recurring: RecurringBlock[] = [];
  let maxRecurringDurationMs = 0;

  for (const event of events) {
    if (event.status === 'cancelled') continue;

    const interval = eventInterval(event);
    if (!interval) continue;

    const rrule = event.rrule?.trim();
    if (rrule) {
      const durationMinutes = Math.ceil(
        (interval.end.getTime() - interval.start.getTime()) / MINUTE_MS,
      );
      maxRecurringDurationMs = Math.max(
        maxRecurringDurationMs,
        durationMinutes * MINUTE_MS,
      );
      recurring.push({
        rrule,
        dtstart: interval.start.toISOString(),
        durationMinutes,
        timezone: event.timezone,
        exdates: event.exdates,
      });
    } else if (
      interval.end.getTime() > startMs - RANGE_SLACK_MS &&
      interval.start.getTime() < endMs + RANGE_SLACK_MS
    ) {
      oneOff.push({ start: interval.start, end: interval.end });
    }
  }

  let expanded: OccupiedBlock[] = [];
  if (recurring.length > 0) {
    const expansionRange: RecurrenceExpansionRange = {
      start: new Date(
        startMs - RANGE_SLACK_MS - maxRecurringDurationMs,
      ).toISOString(),
      end: new Date(endMs + RANGE_SLACK_MS).toISOString(),
    };
    ({ occupied: expanded } = await expandRecurrence(
      { blocks: recurring },
      expansionRange,
    ));
  }

  return [...oneOff, ...expanded].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
};

/**
 * Fetch busy blocks for a range from a CalDAV source (`CalendarClient` or
 * anything structurally compatible). The `queryEvents` window is padded by
 * a day on each side; conversion re-filters, so servers that ignore the
 * filter (the client falls back to `listEvents()` on 501/405) only cost
 * extra harmless blocks.
 */
export const fetchCalDavBusy = async (
  source: CalDavBusySource,
  range: RecurrenceExpansionRange,
): Promise<OccupiedBlock[]> => {
  const { startMs, endMs } = rangeBounds(range);
  const events = await source.queryEvents({
    from: new Date(startMs - RANGE_SLACK_MS).toISOString(),
    to: new Date(endMs + RANGE_SLACK_MS).toISOString(),
  });
  return busyBlocksFromEvents(events, range);
};
