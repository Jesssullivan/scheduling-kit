/**
 * Recurrence Pre-Pass (TIN-1996, slice 1)
 *
 * Expands RFC 5545 recurrence rules into the availability engine's existing
 * input types (`HoursOverride`, `OccupiedBlock`). The engine stays pure and
 * date-local: recurrence never enters slot math. Feed the outputs of
 * `expandRecurrence` straight into `getAvailableSlots` / `isSlotAvailable` /
 * `getDatesWithAvailability` — their signatures are untouched.
 *
 * RRULE parsing is delegated to the optional peer dependency
 * `@tummycrypt/tinyland-calendar` (`RecurrenceEngine.parseRRule`), loaded
 * lazily via dynamic import — the same posture as the HomegrownAdapter's
 * legacy auth-pg schema fallback. When the peer is not installed,
 * `expandRecurrence` rejects with an actionable
 * `RecurrencePeerUnavailableError` (and still resolves for empty rule sets,
 * which never touch the peer).
 *
 * The occurrence walk is implemented locally, NOT via the peer's
 * `RecurrenceEngine.generateOccurrences`. Verified upstream gaps at
 * tinyland-calendar 0.2.3 (see TIN-1996 for the upstream issues):
 *
 * 1. `expandPattern` (the private walk behind `generateOccurrences`) ignores
 *    `BYDAY` entirely — `FREQ=WEEKLY;BYDAY=MO,WE,FR` steps 7 days from
 *    DTSTART and emits one occurrence per week on DTSTART's weekday.
 * 2. `parseRRule` parses `UNTIL` with `new Date('YYYYMMDDTHHMMSSZ')`, which
 *    yields an Invalid Date for the RFC 5545 compact form, after which
 *    `UNTIL` is silently never enforced.
 * 3. `parseRRule` maps a missing or unrecognized `FREQ` to `daily` instead
 *    of rejecting, and silently drops tokens it does not know.
 *
 * We therefore use `parseRRule` for tokenization, re-normalize `UNTIL`
 * locally, scan the raw RRULE for tokens outside the supported subset, and
 * run a local walk that throws `UnsupportedRecurrenceError` for anything it
 * cannot expand faithfully (BYSETPOS, BYMONTH, ordinal BYDAY, BYDAY with
 * MONTHLY/YEARLY, negative BYMONTHDAY, non-Monday WKST, sub-daily
 * frequencies, …) rather than shipping wrong recurrence math. Once upstream
 * exposes a correct `expandPattern(pattern, dtstart, rangeStart, rangeEnd)`,
 * the walk here can be swapped for it.
 *
 * Supported subset: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT,
 * UNTIL (compact or ISO form, treated as UTC), BYDAY without ordinals for
 * DAILY (filter) and WEEKLY (expansion), positive BYMONTHDAY for MONTHLY,
 * WKST=MO, and EXDATE via the `exdates` fields. COUNT counts occurrences
 * from DTSTART (occurrences before the requested range still consume it);
 * EXDATE removes instances after COUNT is applied, per RFC 5545.
 */

import type {
  HoursOverride,
  HoursWindow,
  OccupiedBlock,
} from './availability-engine.js';
import { parseTimeInTz } from './availability-engine.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A recurring business-hours rule, expanded into `HoursOverride`s. */
export interface RecurringHoursRule {
  /** RFC 5545 RRULE, with or without the leading `RRULE:` prefix. */
  rrule: string;
  /** Anchor date of the first occurrence (YYYY-MM-DD). */
  dtstart: string;
  /** Hours applied on each occurrence date. */
  window: HoursWindow;
  /** Occurrence dates to skip (YYYY-MM-DD). */
  exdates?: string[];
}

