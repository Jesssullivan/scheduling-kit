/**
 * Availability Engine
 *
 * Pure functions for computing available time slots from business hours,
 * existing bookings, time blocks, and reservations. No DB access — all
 * data is passed in as arguments.
 *
 * Core algorithm:
 *   1. Get business hours for the requested day-of-week
 *   2. Check for date-specific overrides (closures, special hours)
 *   3. Generate candidate slots at regular intervals
 *   4. Filter out slots that overlap with bookings, blocks, or reservations
 *   5. Return available slots
 */

// ---------------------------------------------------------------------------
// Input types (decoupled from Drizzle schema for testability)
// ---------------------------------------------------------------------------

export interface HoursWindow {
  opens: string; // HH:MM (24h)
  closes: string; // HH:MM (24h)
}

export interface HoursOverride {
  date: string; // YYYY-MM-DD
  opens: string | null; // null = closed
  closes: string | null;
}

export interface OccupiedBlock {
  start: Date;
  end: Date;
}

export interface SlotConfig {
  /** Service duration in minutes */
  duration: number;
  /** Interval between slot starts in minutes (default: 30) */
  interval?: number;
  /** Buffer time between appointments in minutes (default: 0) */
  buffer?: number;
  /** Minimum advance notice in hours (default: 2) */
  minAdvanceHours?: number;
  /** Timezone for date calculations (default: America/New_York) */
  timezone?: string;
}

export interface GeneratedSlot {
  datetime: string; // ISO 8601
  endTime: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL = 30;
const DEFAULT_BUFFER = 0;
const DEFAULT_MIN_ADVANCE = 2;
const DEFAULT_TIMEZONE = 'America/New_York';

// ---------------------------------------------------------------------------
// Core: Generate available slots for a date
// ---------------------------------------------------------------------------

/**
 * Generate available time slots for a given date.
 *
 * @param date - YYYY-MM-DD
 * @param dayHours - Business hours for this day-of-week (null if closed)
 * @param override - Optional date-specific override
 * @param occupied - Array of occupied time ranges (bookings + blocks + reservations)
 * @param config - Slot configuration (duration, interval, buffer, etc.)
 * @returns Array of available slots
 */
export const getAvailableSlots = (
  date: string,
  dayHours: HoursWindow | null,
  override: HoursOverride | null,
  occupied: OccupiedBlock[],
  config: SlotConfig,
): GeneratedSlot[] => {
  const tz = config.timezone ?? DEFAULT_TIMEZONE;

  // Determine effective hours for this date
  const effective = getEffectiveHours(dayHours, override);
  if (!effective) return []; // Closed

  const interval = config.interval ?? DEFAULT_INTERVAL;
  const buffer = config.buffer ?? DEFAULT_BUFFER;
  const minAdvance = config.minAdvanceHours ?? DEFAULT_MIN_ADVANCE;
  const duration = config.duration;

  // Parse open/close into Date objects in the target timezone
  const dayStart = parseTimeInTz(date, effective.opens, tz);
  const dayEnd = parseTimeInTz(date, effective.closes, tz);

  if (dayStart >= dayEnd) return []; // Invalid hours

  // Earliest allowed slot (now + minAdvanceHours)
  const earliest = new Date(Date.now() + minAdvance * 60 * 60 * 1000);

  // Generate candidate slots
  const slots: GeneratedSlot[] = [];
  let cursor = dayStart.getTime();
  const endMs = dayEnd.getTime();

  while (cursor + duration * 60_000 <= endMs) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + duration * 60_000);

    // Skip past slots
    if (slotStart >= earliest) {
      // Check overlap with buffer
      const bufferedStart = new Date(slotStart.getTime() - buffer * 60_000);
      const bufferedEnd = new Date(slotEnd.getTime() + buffer * 60_000);

      if (!hasOverlap(bufferedStart, bufferedEnd, occupied)) {
        slots.push({
          datetime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
        });
      }
    }

    cursor += interval * 60_000;
  }

  return slots;
};

// ---------------------------------------------------------------------------
// Check if a specific datetime is available
// ---------------------------------------------------------------------------

export const isSlotAvailable = (
  datetime: string,
  dayHours: HoursWindow | null,
  override: HoursOverride | null,
  occupied: OccupiedBlock[],
  config: SlotConfig,
): boolean => {
  const tz = config.timezone ?? DEFAULT_TIMEZONE;
  const buffer = config.buffer ?? DEFAULT_BUFFER;
  const minAdvance = config.minAdvanceHours ?? DEFAULT_MIN_ADVANCE;
  const duration = config.duration;

  // Check effective hours
  const slotDate = toDateString(datetime, tz);
  const effective = getEffectiveHours(dayHours, override);
  if (!effective) return false;

  const slotStart = new Date(datetime);
  const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

  // Check within business hours
  const dayStart = parseTimeInTz(slotDate, effective.opens, tz);
  const dayEnd = parseTimeInTz(slotDate, effective.closes, tz);

  if (slotStart < dayStart || slotEnd > dayEnd) return false;

  // Check advance notice
  const earliest = new Date(Date.now() + minAdvance * 60 * 60 * 1000);
  if (slotStart < earliest) return false;

  // Check overlap
  const bufferedStart = new Date(slotStart.getTime() - buffer * 60_000);
  const bufferedEnd = new Date(slotEnd.getTime() + buffer * 60_000);

  return !hasOverlap(bufferedStart, bufferedEnd, occupied);
};

