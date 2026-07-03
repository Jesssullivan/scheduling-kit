/**
 * CalDAV busy overlay tests (TIN-1996 slice 2)
 *
 * Calendar facts used below (verified):
 *   - 2026-06-01 is a Monday
 *   - June 2026 is EDT (UTC-4) in America/New_York
 */

import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  busyBlocksFromEvents,
  fetchCalDavBusy,
  loadCalDavClient,
  CalDavPeerUnavailableError,
  type CalDavBusyEvent,
  type CalDavBusyQuery,
} from '../caldav-busy.js';

const JUNE_1_TO_5 = { start: '2026-06-01', end: '2026-06-05' };

const starts = async (
  events: CalDavBusyEvent[],
  range = JUNE_1_TO_5,
): Promise<string[]> => {
  const blocks = await busyBlocksFromEvents(events, range);
  return blocks.map((b) => b.start.toISOString());
};

describe('busyBlocksFromEvents — one-off events', () => {
  it('keeps the exact interval of events intersecting the range', async () => {
    const blocks = await busyBlocksFromEvents(
      [
        {
          uid: 'a',
          dtstart: '2026-06-03T10:00:00.000Z',
          dtend: '2026-06-03T11:00:00.000Z',
        },
      ],
      JUNE_1_TO_5,
    );
    expect(blocks).toEqual([
      {
        start: new Date('2026-06-03T10:00:00.000Z'),
        end: new Date('2026-06-03T11:00:00.000Z'),
      },
    ]);
  });

  it('drops events far outside the range but keeps midnight spillover', async () => {
    await expect(
      starts([
        // > 1 day before the range — irrelevant to any slot in it
        { dtstart: '2026-05-01T10:00:00Z', dtend: '2026-05-01T11:00:00Z' },
        // starts the evening before a range day and spills into it
        { dtstart: '2026-06-02T23:00:00Z', dtend: '2026-06-03T10:00:00Z' },
      ]),
    ).resolves.toEqual(['2026-06-02T23:00:00.000Z']);
  });

  it('skips cancelled events', async () => {
    await expect(
      starts([
        {
          dtstart: '2026-06-03T10:00:00Z',
          dtend: '2026-06-03T11:00:00Z',
          status: 'cancelled',
        },
      ]),
    ).resolves.toEqual([]);
  });

  it('treats a DATE-TIME dtstart without dtend as zero-duration (blocks nothing)', async () => {
    await expect(starts([{ dtstart: '2026-06-03T10:00:00Z' }])).resolves.toEqual(
      [],
    );
  });

  it('treats dtend === dtstart as zero-duration (blocks nothing)', async () => {
    await expect(
      starts([
        { dtstart: '2026-06-03T10:00:00Z', dtend: '2026-06-03T10:00:00Z' },
      ]),
    ).resolves.toEqual([]);
  });

  it('rejects unparseable dtstart with the event uid in the message', async () => {
    await expect(
      busyBlocksFromEvents(
        [{ uid: 'bad-event', dtstart: 'garbage' }],
        JUNE_1_TO_5,
      ),
    ).rejects.toThrow(/CalDAV event bad-event has an unparseable dtstart/);
  });

  it('rejects events that end before they start', async () => {
    await expect(
      busyBlocksFromEvents(
        [
          {
            uid: 'inverted',
            dtstart: '2026-06-03T11:00:00Z',
            dtend: '2026-06-03T10:00:00Z',
          },
        ],
        JUNE_1_TO_5,
      ),
    ).rejects.toThrow(/ends before it starts/);
  });

  it('rejects inverted ranges', async () => {
    await expect(
      busyBlocksFromEvents([], { start: '2026-06-05', end: '2026-06-01' }),
    ).rejects.toThrow(/precedes/);
  });
});

describe('busyBlocksFromEvents — all-day events (DATE-valued DTSTART)', () => {
  it('blocks the full UTC day without a timezone', async () => {
    const blocks = await busyBlocksFromEvents(
      [{ dtstart: '2026-06-03' }],
      JUNE_1_TO_5,
    );
    expect(blocks).toEqual([
      {
        start: new Date('2026-06-03T00:00:00.000Z'),
        end: new Date('2026-06-04T00:00:00.000Z'),
      },
    ]);
  });

  it('blocks the local day when a timezone is set', async () => {
    const blocks = await busyBlocksFromEvents(
      [{ dtstart: '2026-06-03', timezone: 'America/New_York' }],
      JUNE_1_TO_5,
    );
    expect(blocks).toEqual([
      {
        start: new Date('2026-06-03T04:00:00.000Z'), // midnight EDT
        end: new Date('2026-06-04T04:00:00.000Z'),
      },
    ]);
  });

  it('rejects an all-day event whose dtend equals dtstart (never silently under-blocks the day)', async () => {
    // RFC 5545 §3.8.2.2 requires DTEND strictly after a DATE-valued DTSTART;
    // producers emitting this malformation mean "busy all day".
    await expect(
      busyBlocksFromEvents(
        [{ uid: 'bad-allday', dtstart: '2026-06-03', dtend: '2026-06-03' }],
        JUNE_1_TO_5,
      ),
    ).rejects.toThrow(/DTEND strictly after DTSTART/);
  });

  it('treats a DATE-valued dtend as exclusive per RFC 5545', async () => {
    const blocks = await busyBlocksFromEvents(
      [{ dtstart: '2026-06-03', dtend: '2026-06-05' }],
      JUNE_1_TO_5,
    );
    expect(blocks).toEqual([
      {
        start: new Date('2026-06-03T00:00:00.000Z'),
        end: new Date('2026-06-05T00:00:00.000Z'),
      },
    ]);
  });
});