/** A recurring occupied block (recurring appointment, recurring closure). */
export interface RecurringBlock {
  /** RFC 5545 RRULE, with or without the leading `RRULE:` prefix. */
  rrule: string;
  /** ISO 8601 start of the first occurrence. */
  dtstart: string;
  /** Duration of each occurrence in minutes. */
  durationMinutes: number;
  /**
   * IANA timezone (e.g. `America/New_York`). When set, every occurrence
   * keeps DTSTART's wall-clock time-of-day in this zone across DST
   * transitions (RFC 5545 TZID semantics, minute precision). When unset,
   * occurrences keep DTSTART's UTC time-of-day (fixed UTC cadence).
   */
  timezone?: string;
  /**
   * Occurrences to skip: exact ISO 8601 instants, or YYYY-MM-DD dates
   * (drops every occurrence on that calendar date — local date when
   * `timezone` is set, UTC date otherwise).
   */
  exdates?: string[];
}

export interface RecurrenceExpansionInput {
  hours?: RecurringHoursRule[];
  blocks?: RecurringBlock[];
}

/**
 * Inclusive expansion range. Each bound is either a YYYY-MM-DD date
 * (interpreted as the full UTC day) or an ISO 8601 instant.
 */
export interface RecurrenceExpansionRange {
  start: string;
  end: string;
}

export interface RecurrenceExpansion {
  /** Date-specific hours, sorted by date. Later rules append; no dedup. */
  overrides: HoursOverride[];
  /** Occupied blocks, sorted by start. */
  occupied: OccupiedBlock[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The optional peer `@tummycrypt/tinyland-calendar` could not be loaded. */
export class RecurrencePeerUnavailableError extends Error {
  readonly code = 'RECURRENCE_PEER_UNAVAILABLE';

  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      'expandRecurrence requires the optional peer dependency ' +
        '@tummycrypt/tinyland-calendar (^0.2.3). Install it alongside ' +
        '@tummycrypt/scheduling-kit to use the ./recurrence subpath ' +
        `(e.g. \`pnpm add @tummycrypt/tinyland-calendar\`). Cause: ${message}`,
    );
    this.name = 'RecurrencePeerUnavailableError';
  }
}

/**
 * The RRULE uses a construct the slice-1 walk cannot expand faithfully.
 * Thrown instead of silently mis-expanding (see module docs for the
 * supported subset and the upstream fidelity gaps).
 */
export class UnsupportedRecurrenceError extends Error {
  readonly code = 'RECURRENCE_UNSUPPORTED';
  readonly rrule: string;

  constructor(detail: string, rrule: string) {
    super(
      `Unsupported recurrence construct in "${rrule}": ${detail}. ` +
        'See @tummycrypt/scheduling-kit/recurrence module docs for the ' +
        'supported RFC 5545 subset (TIN-1996).',
    );
    this.name = 'UnsupportedRecurrenceError';
    this.rrule = rrule;
  }
}

// ---------------------------------------------------------------------------
// Optional peer loading (mirrors HomegrownAdapter's auth-pg fallback)
// ---------------------------------------------------------------------------

interface PeerRecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  count?: number;
  until?: Date;
  byDay?: string[];
  byMonth?: number[];
  byMonthDay?: number[];
  bySetPos?: number;
}

type RRuleParser = (rrule: string) => PeerRecurrencePattern;

let parserPromise: Promise<RRuleParser> | undefined;

const loadRRuleParser = async (): Promise<RRuleParser> => {
  try {
    const mod = await import('@tummycrypt/tinyland-calendar');
    const engine = new mod.RecurrenceEngine();
    return (rrule: string) => engine.parseRRule(rrule) as PeerRecurrencePattern;
  } catch (error) {
    throw new RecurrencePeerUnavailableError(error);
  }
};

// ---------------------------------------------------------------------------
// Date helpers (pure UTC calendar math — no DST in UTC)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Hard cap on candidate occurrences scanned per rule (~27 years daily). */
const MAX_OCCURRENCE_SCAN = 10_000;

const parseDateOnly = (value: string, label: string): Date => {
  const m = DATE_ONLY.exec(value);
  if (!m) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got "${value}"`);
  }
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date: "${value}"`);
  }
  return date;
};

const parseInstant = (value: string, label: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a parseable ISO 8601 value: "${value}"`);
  }
  return date;
};

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/** Wall-clock date + HH:MM of an instant in an IANA timezone. */
const wallClockInTz = (
  instant: Date,
  tz: string,
): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
};

// ---------------------------------------------------------------------------
// RRULE normalization
// ---------------------------------------------------------------------------

/** JS UTC day numbers, indexed to match `Date#getUTCDay()`. */
const DAY_CODE_TO_NUMBER: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const SUPPORTED_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const SUPPORTED_KEYS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'WKST',
]);

