/**
 * Tests for test helpers
 * Validates the fp-ts helpers and factories work correctly
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';

import {
  expectRight,
  expectLeft,
  expectLeftTag,
  expectSome,
  expectNone,
  expectRightAsync,
  expectLeftAsync,
  expectLeftTagAsync,
  expectAcuityError,
  expectPaymentError,
  expectValidationError,
  expectReservationError,
  expectInfrastructureError,
} from './helpers/fp-ts.js';

import {
  serviceArb,
  providerArb,
  clientInfoArb,
  bookingArb,
  bookingRequestArb,
  createService,
  createProvider,
  createClient,
  createBooking,
  createBookingRequest,
  createReservation,
  createTimeSlot,
  createDaySlots,
  createMonthDates,
  createServiceBatch,
  createProviderBatch,
} from './helpers/factories.js';

import { Errors } from '../core/types.js';

// =============================================================================
// FP-TS HELPERS
// =============================================================================

describe('fp-ts test helpers', () => {
  describe('expectRight', () => {
    it('returns value for Right', () => {
      const result = expectRight(E.right(42));
      expect(result).toBe(42);
    });

    it('throws for Left', () => {
      expect(() => expectRight(E.left('error'))).toThrow();
    });
  });

  describe('expectLeft', () => {
    it('returns error for Left', () => {
      const result = expectLeft(E.left('error'));
      expect(result).toBe('error');
    });

    it('throws for Right', () => {
      expect(() => expectLeft(E.right(42))).toThrow();
    });
  });

  describe('expectLeftTag', () => {
    it('returns error with matching tag', () => {
      const error = Errors.acuity('TEST', 'test error');
      const result = expectLeftTag(E.left(error), 'AcuityError');
      expect(result._tag).toBe('AcuityError');
    });

    it('throws for mismatched tag', () => {
      const error = Errors.acuity('TEST', 'test error');
      expect(() => expectLeftTag(E.left(error), 'PaymentError')).toThrow();
    });
  });

  describe('expectSome / expectNone', () => {
    it('expectSome returns value for Some', () => {
      const result = expectSome(O.some(42));
      expect(result).toBe(42);
    });

    it('expectSome throws for None', () => {
      expect(() => expectSome(O.none)).toThrow();
    });

    it('expectNone succeeds for None', () => {
      expect(() => expectNone(O.none)).not.toThrow();
    });

    it('expectNone throws for Some', () => {
      expect(() => expectNone(O.some(42))).toThrow();
    });
  });

  describe('async helpers', () => {
    it('expectRightAsync resolves Right', async () => {
      const te = TE.right(42);
      const result = await expectRightAsync(te);
      expect(result).toBe(42);
    });

    it('expectLeftAsync resolves Left', async () => {
      const te = TE.left('error');
      const result = await expectLeftAsync(te);
      expect(result).toBe('error');
    });

    it('expectLeftTagAsync validates error tag', async () => {
      const te = TE.left(Errors.validation('field', 'invalid'));
      const error = await expectLeftTagAsync(te, 'ValidationError');
      expect(error._tag).toBe('ValidationError');
    });
  });

  describe('scheduling-specific helpers', () => {
    it('expectAcuityError validates AcuityError', () => {
      const error = Errors.acuity('NOT_FOUND', 'not found', 404);
      const result = expectAcuityError(E.left(error), 'NOT_FOUND');
      expect(result._tag).toBe('AcuityError');
    });

    it('expectPaymentError validates PaymentError', () => {
      const error = Errors.payment('DECLINED', 'card declined', 'stripe', true);
      const result = expectPaymentError(E.left(error), 'DECLINED', true);
      expect(result._tag).toBe('PaymentError');
    });

    it('expectValidationError validates ValidationError', () => {
      const error = Errors.validation('email', 'invalid format');
      const result = expectValidationError(E.left(error), 'email');
      expect(result._tag).toBe('ValidationError');
    });

    it('expectReservationError validates ReservationError', () => {
      const error = Errors.reservation('SLOT_TAKEN', 'slot already booked');
      const result = expectReservationError(E.left(error), 'SLOT_TAKEN');
      expect(result._tag).toBe('ReservationError');
    });

    it('expectInfrastructureError validates InfrastructureError', () => {
      const error = Errors.infrastructure('NETWORK', 'connection failed');
      const result = expectInfrastructureError(E.left(error), 'NETWORK');
      expect(result._tag).toBe('InfrastructureError');
    });
  });
});

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

describe('factory functions', () => {
  describe('createService', () => {
    it('creates valid service with defaults', () => {
      const service = createService();
      expect(service.id).toBeDefined();
      expect(service.name).toBeDefined();
      expect(service.duration).toBeGreaterThan(0);
      expect(service.price).toBeGreaterThanOrEqual(0);
      expect(service.active).toBe(true);
    });

    it('allows overrides', () => {
      const service = createService({ name: 'Custom', price: 50000 });
      expect(service.name).toBe('Custom');
      expect(service.price).toBe(50000);
    });
  });

  describe('createProvider', () => {
    it('creates valid provider with defaults', () => {
      const provider = createProvider();
      expect(provider.id).toBeDefined();
      expect(provider.name).toBeDefined();
      expect(provider.timezone).toBeDefined();
    });

    it('allows overrides', () => {
      const provider = createProvider({ timezone: 'America/Los_Angeles' });
      expect(provider.timezone).toBe('America/Los_Angeles');
    });
  });

  describe('createClient', () => {
    it('creates valid client with defaults', () => {
      const client = createClient();
      expect(client.firstName).toBeDefined();
      expect(client.lastName).toBeDefined();
      expect(client.email).toContain('@');
    });
  });

  describe('createBooking', () => {
    it('creates valid booking with defaults', () => {
      const booking = createBooking();
      expect(booking.id).toBeDefined();
      expect(booking.serviceId).toBeDefined();
      expect(booking.status).toBeDefined();
      expect(booking.paymentStatus).toBeDefined();
    });
  });

  describe('createBookingRequest', () => {
    it('creates valid booking request', () => {
      const request = createBookingRequest();
      expect(request.serviceId).toBeDefined();
      expect(request.datetime).toBeDefined();
      expect(request.client).toBeDefined();
      expect(request.idempotencyKey).toBeDefined();
    });
  });

  describe('createReservation', () => {
    it('creates valid reservation', () => {
      const reservation = createReservation();
      expect(reservation.id).toBeDefined();
      expect(reservation.datetime).toBeDefined();
      expect(reservation.duration).toBeGreaterThan(0);
      expect(new Date(reservation.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('createTimeSlot', () => {
    it('creates valid time slot', () => {
      const slot = createTimeSlot();
      expect(slot.datetime).toBeDefined();
      expect(typeof slot.available).toBe('boolean');
    });
  });

  describe('createDaySlots', () => {
    it('creates slots for a day', () => {
      const slots = createDaySlots('2026-02-15', '67890', 9, 17, 30);
      expect(slots.length).toBe(16); // 8 hours * 2 slots per hour
      expect(slots[0].datetime).toContain('09:00');
      expect(slots[slots.length - 1].datetime).toContain('16:30');
    });
  });

  describe('createMonthDates', () => {
    it('creates dates for a month (weekdays only)', () => {
      const dates = createMonthDates(2026, 2, 8);
      expect(dates.length).toBeGreaterThan(0);
      expect(dates.every((d) => d.slots === 8)).toBe(true);
      // February 2026 has 28 days, roughly 20 weekdays
      expect(dates.length).toBeLessThanOrEqual(23);
    });
  });

  describe('createServiceBatch / createProviderBatch', () => {
    it('creates batch of services', () => {
      const services = createServiceBatch(5);
      expect(services.length).toBe(5);
      expect(new Set(services.map((s) => s.id)).size).toBe(5); // unique IDs
    });

    it('creates batch of providers', () => {
      const providers = createProviderBatch(3);
      expect(providers.length).toBe(3);
      expect(new Set(providers.map((p) => p.id)).size).toBe(3); // unique IDs
    });
  });
});

// =============================================================================
// FAST-CHECK ARBITRARIES
// =============================================================================

describe('fast-check arbitraries', () => {
  it('serviceArb generates valid services', () => {
    fc.assert(
      fc.property(serviceArb, (service) => {
        expect(service.id).toBeDefined();
        expect(service.name).toBeDefined();
        expect(service.duration).toBeGreaterThan(0);
        expect(service.price).toBeGreaterThanOrEqual(0);
        expect(['USD', 'EUR', 'GBP', 'CAD']).toContain(service.currency);
      }),
      { numRuns: 50 }
    );
  });

  it('providerArb generates valid providers', () => {
    fc.assert(
      fc.property(providerArb, (provider) => {
        expect(provider.id).toBeDefined();
        expect(provider.name).toBeDefined();
        expect(provider.timezone).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });

  it('clientInfoArb generates valid clients', () => {
    fc.assert(
      fc.property(clientInfoArb, (client) => {
        expect(client.firstName).toBeDefined();
        expect(client.lastName).toBeDefined();
        expect(client.email).toContain('@');
      }),
      { numRuns: 50 }
    );
  });

  it('bookingArb generates valid bookings', () => {
    fc.assert(
      fc.property(bookingArb, (booking) => {
        expect(booking.id).toBeDefined();
        expect(booking.serviceId).toBeDefined();
        expect(booking.datetime).toBeDefined();
        expect(['confirmed', 'pending', 'cancelled', 'completed', 'no-show']).toContain(
          booking.status
        );
        expect(['pending', 'paid', 'refunded', 'failed']).toContain(booking.paymentStatus);
      }),
      { numRuns: 50 }
    );
  });

  it('bookingRequestArb generates valid booking requests', () => {
    fc.assert(
      fc.property(bookingRequestArb, (request) => {
        expect(request.serviceId).toBeDefined();
        expect(request.datetime).toBeDefined();
        expect(request.client.email).toContain('@');
        expect(request.idempotencyKey).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });
});