describe('busyBlocksFromEvents — recurring events', () => {
  it('expands RRULE events through the slice-1 walker', async () => {
    const blocks = await busyBlocksFromEvents(
      [
        {
          dtstart: '2026-06-01T09:00:00.000Z',
          dtend: '2026-06-01T09:30:00.000Z',
          rrule: 'RRULE:FREQ=DAILY',
        },
      ],
      { start: '2026-06-01', end: '2026-06-03' },
    );
    const inRange = blocks.map((b) => b.start.toISOString());
    expect(inRange).toEqual(
      expect.arrayContaining([
        '2026-06-01T09:00:00.000Z',
        '2026-06-02T09:00:00.000Z',
        '2026-06-03T09:00:00.000Z',
      ]),
    );
    expect(blocks[0].end.getTime() - blocks[0].start.getTime()).toBe(
      30 * 60_000,
    );
  });

  it('keeps occurrences that start before the range but spill into it', async () => {
    const blocks = await busyBlocksFromEvents(
      [
        {
          dtstart: '2026-05-20T23:00:00.000Z',
          dtend: '2026-05-21T00:30:00.000Z',
          rrule: 'FREQ=DAILY',
        },
      ],
      { start: '2026-06-01', end: '2026-06-02' },
    );
    // The 05-31T23:00Z occurrence spills into June 1 and must be kept.
    expect(blocks.map((b) => b.start.toISOString())).toContain(
      '2026-05-31T23:00:00.000Z',
    );
  });

  it('honors exdates on recurring busy events', async () => {
    const startList = await starts(
      [
        {
          dtstart: '2026-06-01T09:00:00.000Z',
          dtend: '2026-06-01T09:30:00.000Z',
          rrule: 'FREQ=DAILY',
          exdates: ['2026-06-02'],
        },
      ],
      { start: '2026-06-01', end: '2026-06-03' },
    );
    expect(startList).toContain('2026-06-01T09:00:00.000Z');
    expect(startList).toContain('2026-06-03T09:00:00.000Z');
    expect(startList).not.toContain('2026-06-02T09:00:00.000Z');
  });

  it('fails loud on RRULEs outside the supported subset (never under-blocks)', async () => {
    await expect(
      busyBlocksFromEvents(
        [
          {
            dtstart: '2026-06-01T09:00:00Z',
            dtend: '2026-06-01T10:00:00Z',
            rrule: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2',
          },
        ],
        JUNE_1_TO_5,
      ),
    ).rejects.toMatchObject({ code: 'RECURRENCE_UNSUPPORTED' });
  });

  it('skips cancelled recurring events', async () => {
    await expect(
      starts([
        {
          dtstart: '2026-06-01T09:00:00Z',
          dtend: '2026-06-01T09:30:00Z',
          rrule: 'FREQ=DAILY',
          status: 'cancelled',
        },
      ]),
    ).resolves.toEqual([]);
  });
});

describe('fetchCalDavBusy', () => {
  it('queries the source with a padded window and converts the events', async () => {
    const queries: Array<CalDavBusyQuery | undefined> = [];
    const source = {
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

    const blocks = await fetchCalDavBusy(source, JUNE_1_TO_5);

    expect(queries).toEqual([
      {
        from: '2026-05-31T00:00:00.000Z',
        to: '2026-06-06T23:59:59.999Z',
      },
    ]);
    expect(blocks).toEqual([
      {
        start: new Date('2026-06-03T10:00:00.000Z'),
        end: new Date('2026-06-03T11:00:00.000Z'),
      },
    ]);
  });
});

describe('loadCalDavClient — optional peer @tummycrypt/tinyland-caldav-client', () => {
  afterEach(() => {
    vi.doUnmock('@tummycrypt/tinyland-caldav-client');
    vi.resetModules();
  });

  it('constructs a real CalendarClient when the peer is installed', async () => {
    const client = await loadCalDavClient('http://localhost:5232');
    expect(typeof client.queryEvents).toBe('function');
  });

  it('rejects with an actionable error when the peer is absent', async () => {
    vi.resetModules();
    vi.doMock('@tummycrypt/tinyland-caldav-client', () => {
      throw new Error(
        "Cannot find module '@tummycrypt/tinyland-caldav-client'",
      );
    });
    const mod = await import('../caldav-busy.js');

    const error = await mod
      .loadCalDavClient()
      .catch((e: unknown) => e);

    // Fresh module instance after resetModules — match shape, not identity.
    expect(error).toMatchObject({
      name: 'CalDavPeerUnavailableError',
      code: 'CALDAV_PEER_UNAVAILABLE',
    });
    expect((error as Error).message).toMatch(
      /pnpm add @tummycrypt\/tinyland-caldav-client/,
    );
    expect((error as Error).message).toMatch(/Cause: /);
  });

  it('does not mislabel constructor errors as peer-unavailable', async () => {
    vi.resetModules();
    vi.doMock('@tummycrypt/tinyland-caldav-client', () => ({
      CalendarClient: class {
        constructor() {
          throw new Error('bad baseUrl');
        }
      },
    }));
    const mod = await import('../caldav-busy.js');

    const error = await mod.loadCalDavClient('::garbage::').catch((e: unknown) => e);

    expect((error as Error).message).toBe('bad baseUrl');
    expect((error as Error).name).not.toBe('CalDavPeerUnavailableError');
  });

  it('exposes the typed error class on the public surface', () => {
    expect(new CalDavPeerUnavailableError(new Error('x')).code).toBe(
      'CALDAV_PEER_UNAVAILABLE',
    );
  });
});