interface NormalizedUntil {
  /** Inclusive cutoff instant (UTC ms). */
  ms: number;
  /** UTC date of the cutoff (YYYY-MM-DD), inclusive for date-typed walks. */
  dateStr: string;
  /** True when UNTIL carried no time component. */
  dateOnly: boolean;
}

interface WalkPattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  count?: number;
  until?: NormalizedUntil;
  /** JS UTC day numbers (validated, no ordinals). */
  byDay?: number[];
  /** Sorted, deduplicated positive month days. */
  byMonthDay?: number[];
}

const stripRRulePrefix = (rrule: string): string =>
  rrule.replace(/^RRULE:/i, '').trim();

/**
 * Reject any raw token outside the supported subset. Mandatory because the
 * peer's `parseRRule` silently drops tokens it does not recognize
 * (BYSETPOS aside) and defaults unknown FREQ to daily.
 */
const scanRawTokens = (rrule: string): void => {
  const body = stripRRulePrefix(rrule);
  if (!body) throw new UnsupportedRecurrenceError('empty RRULE', rrule);
  let freqSeen = false;
  for (const part of body.split(';')) {
    if (!part) continue;
    const [rawKey, rawValue] = part.split('=');
    const key = (rawKey ?? '').trim().toUpperCase();
    const value = (rawValue ?? '').trim().toUpperCase();
    if (!key || !rawValue) {
      throw new UnsupportedRecurrenceError(`malformed token "${part}"`, rrule);
    }
    if (!SUPPORTED_KEYS.has(key)) {
      throw new UnsupportedRecurrenceError(`token ${key} is not supported`, rrule);
    }
    if (key === 'FREQ') {
      freqSeen = true;
      if (!SUPPORTED_FREQ.has(value)) {
        throw new UnsupportedRecurrenceError(
          `FREQ=${value} is not supported (sub-daily frequencies excluded)`,
          rrule,
        );
      }
    }
    if (key === 'WKST' && value !== 'MO') {
      throw new UnsupportedRecurrenceError(
        `WKST=${value} is not supported (only the RFC default MO)`,
        rrule,
      );
    }
  }
  if (!freqSeen) {
    throw new UnsupportedRecurrenceError('missing FREQ', rrule);
  }
};

/**
 * Normalize UNTIL from the raw RRULE. The peer parses UNTIL with
 * `new Date()`, which cannot read the RFC 5545 compact forms
 * (`YYYYMMDD`, `YYYYMMDDTHHMMSSZ`) — upstream gap #2.
 */
const normalizeUntil = (
  rrule: string,
  peerUntil: Date | undefined,
): NormalizedUntil | undefined => {
  const m = /(?:^|;)UNTIL=([^;]+)/i.exec(stripRRulePrefix(rrule));
  if (!m) return undefined;
  const token = m[1].trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(
    token,
  );
  if (compact) {
    const [, y, mo, d, hh, mi, ss] = compact;
    const dateOnly = hh === undefined;
    const ms = dateOnly
      ? Date.UTC(Number(y), Number(mo) - 1, Number(d))
      : Date.UTC(
          Number(y),
          Number(mo) - 1,
          Number(d),
          Number(hh),
          Number(mi),
          Number(ss),
        );
    if (Number.isNaN(ms)) {
      throw new UnsupportedRecurrenceError(`invalid UNTIL "${token}"`, rrule);
    }
    return { ms, dateStr: `${y}-${mo}-${d}`, dateOnly };
  }
  const fallback =
    peerUntil && !Number.isNaN(peerUntil.getTime())
      ? peerUntil
      : new Date(token);
  if (Number.isNaN(fallback.getTime())) {
    throw new UnsupportedRecurrenceError(`unparseable UNTIL "${token}"`, rrule);
  }
  return {
    ms: fallback.getTime(),
    dateStr: formatDateOnly(fallback),
    dateOnly: DATE_ONLY.test(token),
  };
};

