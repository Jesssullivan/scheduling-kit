/**
 * Tests for MSW mock handlers
 * Verifies the mock server works correctly
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks/server.js';
import {
  resetAcuityMockState,
  configureAcuityMock,
  getAcuityMockState,
  resetPayPalMockState,
  configurePayPalMock,
  getPayPalMockState,
} from './mocks/handlers/index.js';

// MSW server lifecycle
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  resetAcuityMockState();
  resetPayPalMockState();
});

afterAll(() => {
  server.close();
});

// =============================================================================
// ACUITY MOCK HANDLERS
// =============================================================================

describe('Acuity mock handlers', () => {
  const BASE_URL = 'https://acuityscheduling.com/api/v1';
  const authHeader = { Authorization: 'Basic dGVzdDp0ZXN0' };

  describe('GET /appointment-types', () => {
    it('returns appointment types', async () => {
      const response = await fetch(`${BASE_URL}/appointment-types`, {
        headers: authHeader,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('duration');
      expect(data[0]).toHaveProperty('price');
    });
  });

  describe('GET /calendars', () => {
    it('returns calendars', async () => {
      const response = await fetch(`${BASE_URL}/calendars`, {
        headers: authHeader,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('timezone');
    });
  });

  describe('GET /availability/dates', () => {
    it('returns available dates', async () => {
      const response = await fetch(
        `${BASE_URL}/availability/dates?appointmentTypeID=12345&month=2026-02`,
        { headers: authHeader }
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty('date');
    });

    it('returns 400 without appointmentTypeID', async () => {
      const response = await fetch(`${BASE_URL}/availability/dates?month=2026-02`, {
        headers: authHeader,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /availability/times', () => {
    it('returns available times', async () => {
      const response = await fetch(
        `${BASE_URL}/availability/times?appointmentTypeID=12345&date=2026-02-15`,
        { headers: authHeader }
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]).toHaveProperty('time');
      expect(data[0]).toHaveProperty('slotsAvailable');
    });
  });

  describe('GET /availability/check-times', () => {
    it('returns valid=true for available slot', async () => {
      const response = await fetch(
        `${BASE_URL}/availability/check-times?appointmentTypeID=12345&datetime=2026-02-15T14:00:00-05:00`,
        { headers: authHeader }
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.valid).toBe(true);
    });
  });

  describe('POST /blocks', () => {
    it('creates a block (reservation)', async () => {
      const response = await fetch(`${BASE_URL}/blocks`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarID: 67890,
          start: '2026-02-15T14:00:00-05:00',
          end: '2026-02-15T15:00:00-05:00',
          notes: 'Payment pending',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data.calendarID).toBe(67890);
    });

    it('block makes slot unavailable', async () => {
      // Create block
      await fetch(`${BASE_URL}/blocks`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarID: 67890,
          start: '2026-02-15T14:00:00-05:00',
          end: '2026-02-15T15:00:00-05:00',
        }),
      });

      // Check availability
      const response = await fetch(
        `${BASE_URL}/availability/check-times?appointmentTypeID=12345&datetime=2026-02-15T14:00:00-05:00`,
        { headers: authHeader }
      );

      const data = await response.json();
      expect(data.valid).toBe(false);
    });
  });

  describe('DELETE /blocks/:id', () => {
    it('deletes a block', async () => {
      // Create block first
      const createResponse = await fetch(`${BASE_URL}/blocks`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarID: 67890,
          start: '2026-02-15T14:00:00-05:00',
          end: '2026-02-15T15:00:00-05:00',
        }),
      });
      const block = await createResponse.json();

      // Delete it
      const deleteResponse = await fetch(`${BASE_URL}/blocks/${block.id}`, {
        method: 'DELETE',
        headers: authHeader,
      });

      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('POST /appointments', () => {
    it('creates an appointment', async () => {
      const response = await fetch(`${BASE_URL}/appointments?admin=true`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentTypeID: 12345,
          calendarID: 67890,
          datetime: '2026-02-15T14:00:00-05:00',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '(607) 555-1234',
          notes: 'Test appointment',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data.firstName).toBe('John');
      expect(data.appointmentTypeID).toBe(12345);
    });

    it('returns 400 for invalid appointment type', async () => {
      const response = await fetch(`${BASE_URL}/appointments?admin=true`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentTypeID: 88888888, // Non-existent ID
          datetime: '2026-02-15T14:00:00-05:00',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /appointments/:id', () => {
    it('returns appointment by ID', async () => {
      // Create first
      const createResponse = await fetch(`${BASE_URL}/appointments?admin=true`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentTypeID: 12345,
          datetime: '2026-02-15T14:00:00-05:00',
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
        }),
      });
      const created = await createResponse.json();

      // Fetch it
      const response = await fetch(`${BASE_URL}/appointments/${created.id}`, {
        headers: authHeader,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.id).toBe(created.id);
      expect(data.firstName).toBe('Jane');
    });

    it('returns fixture for known ID 100001', async () => {
      const response = await fetch(`${BASE_URL}/appointments/100001`, {
        headers: authHeader,
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.firstName).toBe('John');
      expect(data.lastName).toBe('Doe');
    });
  });

  describe('PUT /appointments/:id/cancel', () => {
    it('cancels an appointment', async () => {
      // Create first
      const createResponse = await fetch(`${BASE_URL}/appointments?admin=true`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentTypeID: 12345,
          datetime: '2026-02-15T14:00:00-05:00',
          firstName: 'Test',
          lastName: 'Cancel',
          email: 'cancel@example.com',
        }),
      });
      const created = await createResponse.json();

      // Cancel it
      const response = await fetch(`${BASE_URL}/appointments/${created.id}/cancel`, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelNote: 'Testing cancellation' }),
      });

      // Returns 200 with cancelled appointment (changed from 204 to support JSON response)
      expect(response.status).toBe(200);
      const cancelledAppointment = await response.json();
      expect(cancelledAppointment.canceled).toBe(true);
    });
  });

  describe('mock state configuration', () => {
    it('simulates rate limiting', async () => {
      configureAcuityMock({ simulateRateLimit: true });

      const response = await fetch(`${BASE_URL}/appointment-types`, {
        headers: authHeader,
      });

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('5');
    });

    it('simulates server error', async () => {
      configureAcuityMock({ failNextRequest: true });

      const response = await fetch(`${BASE_URL}/appointment-types`, {
        headers: authHeader,
      });

      expect(response.status).toBe(500);
    });

    it('tracks state correctly', async () => {
      // Create appointment
      await fetch(`${BASE_URL}/appointments?admin=true`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentTypeID: 12345,
          datetime: '2026-02-15T14:00:00-05:00',
          firstName: 'State',
          lastName: 'Test',
          email: 'state@example.com',
        }),
      });

      const state = getAcuityMockState();
      expect(state.appointments.size).toBe(1);
    });
  });
});

// =============================================================================
// PAYPAL MOCK HANDLERS
// =============================================================================

describe('PayPal mock handlers', () => {
  const BASE_URL = 'https://api-m.sandbox.paypal.com';

  describe('POST /v1/oauth2/token', () => {
    it('returns access token with valid credentials', async () => {
      const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic dGVzdDp0ZXN0', // base64(test:test)
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('access_token');
      expect(data.token_type).toBe('Bearer');
    });

    it('returns 401 without auth header', async () => {
      const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v2/checkout/orders', () => {
    it('creates an order', async () => {
      const response = await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: { currency_code: 'USD', value: '200.00' },
              description: 'TMD 60 min',
            },
          ],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data.status).toBe('CREATED');
      expect(data.links).toBeDefined();
      expect(data.links.length).toBeGreaterThan(0);
    });
  });

  describe('POST /v2/checkout/orders/:id/capture', () => {
    it('captures an order', async () => {
      // Create order first
      const createResponse = await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '100.00' } }],
        }),
      });
      const order = await createResponse.json();

      // Capture it
      const captureResponse = await fetch(`${BASE_URL}/v2/checkout/orders/${order.id}/capture`, {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(captureResponse.ok).toBe(true);
      const data = await captureResponse.json();
      expect(data.status).toBe('COMPLETED');
      expect(data.purchase_units[0].payments.captures).toBeDefined();
    });

    it('simulates payment decline', async () => {
      // Create order
      const createResponse = await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '50.00' } }],
        }),
      });
      const order = await createResponse.json();

      // Configure decline
      configurePayPalMock({ simulateDecline: true });

      // Attempt capture
      const captureResponse = await fetch(`${BASE_URL}/v2/checkout/orders/${order.id}/capture`, {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(captureResponse.status).toBe(422);
      const error = await captureResponse.json();
      expect(error.details[0].issue).toBe('INSTRUMENT_DECLINED');
    });
  });

  describe('POST /v2/payments/captures/:id/refund', () => {
    it('creates a refund', async () => {
      // Create and capture order
      const createResponse = await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '75.00' } }],
        }),
      });
      const order = await createResponse.json();

      const captureResponse = await fetch(`${BASE_URL}/v2/checkout/orders/${order.id}/capture`, {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });
      const captured = await captureResponse.json();
      const captureId = captured.purchase_units[0].payments.captures[0].id;

      // Refund
      const refundResponse = await fetch(`${BASE_URL}/v2/payments/captures/${captureId}/refund`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(refundResponse.ok).toBe(true);
      const refund = await refundResponse.json();
      expect(refund.status).toBe('COMPLETED');
      expect(refund).toHaveProperty('id');
    });
  });

  describe('mock state configuration', () => {
    it('simulates server error', async () => {
      configurePayPalMock({ failNextRequest: true });

      const response = await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '100.00' } }],
        }),
      });

      expect(response.status).toBe(500);
    });

    it('tracks orders in state', async () => {
      await fetch(`${BASE_URL}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '100.00' } }],
        }),
      });

      const state = getPayPalMockState();
      expect(state.orders.size).toBe(1);
    });
  });
});
