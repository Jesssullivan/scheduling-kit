/**
 * Recurrence pre-pass tests (TIN-1996 slice 1)
 *
 * Calendar facts used below (verified):
 *   - 2026-06-01 is a Monday, 2026-06-03 a Wednesday
 *   - US DST starts Sunday 2026-03-08; 2026-03-02 is a Monday
 *     (09:00 EST = 14:00Z, 09:00 EDT = 13:00Z)
 *   - 2026 is not a leap year; 2026-01-31 exists, 2026-02-31 does not
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expandRecurrence,
  RecurrencePeerUnavailableError,
  UnsupportedRecurrenceError,
  type RecurringHoursRule,
} from '../recurrence.js';

const WINDOW = { opens: '09:00', closes: '17:00' };
const JUNE = { start: '2026-06-01', end: '2026-06-30' };

const overrideDates = async (rule: RecurringHoursRule, range = JUNE) => {
  const { overrides } = await expandRecurrence({ hours: [rule] }, range);
  return overrides.map((o) => o.date);
};

describe('expandRecurrence — recurring hours rules', () => {
  it('expands FREQ=WEEKLY;BYDAY=MO,WE,FR into per-date overrides', async () => {
    const { overrides, occupied } = await expandRecurrence(
      {
        hours: [
          {
            rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
            dtstart: '2026-06-01',
            window: WINDOW,
          },
        ],
      },
      { start: '2026-06-01', end: '2026-06-14' },
    );

    expect(occupied).toEqual([]);
    expect(overrides).toEqual([
      { date: '2026-06-01', opens: '09:00', closes: '17:00' },
      { date: '2026-06-03', opens: '09:00', closes: '17:00' },
      { date: '2026-06-05', opens: '09:00', closes: '17:00' },
      { date: '2026-06-08', opens: '09:00', closes: '17:00' },
      { date: '2026-06-10', opens: '09:00', closes: '17:00' },
      { date: '2026-06-12', opens: '09:00', closes: '17:00' },
    ]);
  });

  it('starts BYDAY expansion at dtstart, not at the top of its week', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
          dtstart: '2026-06-03', // Wednesday — Mon 06-01 must not appear
          window: WINDOW,
        },
        { start: '2026-06-01', end: '2026-06-08' },
      ),
    ).resolves.toEqual(['2026-06-03', '2026-06-05', '2026-06-08']);
  });

  it('defaults weekly recurrence to the dtstart weekday without BYDAY', async () => {
    await expect(
      overrideDates({
        rrule: 'RRULE:FREQ=WEEKLY',
        dtstart: '2026-06-03',
        window: WINDOW,
      }),
    ).resolves.toEqual([
      '2026-06-03',
      '2026-06-10',
      '2026-06-17',
      '2026-06-24',
    ]);
  });

  it('buckets INTERVAL=2 weekly BYDAY rules by week, not by occurrence', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR',
          dtstart: '2026-06-01',
          window: WINDOW,
        },
        { start: '2026-06-01', end: '2026-06-28' },
      ),
    ).resolves.toEqual([
      '2026-06-01',
      '2026-06-05',
      '2026-06-15',
      '2026-06-19',
    ]);
  });

  it('removes exdates after expansion', async () => {
    await expect(
      overrideDates({
        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        dtstart: '2026-06-01',
        window: WINDOW,
        exdates: ['2026-06-08'],
      }),
    ).resolves.toEqual(['2026-06-01', '2026-06-15', '2026-06-22', '2026-06-29']);
  });

  it('consumes COUNT from dtstart even when the range starts later', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'FREQ=DAILY;COUNT=5',
          dtstart: '2026-06-01',
          window: WINDOW,
        },
        { start: '2026-06-03', end: '2026-06-30' },
      ),
    ).resolves.toEqual(['2026-06-03', '2026-06-04', '2026-06-05']);
  });

  it('applies COUNT to the post-BYDAY occurrence set', async () => {
    await expect(
      overrideDates({
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3',
        dtstart: '2026-06-01',
        window: WINDOW,
      }),
    ).resolves.toEqual(['2026-06-01', '2026-06-03', '2026-06-08']);
  });

  it('enforces RFC 5545 compact UNTIL (Invalid Date upstream at 0.2.3)', async () => {
    await expect(
      overrideDates({
        rrule: 'FREQ=DAILY;UNTIL=20260603T235959Z',
        dtstart: '2026-06-01',
        window: WINDOW,
      }),
    ).resolves.toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('treats date-only UNTIL as inclusive', async () => {
    await expect(
      overrideDates({
        rrule: 'FREQ=DAILY;UNTIL=20260602',
        dtstart: '2026-06-01',
        window: WINDOW,
      }),
    ).resolves.toEqual(['2026-06-01', '2026-06-02']);
  });
});

describe('expandRecurrence — recurring blocks', () => {
  it('preserves wall-clock time across the DST boundary when timezone is set', async () => {
    const { occupied } = await expandRecurrence(
      {
        blocks: [
          {
            rrule: 'RRULE:FREQ=WEEKLY',
            dtstart: '2026-03-02T09:00:00-05:00', // Mon 09:00 EST
            durationMinutes: 60,
            timezone: 'America/New_York',
          },
        ],
      },
      { start: '2026-03-01', end: '2026-03-22' },
    );

    expect(occupied.map((b) => b.start.toISOString())).toEqual([
      '2026-03-02T14:00:00.000Z', // 09:00 EST
      '2026-03-09T13:00:00.000Z', // 09:00 EDT — wall clock preserved
      '2026-03-16T13:00:00.000Z',
    ]);
    expect(occupied.map((b) => b.end.toISOString())).toEqual([
      '2026-03-02T15:00:00.000Z',
      '2026-03-09T14:00:00.000Z',
      '2026-03-16T14:00:00.000Z',
    ]);
  });

  it('keeps a fixed UTC cadence when no timezone is set', async () => {
    const { occupied } = await expandRecurrence(
      {
        blocks: [
          {
            rrule: 'FREQ=WEEKLY',
            dtstart: '2026-03-02T14:00:00Z',
            durationMinutes: 30,
          },
        ],
      },
      { start: '2026-03-01', end: '2026-03-22' },
    );

    expect(occupied.map((b) => b.start.toISOString())).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T14:00:00.000Z', // drifts to 10:00 EDT locally — documented
      '2026-03-16T14:00:00.000Z',
    ]);
  });

  it('removes block exdates by exact instant and by date', async () => {
    const { occupied } = await expandRecurrence(
      {
        blocks: [
          {
            rrule: 'FREQ=WEEKLY',
            dtstart: '2026-06-01T15:00:00Z',
            durationMinutes: 45,
            exdates: ['2026-06-08T15:00:00Z', '2026-06-15'],
          },
        ],
      },
      JUNE,
    );

    expect(occupied.map((b) => b.start.toISOString())).toEqual([
      '2026-06-01T15:00:00.000Z',
      '2026-06-22T15:00:00.000Z',
      '2026-06-29T15:00:00.000Z',
    ]);
    expect(occupied[0].end.toISOString()).toBe('2026-06-01T15:45:00.000Z');
  });

  it('enforces UNTIL at instant precision for blocks', async () => {
    const { occupied } = await expandRecurrence(
      {
        blocks: [
          {
            rrule: 'FREQ=WEEKLY;UNTIL=20260608T150000Z',
            dtstart: '2026-06-01T15:00:00Z',
            durationMinutes: 30,
          },
        ],
      },
      JUNE,
    );

    expect(occupied.map((b) => b.start.toISOString())).toEqual([
      '2026-06-01T15:00:00.000Z',
      '2026-06-08T15:00:00.000Z', // UNTIL is inclusive
    ]);
  });
});

describe('expandRecurrence — monthly and yearly', () => {
  it('expands MONTHLY;BYMONTHDAY across months', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15',
          dtstart: '2026-06-01',
          window: WINDOW,
        },
        { start: '2026-06-01', end: '2026-08-31' },
      ),
    ).resolves.toEqual([
      '2026-06-01',
      '2026-06-15',
      '2026-07-01',
      '2026-07-15',
      '2026-08-01',
      '2026-08-15',
    ]);
  });

  it('skips months missing the anchor day (RFC 5545 monthly on the 31st)', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'FREQ=MONTHLY',
          dtstart: '2026-01-31',
          window: WINDOW,
        },
        { start: '2026-01-01', end: '2026-04-30' },
      ),
    ).resolves.toEqual(['2026-01-31', '2026-03-31']);
  });

  it('expands YEARLY on the dtstart month/day', async () => {
    await expect(
      overrideDates(
        {
          rrule: 'FREQ=YEARLY',
          dtstart: '2026-06-15',
          window: WINDOW,
        },
        { start: '2026-01-01', end: '2028-12-31' },
      ),
    ).resolves.toEqual(['2026-06-15', '2027-06-15', '2028-06-15']);
  });
});

describe('expandRecurrence — unsupported constructs fail loudly', () => {
  const hours = (rrule: string) => ({
    hours: [{ rrule, dtstart: '2026-06-01', window: WINDOW }],
  });

  it.each([
    ['BYSETPOS', 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2'],
    ['BYDAY with MONTHLY', 'FREQ=MONTHLY;BYDAY=TU'],
    ['ordinal BYDAY', 'FREQ=WEEKLY;BYDAY=2TU'],
    ['BYMONTH', 'FREQ=YEARLY;BYMONTH=6'],
    ['COUNT and UNTIL together', 'FREQ=DAILY;COUNT=3;UNTIL=20260610'],
    ['missing FREQ', 'INTERVAL=2'],
    ['sub-daily FREQ', 'FREQ=HOURLY'],
    ['non-default WKST', 'FREQ=WEEKLY;WKST=SU'],
    ['unknown token', 'FREQ=WEEKLY;BYWEEKNO=20'],
  ])('rejects %s', async (_label, rrule) => {
    await expect(expandRecurrence(hours(rrule), JUNE)).rejects.toThrow(
      UnsupportedRecurrenceError,
    );
  });

  it('carries the offending rrule on the error', async () => {
    const error = await expandRecurrence(
      hours('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2'),
      JUNE,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedRecurrenceError);
    expect((error as UnsupportedRecurrenceError).code).toBe(
      'RECURRENCE_UNSUPPORTED',
    );
    expect((error as UnsupportedRecurrenceError).rrule).toBe(
      'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2',
    );
  });
});

describe('expandRecurrence — input validation', () => {
  it('rejects non-YYYY-MM-DD dtstart for hours rules', async () => {
    await expect(
      expandRecurrence(
        {
          hours: [
            { rrule: 'FREQ=DAILY', dtstart: '06/01/2026', window: WINDOW },
          ],
        },
        JUNE,
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('rejects non-positive durationMinutes', async () => {
    await expect(
      expandRecurrence(
        {
          blocks: [
            {
              rrule: 'FREQ=DAILY',
              dtstart: '2026-06-01T10:00:00Z',
              durationMinutes: 0,
            },
          ],
        },
        JUNE,
      ),
    ).rejects.toThrow(/durationMinutes/);
  });

  it('rejects inverted ranges', async () => {
    await expect(
      expandRecurrence(
        { hours: [{ rrule: 'FREQ=DAILY', dtstart: '2026-06-01', window: WINDOW }] },
        { start: '2026-06-30', end: '2026-06-01' },
      ),
    ).rejects.toThrow(/precedes/);
  });
});

describe('expandRecurrence — optional peer @tummycrypt/tinyland-calendar', () => {
  afterEach(() => {
    vi.doUnmock('@tummycrypt/tinyland-calendar');
    vi.resetModules();
  });

  it('never loads the peer for empty rule sets', async () => {
    vi.resetModules();
    vi.doMock('@tummycrypt/tinyland-calendar', () => {
      throw new Error("Cannot find module '@tummycrypt/tinyland-calendar'");
    });
    const mod = await import('../recurrence.js');

    await expect(mod.expandRecurrence({}, JUNE)).resolves.toEqual({
      overrides: [],
      occupied: [],
    });
  });

  it('rejects with an actionable error when the peer is absent', async () => {
    vi.resetModules();
    vi.doMock('@tummycrypt/tinyland-calendar', () => {
      throw new Error("Cannot find module '@tummycrypt/tinyland-calendar'");
    });
    const mod = await import('../recurrence.js');

    const error = await mod
      .expandRecurrence(
        {
          hours: [
            { rrule: 'FREQ=DAILY', dtstart: '2026-06-01', window: WINDOW },
          ],
        },
        JUNE,
      )
      .catch((e: unknown) => e);

    // Fresh module instance after resetModules — match shape, not identity.
    expect(error).toMatchObject({
      name: 'RecurrencePeerUnavailableError',
      code: 'RECURRENCE_PEER_UNAVAILABLE',
    });
    expect((error as Error).message).toMatch(
      /pnpm add @tummycrypt\/tinyland-calendar/,
    );
    // Original import failure is preserved (vitest wraps the mock error).
    expect((error as Error).message).toMatch(/Cause: /);
  });

  it('exposes the typed error class on the public surface', () => {
    expect(new RecurrencePeerUnavailableError(new Error('x')).code).toBe(
      'RECURRENCE_PEER_UNAVAILABLE',
    );
  });
});
