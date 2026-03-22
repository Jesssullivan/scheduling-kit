/**
 * Tests for DateTimePicker component logic.
 *
 * These test the pure functions extracted from the Svelte component
 * (calendar grid, date formatting, availability, past-date detection,
 * time formatting) without needing the Svelte runtime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Types (mirrored from core/types.ts)
// ---------------------------------------------------------------------------

interface AvailableDate {
  readonly date: string; // YYYY-MM-DD
  readonly slots: number;
}

interface TimeSlot {
  readonly datetime: string;
  readonly available: boolean;
  readonly providerId?: string;
}

// ---------------------------------------------------------------------------
// Pure logic extracted from DateTimePicker.svelte
// ---------------------------------------------------------------------------

const buildCalendarDays = (currentMonth: Date): (Date | null)[] => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: (Date | null)[] = [];
  const startPadding = firstDay.getDay();
  for (let i = 0; i < startPadding; i++) {
    days.push(null);
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return days;
};

const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const formatTime = (datetime: string, timezone: string): string => {
  const date = new Date(datetime);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
};

const buildAvailableDateSet = (availableDates: AvailableDate[]): Set<string> => {
  return new Set(availableDates.map((d) => d.date));
};

const isDateAvailable = (date: Date, availableDateSet: Set<string>): boolean => {
  return availableDateSet.has(formatDate(date));
};

const isDatePast = (date: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DateTimePicker logic', () => {
  // -----------------------------------------------------------------------
  // Calendar grid computation
  // -----------------------------------------------------------------------
  describe('buildCalendarDays', () => {
    it('should produce correct padding for a month starting on Sunday', () => {
      // March 2025 starts on Saturday (day 6), so 6 nulls
      // But let us pick a month that starts on Sunday for 0 padding:
      // June 2025 starts on Sunday
      const days = buildCalendarDays(new Date(2025, 5, 1)); // June 2025
      expect(days[0]).not.toBeNull(); // No padding — first day is Sunday
      expect(days[0]!.getDate()).toBe(1);
      expect(days[0]!.getMonth()).toBe(5);
    });

    it('should pad correctly for a month starting mid-week', () => {
      // January 2025 starts on Wednesday (day 3)
      const days = buildCalendarDays(new Date(2025, 0, 15)); // any day in Jan
      const nullCount = days.filter((d) => d === null).length;
      expect(nullCount).toBe(3); // Wed = index 3 -> 3 nulls
      // First real day after padding
      expect(days[3]).not.toBeNull();
      expect(days[3]!.getDate()).toBe(1);
    });

    it('should contain the correct number of real days for February non-leap year', () => {
      // February 2025 (non-leap) = 28 days
      const days = buildCalendarDays(new Date(2025, 1, 1));
      const realDays = days.filter((d) => d !== null);
      expect(realDays).toHaveLength(28);
    });

    it('should contain 29 days for February in a leap year', () => {
      // February 2024 was a leap year
      const days = buildCalendarDays(new Date(2024, 1, 1));
      const realDays = days.filter((d) => d !== null);
      expect(realDays).toHaveLength(29);
      expect(realDays[28]!.getDate()).toBe(29);
    });

    it('should produce 31 real days for months with 31 days', () => {
      // March 2025 has 31 days
      const days = buildCalendarDays(new Date(2025, 2, 1));
      const realDays = days.filter((d) => d !== null);
      expect(realDays).toHaveLength(31);
    });

    it('should have padding + real days equal total length', () => {
      // October 2025 starts on Wednesday (day 3), has 31 days
      const days = buildCalendarDays(new Date(2025, 9, 1));
      const nulls = days.filter((d) => d === null).length;
      const reals = days.filter((d) => d !== null).length;
      expect(nulls + reals).toBe(days.length);
      expect(reals).toBe(31);
      expect(nulls).toBe(3); // Wednesday
    });

    it('should work when given a Date in the middle of the month', () => {
      // The component uses currentMonth which could be any date in the month
      const fromMid = buildCalendarDays(new Date(2025, 6, 17)); // July 17
      const realDays = fromMid.filter((d) => d !== null);
      expect(realDays).toHaveLength(31);
      expect(realDays[0]!.getDate()).toBe(1);
      expect(realDays[30]!.getDate()).toBe(31);
    });

    it('should produce 6 null padding entries for a month starting on Saturday', () => {
      // March 2025 starts on Saturday
      const days = buildCalendarDays(new Date(2025, 2, 1));
      const leadingNulls: null[] = [];
      for (const d of days) {
        if (d === null) leadingNulls.push(d);
        else break;
      }
      expect(leadingNulls).toHaveLength(6); // Saturday = index 6
    });
  });

  // -----------------------------------------------------------------------
  // Date formatting
  // -----------------------------------------------------------------------
  describe('formatDate', () => {
    it('should format a date as YYYY-MM-DD', () => {
      // Use UTC-midnight to avoid timezone offset shifting the ISO date
      const date = new Date(Date.UTC(2025, 2, 15)); // March 15 2025 UTC
      expect(formatDate(date)).toBe('2025-03-15');
    });

    it('should zero-pad single-digit months and days', () => {
      const date = new Date(Date.UTC(2025, 0, 5)); // Jan 5
      expect(formatDate(date)).toBe('2025-01-05');
    });

    it('should handle Dec 31 correctly', () => {
      const date = new Date(Date.UTC(2025, 11, 31));
      expect(formatDate(date)).toBe('2025-12-31');
    });
  });

  // -----------------------------------------------------------------------
  // Date availability
  // -----------------------------------------------------------------------
  describe('isDateAvailable', () => {
    const available: AvailableDate[] = [
      { date: '2025-03-10', slots: 3 },
      { date: '2025-03-12', slots: 1 },
      { date: '2025-03-15', slots: 5 },
    ];
    const dateSet = buildAvailableDateSet(available);

    it('should return true for a date in the available set', () => {
      const date = new Date(Date.UTC(2025, 2, 10));
      expect(isDateAvailable(date, dateSet)).toBe(true);
    });

    it('should return false for a date not in the available set', () => {
      const date = new Date(Date.UTC(2025, 2, 11));
      expect(isDateAvailable(date, dateSet)).toBe(false);
    });

    it('should return false for an empty available set', () => {
      const emptySet = buildAvailableDateSet([]);
      const date = new Date(Date.UTC(2025, 2, 10));
      expect(isDateAvailable(date, emptySet)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Past date detection
  // -----------------------------------------------------------------------
  describe('isDatePast', () => {
    beforeEach(() => {
      // Fix "today" to 2025-03-15 midnight local
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 2, 15, 0, 0, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for yesterday', () => {
      expect(isDatePast(new Date(2025, 2, 14))).toBe(true);
    });

    it('should return false for today', () => {
      // today at midnight is NOT < today at midnight
      expect(isDatePast(new Date(2025, 2, 15))).toBe(false);
    });

    it('should return false for a future date', () => {
      expect(isDatePast(new Date(2025, 2, 20))).toBe(false);
    });

    it('should return true for a date far in the past', () => {
      expect(isDatePast(new Date(2020, 0, 1))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Time formatting
  // -----------------------------------------------------------------------
  describe('formatTime', () => {
    it('should format an ISO datetime to 12-hour time in the given timezone', () => {
      // 2025-03-15T14:30:00Z = 10:30 AM ET (EDT starts March 9 2025)
      const result = formatTime('2025-03-15T14:30:00Z', 'America/New_York');
      expect(result).toBe('10:30 AM');
    });

    it('should handle midnight UTC in Eastern time', () => {
      // 2025-03-15T04:00:00Z = midnight ET (EDT, UTC-4)
      const result = formatTime('2025-03-15T04:00:00Z', 'America/New_York');
      expect(result).toBe('12:00 AM');
    });

    it('should respect a different timezone', () => {
      // 2025-03-15T14:30:00Z in Pacific (PDT = UTC-7) = 7:30 AM
      const result = formatTime('2025-03-15T14:30:00Z', 'America/Los_Angeles');
      expect(result).toBe('7:30 AM');
    });

    it('should format PM times correctly', () => {
      // 2025-03-15T20:00:00Z = 4:00 PM ET (EDT)
      const result = formatTime('2025-03-15T20:00:00Z', 'America/New_York');
      expect(result).toBe('4:00 PM');
    });
  });

  // -----------------------------------------------------------------------
  // buildAvailableDateSet
  // -----------------------------------------------------------------------
  describe('buildAvailableDateSet', () => {
    it('should create a Set from available dates', () => {
      const dates: AvailableDate[] = [
        { date: '2025-03-10', slots: 2 },
        { date: '2025-03-11', slots: 1 },
      ];
      const set = buildAvailableDateSet(dates);
      expect(set.size).toBe(2);
      expect(set.has('2025-03-10')).toBe(true);
      expect(set.has('2025-03-11')).toBe(true);
    });

    it('should deduplicate if the same date appears twice', () => {
      const dates: AvailableDate[] = [
        { date: '2025-03-10', slots: 2 },
        { date: '2025-03-10', slots: 5 },
      ];
      const set = buildAvailableDateSet(dates);
      expect(set.size).toBe(1);
    });
  });
});
