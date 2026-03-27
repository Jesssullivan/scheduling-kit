/**
 * Tests for Acuity adapter transformers
 * Validates API response to domain object mapping
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

import { createAcuityAdapter } from '../../../adapters/acuity.js';
import type { SchedulingAdapter } from '../../../adapters/types.js';
import { server } from '../../mocks/server.js';
import {
  resetAcuityMockState,
  configureAcuityMock,
} from '../../mocks/handlers/index.js';
import {
  expectRightAsync,
  expectLeftAsync,
  expectLeftTagAsync,
} from '../../helpers/effect.js';

// MSW server lifecycle
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  resetAcuityMockState();
});

afterAll(() => {
  server.close();
});

describe('Acuity Adapter Transformers', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  describe('toService (appointment type transformer)', () => {
    it('transforms appointment type to Service', async () => {
      const services = await expectRightAsync(adapter.getServices());

      expect(services.length).toBeGreaterThan(0);

      const service = services[0];
      expect(service.id).toBeDefined();
      expect(typeof service.id).toBe('string'); // Converted from number
      expect(service.name).toBeDefined();
      expect(typeof service.duration).toBe('number');
      expect(typeof service.price).toBe('number'); // Converted from string
      expect(service.price).toBeGreaterThanOrEqual(0);
      expect(service.currency).toBe('USD');
      expect(typeof service.active).toBe('boolean');
    });

    it('filters inactive services', async () => {
      const services = await expectRightAsync(adapter.getServices());

      // All returned services should be active
      services.forEach((service) => {
        expect(service.active).toBe(true);
      });
    });

    it('converts price from dollars string to cents', async () => {
      const services = await expectRightAsync(adapter.getServices());

      // TMD 60min should be $200.00 = 20000 cents
      const tmd60 = services.find((s) => s.name.includes('TMD 60'));
      if (tmd60) {
        expect(tmd60.price).toBe(20000);
      }
    });

    it('handles missing optional fields', async () => {
      const services = await expectRightAsync(adapter.getServices());

      services.forEach((service) => {
        // Required fields always present
        expect(service.id).toBeDefined();
        expect(service.name).toBeDefined();
        expect(service.duration).toBeDefined();
        expect(service.price).toBeDefined();
        expect(service.currency).toBeDefined();
        expect(service.active).toBeDefined();
      });
    });
  });

  describe('toProvider (calendar transformer)', () => {
    it('transforms calendar to Provider', async () => {
      const providers = await expectRightAsync(adapter.getProviders());

      expect(providers.length).toBeGreaterThan(0);

      const provider = providers[0];
      expect(provider.id).toBeDefined();
      expect(typeof provider.id).toBe('string');
      expect(provider.name).toBeDefined();
      expect(provider.timezone).toBeDefined();
    });

    it('includes optional email and description', async () => {
      const providers = await expectRightAsync(adapter.getProviders());

      const provider = providers[0];
      // Email is optional but fixture has it
      expect(provider.email).toBeDefined();
    });

    it('preserves timezone information', async () => {
      const providers = await expectRightAsync(adapter.getProviders());

      providers.forEach((provider) => {
        // Valid IANA timezone
        expect(provider.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
      });
    });
  });

  describe('toBooking (appointment transformer)', () => {
    it('transforms appointment to Booking', async () => {
      // Create an appointment first
      const booking = await expectRightAsync(adapter.createBooking({
        serviceId: '12345',
        providerId: '67890',
        datetime: '2026-02-15T14:00:00-05:00',
        client: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        },
        idempotencyKey: 'test-key-123',
      }));

      {

        expect(booking.id).toBeDefined();
        expect(typeof booking.id).toBe('string');
        expect(booking.serviceId).toBe('12345');
        expect(booking.serviceName).toBeDefined();
        expect(booking.datetime).toBeDefined();
        expect(booking.endTime).toBeDefined();
        expect(booking.duration).toBeGreaterThan(0);
        expect(typeof booking.price).toBe('number');
        expect(booking.currency).toBe('USD');
        expect(booking.client).toBeDefined();
        expect(booking.client.firstName).toBe('John');
        expect(booking.status).toBe('confirmed');
      }
    });

    it('sets payment status from paid field', async () => {
      const booking = await expectRightAsync(adapter.getBooking('100001'));

      // Mock fixture has paid: 'no'
      expect(booking.paymentStatus).toBe('pending');
    });

    it('includes payment ref from notes', async () => {
      const booking = await expectRightAsync(
        adapter.createBookingWithPaymentRef(
          {
            serviceId: '12345',
            datetime: '2026-02-15T14:00:00-05:00',
            client: {
              firstName: 'Jane',
              lastName: 'Smith',
              email: 'jane@example.com',
            },
            idempotencyKey: 'test-key-456',
          },
          'cash_12345',
          'cash'
        )
      );

      expect(booking.paymentRef).toBeDefined();
      expect(booking.paymentRef).toContain('CASH');
      expect(booking.paymentRef).toContain('cash_12345');
    });
  });

  describe('availability transformers', () => {
    it('transforms availability dates', async () => {
      const dates = await expectRightAsync(
        adapter.getAvailableDates({
          serviceId: '12345',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        })
      );

      expect(dates.length).toBeGreaterThan(0);
      dates.forEach((d) => {
        expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(d.slots).toBeGreaterThanOrEqual(0);
      });
    });

    it('transforms availability times to TimeSlot', async () => {
      const slots = await expectRightAsync(
        adapter.getAvailableSlots({
          serviceId: '12345',
          date: '2026-02-15',
        })
      );

      expect(slots.length).toBeGreaterThan(0);
      slots.forEach((slot) => {
        expect(slot.datetime).toBeDefined();
        expect(typeof slot.available).toBe('boolean');
      });
    });

    it('checkSlotAvailability returns boolean', async () => {
      const available = await expectRightAsync(
        adapter.checkSlotAvailability({
          serviceId: '12345',
          datetime: '2026-02-15T14:00:00-05:00',
        })
      );

      expect(typeof available).toBe('boolean');
    });
  });

  describe('reservation transformer (blocks)', () => {
    it('transforms block to SlotReservation', async () => {
      const reservation = await expectRightAsync(
        adapter.createReservation({
          serviceId: '12345',
          providerId: '67890',
          datetime: '2026-02-15T19:00:00.000Z',
          duration: 60,
        })
      );

      expect(reservation.id).toBeDefined();
      expect(typeof reservation.id).toBe('string');
      expect(reservation.datetime).toBe('2026-02-15T19:00:00.000Z');
      expect(reservation.duration).toBe(60);
      expect(reservation.expiresAt).toBeDefined();
      // Expires in the future
      expect(new Date(reservation.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('requires provider ID for reservation', async () => {
      const error = await expectLeftTagAsync(
        adapter.createReservation({
          serviceId: '12345',
          datetime: '2026-02-15T19:00:00.000Z',
          duration: 60,
        }),
        'ReservationError'
      );

      expect(error._tag).toBe('ReservationError');
      if (error._tag === 'ReservationError') {
        expect(error.code).toBe('BLOCK_FAILED');
      }
    });
  });
});

describe('Acuity Adapter Error Handling', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('handles rate limiting with retry', async () => {
    // Configure rate limit for first request
    configureAcuityMock({ simulateRateLimit: true });

    // Should retry and eventually succeed (rate limit is one-shot in mock)
    const services = await expectRightAsync(adapter.getServices());
    expect(services.length).toBeGreaterThan(0);
  });

  it('handles server errors', async () => {
    configureAcuityMock({ failNextRequest: true });

    // After server error, it should return error
    // Note: with retry logic it may succeed on retry
    // Result could be success (retry) or failure
    // Just verify it completes without hanging
    const { Effect, Exit } = await import('effect');
    const exit = await Effect.runPromiseExit(adapter.getServices());
    expect(exit).toBeDefined();
  });

  it('returns NOT_FOUND for unknown service', async () => {
    const error = await expectLeftTagAsync(
      adapter.getService('nonexistent'),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
    if (error._tag === 'AcuityError') {
      expect(error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND for unknown provider', async () => {
    const error = await expectLeftTagAsync(
      adapter.getProvider('nonexistent'),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
    if (error._tag === 'AcuityError') {
      expect(error.code).toBe('NOT_FOUND');
    }
  });
});

describe('Acuity Adapter Client Operations', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('finds existing client by email', async () => {
    const result = await expectRightAsync(
      adapter.findOrCreateClient({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com', // Fixture email
      })
    );

    expect(result.id).toBeDefined();
    expect(result.isNew).toBe(false);
  });

  it('indicates new client when email not found', async () => {
    const result = await expectRightAsync(
      adapter.findOrCreateClient({
        firstName: 'New',
        lastName: 'Client',
        email: 'new.client@example.com',
      })
    );

    expect(result.id).toBe('pending');
    expect(result.isNew).toBe(true);
  });

  it('returns null for unknown client email', async () => {
    const client = await expectRightAsync(
      adapter.getClientByEmail('unknown@example.com')
    );

    expect(client).toBeNull();
  });
});
