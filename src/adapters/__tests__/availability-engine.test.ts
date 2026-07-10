/**
 * Availability Engine Tests
 *
 * Tests the pure availability computation functions with no DB dependency.
 * Covers: slot generation, overlap detection, effective hours, edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAvailableSlots,
  isSlotAvailable,
  getDatesWithAvailability,
  generateConfirmationCode,
  getEffectiveHours,
  hasOverlap,
  parseTimeInTz,
  occupiedDayBoundsUtc,
  toDateString,
  type HoursWindow,
  type HoursOverride,
  type OccupiedBlock,
  type SlotConfig,
} from '../availability-engine.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MONDAY_HOURS: HoursWindow = { opens: '11:00', closes: '16:00' };
const FRIDAY_HOURS: HoursWindow = { opens: '13:00', closes: '18:00' };
const SATURDAY_HOURS: HoursWindow = { opens: '11:00', closes: '16:00' };

const BASE_CONFIG: SlotConfig = {
  duration: 60,
  interval: 30,
  buffer: 0,
  minAdvanceHours: 0, // Disable for testing
  timezone: 'America/New_York',
};

// A Monday. The engine filters slots earlier than `now + minAdvanceHours`
// (even with minAdvanceHours: 0, `earliest` is `now`), so any real-clock run
// after this date silently filters every candidate slot and the suite fails.
// Freeze the system time before each test so the fixture date is always
// "in the future" and results are identical on any machine, any day, any TZ.
const TEST_DATE = '2026-06-01'; // Monday
const FROZEN_NOW = new Date('2026-05-25T12:00:00Z'); // one week before TEST_DATE

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getEffectiveHours
// ---------------------------------------------------------------------------

describe('getEffectiveHours', () => {
  it('returns day hours when no override', () => {
    expect(getEffectiveHours(MONDAY_HOURS, null)).toEqual(MONDAY_HOURS);
  });

  it('returns null when day has no hours and no override', () => {
    expect(getEffectiveHours(null, null)).toBeNull();
  });

  it('returns override hours when override is present', () => {
    const override: HoursOverride = {
      date: TEST_DATE,
      opens: '10:00',
      closes: '14:00',
    };
    expect(getEffectiveHours(MONDAY_HOURS, override)).toEqual({
      opens: '10:00',
      closes: '14:00',
    });
  });

  it('returns null when override marks day as closed', () => {
    const override: HoursOverride = {
      date: TEST_DATE,
      opens: null,
      closes: null,
    };
    expect(getEffectiveHours(MONDAY_HOURS, override)).toBeNull();
  });

  it('override with opens but no closes returns null (closed)', () => {
    const override: HoursOverride = {
      date: TEST_DATE,
      opens: '10:00',
      closes: null,
    };
    expect(getEffectiveHours(MONDAY_HOURS, override)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasOverlap
// ---------------------------------------------------------------------------

describe('hasOverlap', () => {
  const block = (startH: number, endH: number): OccupiedBlock => {
    const toTime = (h: number) => {
      const hours = Math.floor(h);
      const mins = Math.round((h - hours) * 60);
      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00Z`;
    };
    return {
      start: new Date(`2026-06-01T${toTime(startH)}`),
      end: new Date(`2026-06-01T${toTime(endH)}`),
    };
  };

  it('no overlap with empty list', () => {
    const start = new Date('2026-06-01T14:00:00Z');
    const end = new Date('2026-06-01T15:00:00Z');
    expect(hasOverlap(start, end, [])).toBe(false);
  });

  it('detects full overlap', () => {
    const start = new Date('2026-06-01T14:00:00Z');
    const end = new Date('2026-06-01T15:00:00Z');
    expect(hasOverlap(start, end, [block(13, 16)])).toBe(true);
  });

  it('detects partial overlap at start', () => {
    const start = new Date('2026-06-01T14:00:00Z');
    const end = new Date('2026-06-01T15:00:00Z');
    expect(hasOverlap(start, end, [block(14, 14.5)])).toBe(true);
  });

  it('no overlap when exactly adjacent', () => {
    const start = new Date('2026-06-01T15:00:00Z');
    const end = new Date('2026-06-01T16:00:00Z');
    expect(hasOverlap(start, end, [block(14, 15)])).toBe(false);
  });

  it('detects overlap with one of multiple blocks', () => {
    const start = new Date('2026-06-01T14:00:00Z');
    const end = new Date('2026-06-01T15:00:00Z');
    expect(hasOverlap(start, end, [block(10, 11), block(14, 15)])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------

describe('getAvailableSlots', () => {
  it('returns empty for closed day (no hours)', () => {
    const slots = getAvailableSlots(TEST_DATE, null, null, [], BASE_CONFIG);
    expect(slots).toEqual([]);
  });

  it('returns empty for override-closed day', () => {
    const override: HoursOverride = { date: TEST_DATE, opens: null, closes: null };
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, override, [], BASE_CONFIG);
    expect(slots).toEqual([]);
  });

  it('generates slots for a 5-hour window with 60min duration at 30min intervals', () => {
    // 11:00-16:00 = 5 hours, 60min service, 30min interval
    // Slots: 11:00, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00
    // (15:30 would end at 16:30, past close)
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], BASE_CONFIG);
    expect(slots.length).toBe(9);
  });

  it('generates correct slots for 30min service', () => {
    const config = { ...BASE_CONFIG, duration: 30 };
    // 11:00-16:00, 30min service, 30min interval
    // Slots: 11:00, 11:30, 12:00, ..., 15:30 = 10 slots
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], config);
    expect(slots.length).toBe(10);
  });

  it('removes slots that overlap with bookings', () => {
    // Block 12:00-13:00
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '12:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '13:00', 'America/New_York'),
      },
    ];

    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, BASE_CONFIG);

    // Should not contain any slot that overlaps 12:00-13:00
    for (const s of slots) {
      const slotStart = new Date(s.datetime);
      const slotEnd = new Date(s.endTime);
      const blockStart = occupied[0].start;
      const blockEnd = occupied[0].end;
      const overlaps = slotStart < blockEnd && slotEnd > blockStart;
      expect(overlaps).toBe(false);
    }

    // Original 9 slots minus overlapping ones (11:30 [ends 12:30], 12:00 [ends 13:00], 12:30 [ends 13:30])
    // Wait: 11:30→12:30 overlaps 12:00-13:00? yes (12:00 < 12:30 && 12:30 > 12:00)
    // 12:00→13:00 overlaps? yes
    // 12:30→13:30 overlaps? yes (12:30 < 13:00 && 13:30 > 12:00)
    // So 9 - 3 = 6
    expect(slots.length).toBe(6);
  });

  it('respects buffer time', () => {
    const config = { ...BASE_CONFIG, buffer: 15 }; // 15 min buffer
    // Block 13:00-14:00. With 15min buffer, blocks 12:45-14:15 effectively
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '13:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '14:00', 'America/New_York'),
      },
    ];

    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, config);

    // Buffer expands the exclusion zone — should have fewer slots than without buffer
    const slotsNoBuffer = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, BASE_CONFIG);
    expect(slots.length).toBeLessThan(slotsNoBuffer.length);
  });

  it('uses override hours instead of regular hours', () => {
    // Override: only open 14:00-16:00
    const override: HoursOverride = { date: TEST_DATE, opens: '14:00', closes: '16:00' };
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, override, [], BASE_CONFIG);

    // 2-hour window, 60min service, 30min interval: 14:00, 14:30, 15:00 = 3 slots
    expect(slots.length).toBe(3);
  });

  it('handles back-to-back bookings correctly', () => {
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '11:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '12:00', 'America/New_York'),
      },
      {
        start: parseTimeInTz(TEST_DATE, '12:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '13:00', 'America/New_York'),
      },
    ];

    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, BASE_CONFIG);

    // 11:00 and 11:30 overlap first block, 12:00 and 12:30 overlap second
    // Available: 13:00, 13:30, 14:00, 14:30, 15:00 = 5 slots
    expect(slots.length).toBe(5);
  });

  it('returns empty when fully booked', () => {
    // Block the entire day
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '11:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '16:00', 'America/New_York'),
      },
    ];

    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, BASE_CONFIG);
    expect(slots.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isSlotAvailable
// ---------------------------------------------------------------------------

describe('isSlotAvailable', () => {
  it('returns true for an open slot within hours', () => {
    const dt = parseTimeInTz(TEST_DATE, '13:00', 'America/New_York').toISOString();
    expect(isSlotAvailable(dt, MONDAY_HOURS, null, [], BASE_CONFIG)).toBe(true);
  });

  it('returns false for a slot outside hours', () => {
    const dt = parseTimeInTz(TEST_DATE, '08:00', 'America/New_York').toISOString();
    expect(isSlotAvailable(dt, MONDAY_HOURS, null, [], BASE_CONFIG)).toBe(false);
  });

  it('returns false when slot end exceeds closing time', () => {
    // 15:30 + 60min = 16:30, past 16:00 close
    const dt = parseTimeInTz(TEST_DATE, '15:30', 'America/New_York').toISOString();
    expect(isSlotAvailable(dt, MONDAY_HOURS, null, [], BASE_CONFIG)).toBe(false);
  });

  it('returns false on a closed day', () => {
    const dt = parseTimeInTz(TEST_DATE, '13:00', 'America/New_York').toISOString();
    expect(isSlotAvailable(dt, null, null, [], BASE_CONFIG)).toBe(false);
  });

  it('returns false when overlapping with a booking', () => {
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '12:30', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '13:30', 'America/New_York'),
      },
    ];
    const dt = parseTimeInTz(TEST_DATE, '13:00', 'America/New_York').toISOString();
    expect(isSlotAvailable(dt, MONDAY_HOURS, null, occupied, BASE_CONFIG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDatesWithAvailability
// ---------------------------------------------------------------------------

describe('getDatesWithAvailability', () => {
  it('returns only days with business hours', () => {
    // Mon=1, Fri=5, Sat=6
    const hoursMap = new Map<number, HoursWindow>();
    hoursMap.set(1, MONDAY_HOURS);
    hoursMap.set(5, FRIDAY_HOURS);
    hoursMap.set(6, SATURDAY_HOURS);

    // 2026-06-01 is a Monday. Check Mon-Sun (7 days)
    const results = getDatesWithAvailability(
      '2026-06-01',
      '2026-06-07',
      hoursMap,
      [],
      [],
      BASE_CONFIG,
    );

    // Should include Mon (6/1), Fri (6/5), Sat (6/6) = 3 days
    expect(results.length).toBe(3);
    expect(results.map((r) => r.date)).toContain('2026-06-01');
    expect(results.map((r) => r.date)).toContain('2026-06-05');
    expect(results.map((r) => r.date)).toContain('2026-06-06');
  });

  it('excludes override-closed days', () => {
    const hoursMap = new Map<number, HoursWindow>();
    hoursMap.set(1, MONDAY_HOURS);

    const overrides: HoursOverride[] = [
      { date: '2026-06-01', opens: null, closes: null }, // Closed
    ];

    const results = getDatesWithAvailability(
      '2026-06-01',
      '2026-06-01',
      hoursMap,
      overrides,
      [],
      BASE_CONFIG,
    );

    expect(results.length).toBe(0);
  });

  it('reports correct slot counts', () => {
    const hoursMap = new Map<number, HoursWindow>();
    hoursMap.set(1, MONDAY_HOURS); // 11-16, 60min → 9 slots

    const results = getDatesWithAvailability(
      '2026-06-01',
      '2026-06-01',
      hoursMap,
      [],
      [],
      BASE_CONFIG,
    );

    expect(results.length).toBe(1);
    expect(results[0].slots).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// generateConfirmationCode
// ---------------------------------------------------------------------------

describe('generateConfirmationCode', () => {
  it('starts with the neutral BK- prefix by default', () => {
    const code = generateConfirmationCode();
    expect(code).toMatch(/^BK-/);
  });

  it('uses a custom prefix when provided', () => {
    const code = generateConfirmationCode('MI');
    expect(code).toMatch(/^MI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('has correct length (BK- + 6 chars = 9)', () => {
    expect(generateConfirmationCode().length).toBe(9);
  });

  it('uses only allowed characters', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateConfirmationCode().slice(3); // Remove BK-
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('generates unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateConfirmationCode());
    }
    // With 30^6 = 729M combinations, 1000 codes should all be unique
    expect(codes.size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// parseTimeInTz
// ---------------------------------------------------------------------------

describe('parseTimeInTz', () => {
  it('parses morning time in ET correctly', () => {
    const d = parseTimeInTz('2026-06-01', '11:00', 'America/New_York');
    // June 1 2026 = EDT (UTC-4), so 11:00 ET = 15:00 UTC
    expect(d.getUTCHours()).toBe(15);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('parses afternoon time in ET correctly', () => {
    const d = parseTimeInTz('2026-06-01', '16:00', 'America/New_York');
    expect(d.getUTCHours()).toBe(20);
  });

  it('handles winter time (EST = UTC-5)', () => {
    const d = parseTimeInTz('2026-01-15', '11:00', 'America/New_York');
    // January = EST (UTC-5), so 11:00 ET = 16:00 UTC
    expect(d.getUTCHours()).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('occupiedDayBoundsUtc', () => {
  it('bounds a summer (EDT, UTC-4) date at local midnight, not UTC midnight', () => {
    const { startIso, endExclusiveIso } = occupiedDayBoundsUtc(
      '2026-04-20',
      '2026-04-20',
      'America/New_York',
    );
    expect(startIso).toBe('2026-04-20T04:00:00.000Z');
    expect(endExclusiveIso).toBe('2026-04-21T04:00:00.000Z');
    // The old naive bounds used the UTC day directly.
    expect(startIso).not.toBe('2026-04-20T00:00:00Z');
  });

  it('bounds a winter (EST, UTC-5) date at local midnight', () => {
    const { startIso, endExclusiveIso } = occupiedDayBoundsUtc(
      '2026-01-15',
      '2026-01-15',
      'America/New_York',
    );
    expect(startIso).toBe('2026-01-15T05:00:00.000Z');
    expect(endExclusiveIso).toBe('2026-01-16T05:00:00.000Z');
  });

  it('keeps an evening ET booking inside its local date window across the UTC boundary (regression)', () => {
    // 2026-04-20 21:00 America/New_York (EDT) is stored as 2026-04-21T01:00Z,
    // the next UTC day. Its local date is still 2026-04-20, and the tz-aware
    // window for that date must contain it. The old UTC-day upper bound
    // (2026-04-20T23:59:59Z) dropped it, enabling a double booking.
    const eveningUtc = '2026-04-21T01:00:00.000Z';
    expect(toDateString(eveningUtc, 'America/New_York')).toBe('2026-04-20');

    const { startIso, endExclusiveIso } = occupiedDayBoundsUtc(
      '2026-04-20',
      '2026-04-20',
      'America/New_York',
    );
    const t = new Date(eveningUtc).getTime();
    expect(t).toBeGreaterThanOrEqual(new Date(startIso).getTime());
    expect(t).toBeLessThan(new Date(endExclusiveIso).getTime());
    // Proof the old bound would have excluded it.
    expect(t).toBeGreaterThan(new Date('2026-04-20T23:59:59Z').getTime());
  });

  it('spans a multi-day range from the first local midnight to the day after the last', () => {
    const { startIso, endExclusiveIso } = occupiedDayBoundsUtc(
      '2026-04-20',
      '2026-04-22',
      'America/New_York',
    );
    expect(startIso).toBe('2026-04-20T04:00:00.000Z');
    expect(endExclusiveIso).toBe('2026-04-23T04:00:00.000Z');
  });
});

describe('edge cases', () => {
  it('handles 0-minute duration gracefully', () => {
    const config = { ...BASE_CONFIG, duration: 0 };
    // Every interval point from 11:00 to 16:00 should be a slot
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], config);
    // 11:00, 11:30, 12:00, ..., 16:00 = 11 slots
    expect(slots.length).toBe(11);
  });

  it('handles duration longer than business hours', () => {
    const config = { ...BASE_CONFIG, duration: 360 }; // 6 hours
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], config);
    // 5-hour window, 6-hour service = no slots
    expect(slots.length).toBe(0);
  });

  it('handles duration exactly matching business hours', () => {
    const config = { ...BASE_CONFIG, duration: 300 }; // 5 hours = exactly 11:00-16:00
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], config);
    // Only one slot: 11:00-16:00
    expect(slots.length).toBe(1);
  });

  it('minAdvanceHours filters past slots', () => {
    // Set "now" to be at 13:00 ET on test date
    const fakeNow = parseTimeInTz(TEST_DATE, '13:00', 'America/New_York');
    vi.setSystemTime(fakeNow);

    const config = { ...BASE_CONFIG, minAdvanceHours: 2 };
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], config);

    // 2h advance from 13:00 = 15:00. Only 15:00 slot fits (60min ends at 16:00)
    expect(slots.length).toBe(1);
    expect(new Date(slots[0].datetime).getTime()).toBeGreaterThanOrEqual(
      parseTimeInTz(TEST_DATE, '15:00', 'America/New_York').getTime(),
    );
  });

  it('filters out every slot once the date is in the past (regression)', () => {
    // This is the failure mode that broke the suite after 2026-06-01: with the
    // clock past TEST_DATE, `earliest` (now + minAdvanceHours) exceeds every
    // candidate slot and the engine correctly returns nothing.
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z')); // 9 days after TEST_DATE
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, [], BASE_CONFIG);
    expect(slots.length).toBe(0);
  });

  it('multiple overlapping blocks handled correctly', () => {
    const occupied: OccupiedBlock[] = [
      {
        start: parseTimeInTz(TEST_DATE, '11:00', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '11:30', 'America/New_York'),
      },
      {
        start: parseTimeInTz(TEST_DATE, '11:15', 'America/New_York'),
        end: parseTimeInTz(TEST_DATE, '12:00', 'America/New_York'),
      },
    ];

    const config = { ...BASE_CONFIG, duration: 30 };
    const slots = getAvailableSlots(TEST_DATE, MONDAY_HOURS, null, occupied, config);

    // 11:00 overlaps first, 11:30 overlaps second → first available at 12:00
    const firstSlot = new Date(slots[0].datetime);
    const expected = parseTimeInTz(TEST_DATE, '12:00', 'America/New_York');
    expect(firstSlot.getTime()).toBe(expected.getTime());
  });
});
