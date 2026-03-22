/**
 * HomegrownAdapter Unit Tests
 *
 * Tests adapter creation and configuration. DB-dependent methods
 * are tested in integration tests (requires DATABASE_URL).
 */

import { describe, it, expect } from 'vitest';
import { createHomegrownAdapter } from '../homegrown.js';

describe('createHomegrownAdapter', () => {
  const mockGetDb = async () => {
    throw new Error('No DB in unit tests');
  };

  it('creates an adapter with the correct name', () => {
    const adapter = createHomegrownAdapter({ getDb: mockGetDb });
    expect(adapter.name).toBe('homegrown');
  });

  it('has all 16 SchedulingAdapter methods', () => {
    const adapter = createHomegrownAdapter({ getDb: mockGetDb });
    const methods = [
      'getServices',
      'getService',
      'getProviders',
      'getProvider',
      'getProvidersForService',
      'getAvailableDates',
      'getAvailableSlots',
      'checkSlotAvailability',
      'createReservation',
      'releaseReservation',
      'createBooking',
      'createBookingWithPaymentRef',
      'getBooking',
      'cancelBooking',
      'rescheduleBooking',
      'findOrCreateClient',
      'getClientByEmail',
    ];

    for (const method of methods) {
      expect(typeof (adapter as any)[method]).toBe('function');
    }
  });

  it('accepts custom configuration', () => {
    const adapter = createHomegrownAdapter({
      getDb: mockGetDb,
      timezone: 'America/Chicago',
      slotInterval: 15,
      bufferMinutes: 10,
      minAdvanceHours: 4,
      defaultPractitionerHandle: 'jess',
    });
    expect(adapter.name).toBe('homegrown');
  });
});