// ---------------------------------------------------------------------------
// Get dates with availability in a range
// ---------------------------------------------------------------------------

export const getDatesWithAvailability = (
  startDate: string,
  endDate: string,
  hoursMap: Map<number, HoursWindow>, // dayOfWeek → hours
  overrides: HoursOverride[],
  occupied: OccupiedBlock[],
  config: SlotConfig,
): Array<{ date: string; slots: number }> => {
  const results: Array<{ date: string; slots: number }> = [];
  const tz = config.timezone ?? DEFAULT_TIMEZONE;

  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');

  while (current <= end) {
    const dateStr = formatDateStr(current);
    const dayOfWeek = getDayOfWeekInTz(dateStr, tz);
    const dayHours = hoursMap.get(dayOfWeek) ?? null;
    const override = overrides.find((o) => o.date === dateStr) ?? null;

    // Filter occupied blocks relevant to this date
    const dayOccupied = getOccupiedForDate(dateStr, occupied, tz);

    const slots = getAvailableSlots(dateStr, dayHours, override, dayOccupied, config);
    if (slots.length > 0) {
      results.push({ date: dateStr, slots: slots.length });
    }

    current.setDate(current.getDate() + 1);
  }

  return results;
};

// ---------------------------------------------------------------------------
// Confirmation code generator
// ---------------------------------------------------------------------------

const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1

export const generateConfirmationCode = (): string => {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
  }
  return `MI-${code}`;
};

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Determine effective hours considering override */
export const getEffectiveHours = (
  dayHours: HoursWindow | null,
  override: HoursOverride | null,
): HoursWindow | null => {
  if (override) {
    // Override with null opens means closed
    if (!override.opens || !override.closes) return null;
    return { opens: override.opens, closes: override.closes };
  }
  return dayHours;
};

/** Check if a time range overlaps with any occupied block */
export const hasOverlap = (
  start: Date,
  end: Date,
  occupied: OccupiedBlock[],
): boolean =>
  occupied.some((block) => start < block.end && end > block.start);

/** Parse "HH:MM" time on a given date in a timezone → UTC Date */
export const parseTimeInTz = (
  dateStr: string, // YYYY-MM-DD
  timeStr: string, // HH:MM
  tz: string,
): Date => {
  // Build an ISO-like string and use the timezone to convert
  const [hh, mm] = timeStr.split(':').map(Number);
  // Create in the target timezone by formatting
  const local = new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00`);
  // Use Intl to get the offset
  const utc = toUTCFromTz(local, tz);
  return utc;
};

/** Convert a Date assumed to be in `tz` to a UTC Date */
const toUTCFromTz = (localDate: Date, tz: string): Date => {
  // Format the date as if it were in the given timezone, then compare
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Get what the date looks like in UTC and in the target tz
  const nowInTz = formatter.format(localDate);
  const tzDate = parseFormattedDate(nowInTz);
  const offsetMs = tzDate.getTime() - localDate.getTime();

  // The actual UTC time is localDate - offset
  return new Date(localDate.getTime() - offsetMs);
};

/** Parse "MM/DD/YYYY, HH:MM:SS" → Date */
const parseFormattedDate = (s: string): Date => {
  const [datePart, timePart] = s.split(', ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [h, m, sec] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, h, m, sec);
};

/** Get day-of-week (0=Sun) for a date string in a timezone */
const getDayOfWeekInTz = (dateStr: string, tz: string): number => {
  const d = new Date(dateStr + 'T12:00:00Z');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  const dayName = formatter.format(d);
  const days: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return days[dayName] ?? 0;
};

/** Extract YYYY-MM-DD from an ISO datetime in a timezone */
const toDateString = (isoDatetime: string, tz: string): string => {
  const d = new Date(isoDatetime);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD
  return formatter.format(d);
};

/** Filter occupied blocks to only those relevant to a date */
const getOccupiedForDate = (
  dateStr: string,
  occupied: OccupiedBlock[],
  tz: string,
): OccupiedBlock[] => {
  const dayStart = parseTimeInTz(dateStr, '00:00', tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return occupied.filter((b) => b.start < dayEnd && b.end > dayStart);
};

/** Format Date as YYYY-MM-DD */
const formatDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
};

/** Zero-pad to 2 digits */
const pad = (n: number): string => String(n).padStart(2, '0');