const buildPattern = (parser: RRuleParser, rrule: string): WalkPattern => {
  scanRawTokens(rrule);

  let parsed: PeerRecurrencePattern;
  try {
    parsed = parser(rrule);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RRULE "${rrule}": ${message}`);
  }

  const interval = parsed.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new UnsupportedRecurrenceError(`INTERVAL=${interval}`, rrule);
  }

  if (parsed.count !== undefined && parsed.until !== undefined) {
    throw new UnsupportedRecurrenceError(
      'COUNT and UNTIL are mutually exclusive per RFC 5545',
      rrule,
    );
  }
  if (
    parsed.count !== undefined &&
    (!Number.isInteger(parsed.count) || parsed.count < 1)
  ) {
    throw new UnsupportedRecurrenceError(`COUNT=${parsed.count}`, rrule);
  }

  let byDay: number[] | undefined;
  if (parsed.byDay && parsed.byDay.length > 0) {
    if (parsed.frequency !== 'daily' && parsed.frequency !== 'weekly') {
      throw new UnsupportedRecurrenceError(
        `BYDAY with FREQ=${parsed.frequency.toUpperCase()} (ordinal weekday rules)`,
        rrule,
      );
    }
    byDay = parsed.byDay.map((code) => {
      const normalized = code.trim().toUpperCase();
      const dayNumber = DAY_CODE_TO_NUMBER[normalized];
      if (dayNumber === undefined) {
        throw new UnsupportedRecurrenceError(
          `BYDAY value "${code}" (ordinal prefixes like 2TU are not supported)`,
          rrule,
        );
      }
      return dayNumber;
    });
  }

  let byMonthDay: number[] | undefined;
  if (parsed.byMonthDay && parsed.byMonthDay.length > 0) {
    if (parsed.frequency !== 'monthly') {
      throw new UnsupportedRecurrenceError(
        `BYMONTHDAY with FREQ=${parsed.frequency.toUpperCase()}`,
        rrule,
      );
    }
    for (const day of parsed.byMonthDay) {
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new UnsupportedRecurrenceError(
          `BYMONTHDAY value ${day} (only 1..31 supported)`,
          rrule,
        );
      }
    }
    byMonthDay = [...new Set(parsed.byMonthDay)].sort((a, b) => a - b);
  }

  return {
    frequency: parsed.frequency,
    interval,
    count: parsed.count,
    until: normalizeUntil(rrule, parsed.until),
    byDay,
    byMonthDay,
  };
};

// ---------------------------------------------------------------------------
// Occurrence walk (local, RFC 5545 subset — see module docs)
// ---------------------------------------------------------------------------

/**
 * Infinite ascending generator of occurrence dates (UTC midnights) for a
 * validated pattern, starting at `dtstart`. Callers bound it.
 */
function* patternOccurrences(
  pattern: WalkPattern,
  dtstart: Date,
): Generator<Date> {
  const startMs = dtstart.getTime();

  if (pattern.frequency === 'daily') {
    for (let t = startMs; ; t += pattern.interval * DAY_MS) {
      const d = new Date(t);
      // RFC 5545: BYDAY acts as a filter for FREQ=DAILY.
      if (!pattern.byDay || pattern.byDay.includes(d.getUTCDay())) yield d;
    }
  }

  if (pattern.frequency === 'weekly') {
    const days = pattern.byDay ?? [dtstart.getUTCDay()];
    // Weeks start Monday (WKST=MO, the RFC default; others rejected).
    const sinceMonday = (dtstart.getUTCDay() + 6) % 7;
    const weekStartMs = startMs - sinceMonday * DAY_MS;
    for (let week = weekStartMs; ; week += pattern.interval * 7 * DAY_MS) {
      for (let i = 0; i < 7; i++) {
        const t = week + i * DAY_MS;
        if (t < startMs) continue;
        const d = new Date(t);
        if (days.includes(d.getUTCDay())) yield d;
      }
    }
  }

  if (pattern.frequency === 'monthly') {
    const anchorYear = dtstart.getUTCFullYear();
    const anchorMonth = dtstart.getUTCMonth();
    const monthDays = pattern.byMonthDay ?? [dtstart.getUTCDate()];
    for (let k = 0; ; k += pattern.interval) {
      const year = anchorYear + Math.floor((anchorMonth + k) / 12);
      const month = (anchorMonth + k) % 12;
      for (const day of monthDays) {
        const d = new Date(Date.UTC(year, month, day));
        // RFC 5545: skip months where the day does not exist (e.g. Feb 31).
        if (d.getUTCMonth() !== month) continue;
        if (d.getTime() < startMs) continue;
        yield d;
      }
    }
  }

  // yearly
  const month = dtstart.getUTCMonth();
  const day = dtstart.getUTCDate();
  for (let year = dtstart.getUTCFullYear(); ; year += pattern.interval) {
    const d = new Date(Date.UTC(year, month, day));
    // Feb 29 only recurs on leap years.
    if (d.getUTCMonth() !== month) continue;
    yield d;
  }
}

/**
 * Bounded walk: all pattern occurrences from DTSTART through `endMs`
 * (UTC-midnight comparison), honoring COUNT from DTSTART. Range filtering
 * and UNTIL instant-precision happen in the callers.
 */
const walkOccurrences = (
  pattern: WalkPattern,
  dtstart: Date,
  endMs: number,
): Date[] => {
  const occurrences: Date[] = [];
  for (const d of patternOccurrences(pattern, dtstart)) {
    if (d.getTime() > endMs) break;
    occurrences.push(d);
    if (occurrences.length > MAX_OCCURRENCE_SCAN) {
      throw new Error(
        `Recurrence expansion exceeded ${MAX_OCCURRENCE_SCAN} occurrences ` +
          'for a single rule; narrow the expansion range.',
      );
    }
    if (pattern.count !== undefined && occurrences.length >= pattern.count) {
      break;
    }
  }
  return occurrences;
};

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

interface NormalizedRange {
  startMs: number;
  endMs: number;
  startDateStr: string;
  endDateStr: string;
}

const normalizeRange = (range: RecurrenceExpansionRange): NormalizedRange => {
  const startMs = DATE_ONLY.test(range.start)
    ? parseDateOnly(range.start, 'range.start').getTime()
    : parseInstant(range.start, 'range.start').getTime();
  const endMs = DATE_ONLY.test(range.end)
    ? parseDateOnly(range.end, 'range.end').getTime() + DAY_MS - 1
    : parseInstant(range.end, 'range.end').getTime();
  if (endMs < startMs) {
    throw new Error(
      `range.end (${range.end}) precedes range.start (${range.start})`,
    );
  }
  return {
    startMs,
    endMs,
    startDateStr: formatDateOnly(new Date(startMs)),
    endDateStr: formatDateOnly(new Date(endMs)),
  };
};

const expandHoursRule = (
  parser: RRuleParser,
  rule: RecurringHoursRule,
  range: NormalizedRange,
): HoursOverride[] => {
  const pattern = buildPattern(parser, rule.rrule);
  const dtstart = parseDateOnly(rule.dtstart, 'RecurringHoursRule.dtstart');
  const exdates = new Set(
    (rule.exdates ?? []).map((d) =>
      formatDateOnly(parseDateOnly(d, 'RecurringHoursRule.exdates[]')),
    ),
  );

  const walkEndMs = Math.min(
    parseDateOnly(range.endDateStr, 'range.end').getTime(),
    pattern.until
      ? parseDateOnly(pattern.until.dateStr, 'UNTIL').getTime()
      : Number.POSITIVE_INFINITY,
  );

  const overrides: HoursOverride[] = [];
  for (const occurrence of walkOccurrences(pattern, dtstart, walkEndMs)) {
    const dateStr = formatDateOnly(occurrence);
    if (dateStr < range.startDateStr) continue;
    if (exdates.has(dateStr)) continue;
    overrides.push({
      date: dateStr,
      opens: rule.window.opens,
      closes: rule.window.closes,
    });
  }
  return overrides;
};

const expandBlock = (
  parser: RRuleParser,
  block: RecurringBlock,
  range: NormalizedRange,
): OccupiedBlock[] => {
  const pattern = buildPattern(parser, block.rrule);
  if (
    !Number.isFinite(block.durationMinutes) ||
    block.durationMinutes <= 0
  ) {
    throw new Error(
      `RecurringBlock.durationMinutes must be positive, got ${block.durationMinutes}`,
    );
  }
  const durationMs = block.durationMinutes * 60_000;
  const dtstartInstant = parseInstant(block.dtstart, 'RecurringBlock.dtstart');

  let walkStart: Date;
  let makeInstant: (dateStr: string) => Date;
  if (block.timezone) {
    const tz = block.timezone;
    const wall = wallClockInTz(dtstartInstant, tz);
    walkStart = parseDateOnly(wall.date, 'RecurringBlock.dtstart (local date)');
    makeInstant = (dateStr) => parseTimeInTz(dateStr, wall.time, tz);
  } else {
    walkStart = parseDateOnly(
      formatDateOnly(dtstartInstant),
      'RecurringBlock.dtstart (UTC date)',
    );
    const timeOfDayMs = dtstartInstant.getTime() - walkStart.getTime();
    makeInstant = (dateStr) =>
      new Date(parseDateOnly(dateStr, 'occurrence date').getTime() + timeOfDayMs);
  }

  const exdateDays = new Set<string>();
  const exdateInstants = new Set<number>();
  for (const raw of block.exdates ?? []) {
    if (DATE_ONLY.test(raw)) {
      exdateDays.add(raw);
    } else {
      exdateInstants.add(
        parseInstant(raw, 'RecurringBlock.exdates[]').getTime(),
      );
    }
  }

  const untilCapMs = pattern.until
    ? pattern.until.dateOnly
      ? parseDateOnly(pattern.until.dateStr, 'UNTIL').getTime() + DAY_MS - 1
      : pattern.until.ms
    : Number.POSITIVE_INFINITY;

  // Walk in calendar-date space with a 2-day margin so timezone offsets
  // (±14h) cannot drop edge occurrences; the instant filter is authoritative.
  const walkEndMs =
    parseDateOnly(range.endDateStr, 'range.end').getTime() + 2 * DAY_MS;

  const occupied: OccupiedBlock[] = [];
  for (const occurrence of walkOccurrences(pattern, walkStart, walkEndMs)) {
    const dateStr = formatDateOnly(occurrence);
    const start = makeInstant(dateStr);
    const startTimeMs = start.getTime();
    if (startTimeMs > untilCapMs) continue;
    if (startTimeMs < range.startMs || startTimeMs > range.endMs) continue;
    if (exdateDays.has(dateStr) || exdateInstants.has(startTimeMs)) continue;
    occupied.push({ start, end: new Date(startTimeMs + durationMs) });
  }
  return occupied;
};

/**
 * Expand recurring hours rules and recurring blocks over an inclusive range
 * into the availability engine's input types.
 *
 * Loads the optional peer `@tummycrypt/tinyland-calendar` on first use
 * (only when there is at least one rule to expand); rejects with
 * `RecurrencePeerUnavailableError` when it is absent and with
 * `UnsupportedRecurrenceError` for RRULE constructs outside the supported
 * subset (never silently mis-expands — see module docs).
 */
export const expandRecurrence = async (
  rules: RecurrenceExpansionInput,
  range: RecurrenceExpansionRange,
): Promise<RecurrenceExpansion> => {
  const hours = rules.hours ?? [];
  const blocks = rules.blocks ?? [];
  if (hours.length === 0 && blocks.length === 0) {
    return { overrides: [], occupied: [] };
  }

  const normalizedRange = normalizeRange(range);
  parserPromise ??= loadRRuleParser();
  let parser: RRuleParser;
  try {
    parser = await parserPromise;
  } catch (error) {
    parserPromise = undefined; // allow retry after the peer is installed
    throw error;
  }

  const overrides = hours.flatMap((rule) =>
    expandHoursRule(parser, rule, normalizedRange),
  );
  const occupied = blocks.flatMap((block) =>
    expandBlock(parser, block, normalizedRange),
  );

  overrides.sort((a, b) => a.date.localeCompare(b.date));
  occupied.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { overrides, occupied };
};
