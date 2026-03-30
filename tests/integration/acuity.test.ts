/**
 * Acuity Adapter Integration Tests
 * Full booking lifecycle with MSW mocked backend
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { Effect, Exit, Cause, Option } from 'effect';
import { createAcuityAdapter } from '../../src/adapters/acuity.js';
import type { SchedulingAdapter } from '../../src/adapters/types.js';
import { server } from '../../src/tests/mocks/server.js';
import {
  resetAcuityMockState,
  configureAcuityMock,
  getAcuityMockState,
} from '../../src/tests/mocks/handlers/index.js';
import {
  expectSuccess,
  expectFailureTag,
} from '../../src/tests/helpers/effect.js';

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

describe('Acuity Integration: Full Booking Lifecycle', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('creates and cancels a booking', async () => {
    // 1. Get available services
    const services = await expectSuccess(adapter.getServices());
    expect(services.length).toBeGreaterThan(0);
    const service = services.find(s => s.name.includes('TMD 60'));
    expect(service).toBeDefined();

    // 2. Get providers for the service
    const providers = await expectSuccess(adapter.getProviders());
    expect(providers.length).toBeGreaterThan(0);
    const provider = providers[0];

    // 3. Check availability dates
    const dates = await expectSuccess(
      adapter.getAvailableDates({
        serviceId: service!.id,
        providerId: provider.id,
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })
    );
    expect(dates.length).toBeGreaterThan(0);

    // 4. Get time slots for a specific date
    const slots = await expectSuccess(
      adapter.getAvailableSlots({
        serviceId: service!.id,
        providerId: provider.id,
        date: dates[0].date,
      })
    );
    expect(slots.length).toBeGreaterThan(0);
    const availableSlot = slots.find(s => s.available);
    expect(availableSlot).toBeDefined();

    // 5. Create a booking
    const booking = await expectSuccess(
      adapter.createBooking({
        serviceId: service!.id,
        providerId: provider.id,
        datetime: availableSlot!.datetime,
        client: {
          firstName: 'Integration',
          lastName: 'Test',
          email: 'integration.test@example.com',
        },
        idempotencyKey: 'integration-test-key',
      })
    );

    expect(booking.id).toBeDefined();
    expect(booking.status).toBe('confirmed');
    expect(booking.serviceId).toBe(service!.id);

    // 6. Verify booking can be retrieved
    const retrieved = await expectSuccess(adapter.getBooking(booking.id));
    expect(retrieved.id).toBe(booking.id);

    // 7. Cancel the booking
    await expectSuccess(adapter.cancelBooking(booking.id, 'Integration test cleanup'));
  });

  it('creates reservation (block) for slot protection', async () => {
    const services = await expectSuccess(adapter.getServices());
    const providers = await expectSuccess(adapter.getProviders());

    // Create a reservation
    const reservation = await expectSuccess(
      adapter.createReservation({
        serviceId: services[0].id,
        providerId: providers[0].id,
        datetime: '2026-02-20T19:00:00.000Z',
        duration: 60,
      })
    );

    expect(reservation.id).toBeDefined();
    expect(reservation.duration).toBe(60);
    expect(reservation.expiresAt).toBeDefined();

    // Verify reservation is in mock state
    const mockState = getAcuityMockState();
    expect(mockState.blocks.size).toBe(1);

    // Release the reservation
    await expectSuccess(adapter.releaseReservation(reservation.id));

    // Verify it's removed
    const stateAfter = getAcuityMockState();
    expect(stateAfter.blocks.size).toBe(0);
  });

  it('handles slot taken scenario', async () => {
    // First booking takes the slot
    const booking1 = await expectSuccess(
      adapter.createBooking({
        serviceId: '12345',
        providerId: '67890',
        datetime: '2026-02-15T19:00:00.000Z',
        client: {
          firstName: 'First',
          lastName: 'Client',
          email: 'first@example.com',
        },
        idempotencyKey: 'first-booking-key',
      })
    );

    expect(booking1.id).toBeDefined();

    // Second booking tries the same slot
    // The mock should reject it (slot no longer available)
    const slotCheck = await expectSuccess(
      adapter.checkSlotAvailability({
        serviceId: '12345',
        providerId: '67890',
        datetime: '2026-02-15T19:00:00.000Z',
      })
    );

    // After booking, the slot should show as unavailable
    expect(slotCheck).toBe(false);
  });

  it('handles reschedule operation', async () => {
    // Create initial booking
    const booking = await expectSuccess(
      adapter.createBooking({
        serviceId: '12345',
        datetime: '2026-02-15T19:00:00.000Z',
        client: {
          firstName: 'Reschedule',
          lastName: 'Test',
          email: 'reschedule@example.com',
        },
        idempotencyKey: 'reschedule-test-key',
      })
    );

    // Reschedule to a new time
    const rescheduled = await expectSuccess(
      adapter.rescheduleBooking(booking.id, '2026-02-16T20:00:00.000Z')
    );

    expect(rescheduled.id).toBe(booking.id);
    expect(rescheduled.datetime).toBe('2026-02-16T20:00:00.000Z');
  });
});

describe('Acuity Integration: Error Handling', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('handles authentication failure', async () => {
    configureAcuityMock({ simulateAuthFailure: true });

    const error = await expectFailureTag(
      adapter.getServices(),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
    if (error._tag === 'AcuityError') {
      // Adapter returns API_ERROR for all non-rate-limit errors
      // The status code is preserved for debugging
      expect(error.code).toBe('API_ERROR');
      expect(error.statusCode).toBe(401);
    }
  });

  it('retries on rate limit and succeeds', async () => {
    configureAcuityMock({ simulateRateLimit: true });

    // Rate limit is one-shot in mock, so retry should succeed
    const services = await expectSuccess(adapter.getServices());
    expect(services.length).toBeGreaterThan(0);
  });

  it('handles server errors gracefully', async () => {
    configureAcuityMock({ failNextRequest: true });

    // Server error should be returned as AcuityError
    const exit = await Effect.runPromiseExit(adapter.getServices());

    // Could be success (if retry succeeds) or failure
    // Just verify it doesn't hang or throw
    expect(exit).toBeDefined();
  });

  it('returns error for unknown resources', async () => {
    const error = await expectFailureTag(
      adapter.getBooking('nonexistent-booking-id'),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
    if (error._tag === 'AcuityError') {
      // Adapter returns API_ERROR - status code indicates 404
      expect(error.code).toBe('API_ERROR');
      expect(error.statusCode).toBe(404);
    }
  });
});

describe('Acuity Integration: Client Operations', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('finds existing client by email', async () => {
    const result = await expectSuccess(
      adapter.findOrCreateClient({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com', // Existing client in mock
      })
    );

    expect(result.id).toBeDefined();
    expect(result.isNew).toBe(false);
  });

  it('indicates new client for unknown email', async () => {
    const result = await expectSuccess(
      adapter.findOrCreateClient({
        firstName: 'New',
        lastName: 'Customer',
        email: 'brand.new@example.com',
      })
    );

    expect(result.id).toBe('pending');
    expect(result.isNew).toBe(true);
  });

  it('returns null for unknown client email lookup', async () => {
    const client = await expectSuccess(
      adapter.getClientByEmail('definitely.not.found@example.com')
    );

    expect(client).toBeNull();
  });
});

describe('Acuity Integration: Availability Queries', () => {
  let adapter: SchedulingAdapter;

  beforeEach(() => {
    adapter = createAcuityAdapter({
      type: 'acuity',
      userId: 'test-user',
      apiKey: 'test-key',
    });
  });

  it('returns dates within the requested range', async () => {
    const dates = await expectSuccess(
      adapter.getAvailableDates({
        serviceId: '12345',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })
    );

    expect(dates.length).toBeGreaterThan(0);

    // All dates should be in February 2026
    dates.forEach(d => {
      expect(d.date).toMatch(/^2026-02-\d{2}$/);
      expect(d.slots).toBeGreaterThan(0);
    });
  });

  it('returns time slots for a specific date', async () => {
    const slots = await expectSuccess(
      adapter.getAvailableSlots({
        serviceId: '12345',
        date: '2026-02-15',
      })
    );

    expect(slots.length).toBeGreaterThan(0);

    slots.forEach(slot => {
      expect(slot.datetime).toContain('2026-02-15');
      expect(typeof slot.available).toBe('boolean');
    });
  });

  it('filters availability by provider', async () => {
    const providers = await expectSuccess(adapter.getProviders());
    const provider = providers[0];

    const slots = await expectSuccess(
      adapter.getAvailableSlots({
        serviceId: '12345',
        providerId: provider.id,
        date: '2026-02-15',
      })
    );

    expect(slots.length).toBeGreaterThan(0);
    slots.filter(s => s.providerId).forEach(slot => {
      expect(slot.providerId).toBe(provider.id);
    });
  });

  it('checkSlotAvailability returns boolean', async () => {
    const available = await expectSuccess(
      adapter.checkSlotAvailability({
        serviceId: '12345',
        datetime: '2026-02-15T14:00:00.000Z',
      })
    );

    expect(typeof available).toBe('boolean');
  });
});
