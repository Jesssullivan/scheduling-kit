/**
 * Availability substrate tests (TIN-1996 slice 2): RRULE windows minus
 * CalDAV busy overlay.
 *
 * These are the acceptance tests for the first real availability path over
 * the substrate: recurring RRULE windows are expanded via the optional peer
 * @tummycrypt/tinyland-calendar (really installed here, so the path runs
 * against the published 0.2.3 module) and external-calendar busy time
 * subtracts from the generated slots.
 *
 * Calendar facts used below (verified):
 *   - 2026-06-01 is a Monday, 2026-06-03 a Wednesday, 2026-06-05 a Friday
 *   - 2026-05-04 is a Monday
 *   - June 2026 is EDT (UTC-4) in America/New_York
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlotConfig } from '../availability-engine.js';
import type { CalDavBusyQuery } from '../caldav-busy.js';
import {
  getSubstrateAvailability,
  type SubstrateDayAvailability,
} from '../availability-substrate.js';

// Freeze the clock before every test date so the engine's minimum-advance
// filter (`now + minAdvanceHours`) never eats slots on a real-clock run.
// Per-test (beforeEach, matching availability-engine.test.ts): the suite
// setup restores real timers between tests, so a beforeAll freeze silently
// thaws after the first test.
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

const slotStarts = (days: SubstrateDayAvailability[]): Record<string, string[]> =>
  Object.fromEntries(
    days.map((d) => [d.date, d.slots.map((s) => s.datetime)]),
  );

const FULL_MON = [
  '2026-06-01T09:00:00.000Z',
  '2026-06-01T10:00:00.000Z',
  '2026-06-01T11:00:00.000Z',
];
const FULL_FRI = [
  '2026-06-05T09:00:00.000Z',
  '2026-06-05T10:00:00.000Z',
  '2026-06-05T11:00:00.000Z',
];

describe('getSubstrateAvailability — RRULE windows minus busy', () => {
  it('expands windows into full slots when nothing is busy', async () => {
    const days = await getSubstrateAvailability(
      { hours: MWF_HOURS },
      WEEK,
      CONFIG,
    );

    expect(days.map((d) => d.date)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
    expect(days[0].window).toEqual({ opens: '09:00', closes: '12:00' });
    expect(slotStarts(days)['2026-06-03']).toEqual([
      '2026-06-03T09:00:00.000Z',
      '2026-06-03T10:00:00.000Z',
      '2026-06-03T11:00:00.000Z',
    ]);
  });

  it('subtracts a one-off CalDAV busy event from that day only', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            uid: 'external-mtg',
            dtstart: '2026-06-03T10:00:00.000Z',
            dtend: '2026-06-03T11:00:00.000Z',
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)).toEqual({
      '2026-06-01': FULL_MON,
      '2026-06-03': [
        '2026-06-03T09:00:00.000Z',
        '2026-06-03T11:00:00.000Z',
      ],
      '2026-06-05': FULL_FRI,
    });
  });

  it('subtracts a recurring busy event (daily standup) on every window day', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            uid: 'standup',
            // Master starts before the range — occurrences still land in it.
            dtstart: '2026-05-04T09:00:00.000Z',
            dtend: '2026-05-04T09:30:00.000Z',
            rrule: 'FREQ=DAILY',
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)).toEqual({
      '2026-06-01': ['2026-06-01T10:00:00.000Z', '2026-06-01T11:00:00.000Z'],
      '2026-06-03': ['2026-06-03T10:00:00.000Z', '2026-06-03T11:00:00.000Z'],
      '2026-06-05': ['2026-06-05T10:00:00.000Z', '2026-06-05T11:00:00.000Z'],
    });
  });

  it('restores the slot on a recurring busy exdate', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            dtstart: '2026-05-04T09:00:00.000Z',
            dtend: '2026-05-04T09:30:00.000Z',
            rrule: 'FREQ=DAILY',
            exdates: ['2026-06-03'],
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-03']).toEqual([
      '2026-06-03T09:00:00.000Z',
      '2026-06-03T10:00:00.000Z',
      '2026-06-03T11:00:00.000Z',
    ]);
    expect(slotStarts(days)['2026-06-01']).toEqual([
      '2026-06-01T10:00:00.000Z',
      '2026-06-01T11:00:00.000Z',
    ]);
  });

  it('returns the window date with empty slots when busy covers it fully', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            dtstart: '2026-06-05T08:00:00.000Z',
            dtend: '2026-06-05T13:00:00.000Z',
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(days.map((d) => d.date)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
    expect(slotStarts(days)['2026-06-05']).toEqual([]);
  });

  it('ignores cancelled busy events', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            dtstart: '2026-06-03T10:00:00.000Z',
            dtend: '2026-06-03T11:00:00.000Z',
            status: 'cancelled',
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-03']).toHaveLength(3);
  });

  it('blocks morning slots with a busy event spilling over midnight', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [
          {
            dtstart: '2026-06-02T20:00:00.000Z', // Tuesday evening
            dtend: '2026-06-03T10:00:00.000Z', // ends Wednesday 10:00
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-03']).toEqual([
      '2026-06-03T10:00:00.000Z',
      '2026-06-03T11:00:00.000Z',
    ]);
  });

  it('blocks the whole day for an all-day external event', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        busyEvents: [{ uid: 'vacation', dtstart: '2026-06-05' }],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-05']).toEqual([]);
    expect(slotStarts(days)['2026-06-03']).toHaveLength(3);
  });

  it('queries an injected CalDAV busy source over the padded range', async () => {
    const queries: Array<CalDavBusyQuery | undefined> = [];
    const busySource = {
      queryEvents: async (filters?: CalDavBusyQuery) => {
        queries.push(filters);
        return [
          {
            dtstart: '2026-06-03T10:00:00.000Z',
            dtend: '2026-06-03T11:00:00.000Z',
          },
        ];
      },
    };

    const days = await getSubstrateAvailability(
      { hours: MWF_HOURS, busySource },
      WEEK,
      CONFIG,
    );

    expect(queries).toEqual([
      { from: '2026-05-31T00:00:00.000Z', to: '2026-06-06T23:59:59.999Z' },
    ]);
    expect(slotStarts(days)['2026-06-03']).toEqual([
      '2026-06-03T09:00:00.000Z',
      '2026-06-03T11:00:00.000Z',
    ]);
  });

  it('never queries the busy source when no window date lands in the range', async () => {
    const queryEvents = vi.fn(async () => []);
    const days = await getSubstrateAvailability(
      { hours: MWF_HOURS, busySource: { queryEvents } },
      { start: '2026-06-07', end: '2026-06-07' }, // Sunday — no MWF window
      CONFIG,
    );

    expect(days).toEqual([]);
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it('subtracts recurring in-house blocks and materialized occupied blocks too', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: MWF_HOURS,
        blocks: [
          {
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            dtstart: '2026-06-01T09:00:00.000Z',
            durationMinutes: 60,
          },
        ],
        occupied: [
          {
            start: new Date('2026-06-01T11:00:00.000Z'),
            end: new Date('2026-06-01T12:00:00.000Z'),
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-01']).toEqual([
      '2026-06-01T10:00:00.000Z',
    ]);
    expect(slotStarts(days)['2026-06-03']).toHaveLength(3);
  });

  it('lets the first hours rule win when two windows land on the same date', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: [
          ...MWF_HOURS,
          {
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            dtstart: '2026-06-01',
            window: { opens: '08:00', closes: '10:00' },
          },
        ],
      },
      WEEK,
      CONFIG,
    );

    expect(slotStarts(days)['2026-06-01']).toEqual(FULL_MON);
  });

  it('computes windows minus busy in a non-UTC business timezone', async () => {
    const days = await getSubstrateAvailability(
      {
        hours: [
          {
            rrule: 'FREQ=WEEKLY;BYDAY=WE',
            dtstart: '2026-06-03',
            window: { opens: '09:00', closes: '12:00' }, // EDT wall clock
          },
        ],
        busyEvents: [
          {
            // 10:00–11:00 EDT
            dtstart: '2026-06-03T14:00:00.000Z',
            dtend: '2026-06-03T15:00:00.000Z',
          },
        ],
      },
      { start: '2026-06-03', end: '2026-06-03' },
      { ...CONFIG, timezone: 'America/New_York' },
    );

    expect(slotStarts(days)).toEqual({
      '2026-06-03': ['2026-06-03T13:00:00.000Z', '2026-06-03T15:00:00.000Z'],
    });
  });

  it('returns [] for an empty substrate without touching any peer', async () => {
    await expect(
      getSubstrateAvailability({ hours: [] }, WEEK, CONFIG),
    ).resolves.toEqual([]);
  });
});
