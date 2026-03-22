/**
 * Acuity API Mock Handlers
 * MSW request handlers for Acuity Scheduling API
 */

import { http, HttpResponse, delay } from 'msw';
import {
  acuityAppointmentTypesRaw,
  acuityAvailabilityDatesRaw,
  acuityAvailabilityTimesRaw,
  acuityAppointmentRaw,
  acuityBlockRaw,
} from '../../fixtures/index.js';
import { acuityCalendarsRaw } from '../../fixtures/providers.js';

const BASE_URL = 'https://acuityscheduling.com/api/v1';

// =============================================================================
// STATE MANAGEMENT (for stateful tests)
// =============================================================================

interface MockState {
  appointments: Map<number, typeof acuityAppointmentRaw>;
  blocks: Map<number, typeof acuityBlockRaw>;
  nextAppointmentId: number;
  nextBlockId: number;
  failNextRequest: boolean;
  simulateRateLimit: boolean;
  simulateNetworkDelay: number;
  simulateAuthFailure: boolean;
  simulateSlotTaken: boolean;
  failOnBookingCreate: boolean;
  idempotencyKeys: Map<string, number>; // Maps idempotency key to appointment ID
}

const defaultState: MockState = {
  appointments: new Map(),
  blocks: new Map(),
  nextAppointmentId: 200000,
  nextBlockId: 900000,
  failNextRequest: false,
  simulateRateLimit: false,
  simulateNetworkDelay: 0,
  simulateAuthFailure: false,
  simulateSlotTaken: false,
  failOnBookingCreate: false,
  idempotencyKeys: new Map(),
};

let state = { ...defaultState };

/**
 * Reset mock state to defaults
 */
export const resetAcuityMockState = () => {
  state = {
    appointments: new Map(),
    blocks: new Map(),
    nextAppointmentId: 200000,
    nextBlockId: 900000,
    failNextRequest: false,
    simulateRateLimit: false,
    simulateNetworkDelay: 0,
    simulateAuthFailure: false,
    simulateSlotTaken: false,
    failOnBookingCreate: false,
    idempotencyKeys: new Map(),
  };
};

/**
 * Configure mock behavior for testing
 */
export const configureAcuityMock = (config: Partial<MockState>) => {
  Object.assign(state, config);
};

/**
 * Get current mock state (for assertions)
 */
export const getAcuityMockState = () => ({ ...state });

// =============================================================================
// HELPER MIDDLEWARE
// =============================================================================

const withMiddleware = async (
  handler: () => Response | Promise<Response>
): Promise<Response> => {
  // Simulate network delay
  if (state.simulateNetworkDelay > 0) {
    await delay(state.simulateNetworkDelay);
  }

  // Simulate auth failure (401)
  if (state.simulateAuthFailure) {
    state.simulateAuthFailure = false; // One-shot
    return HttpResponse.json(
      { error: 'Invalid authentication credentials' },
      { status: 401 }
    );
  }

  // Simulate rate limiting
  if (state.simulateRateLimit) {
    state.simulateRateLimit = false; // One-shot
    return HttpResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '5' } }
    );
  }

  // Simulate failure
  if (state.failNextRequest) {
    state.failNextRequest = false; // One-shot
    return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return handler();
};

// =============================================================================
// APPOINTMENT TYPES (Services)
// =============================================================================

const getAppointmentTypes = http.get(`${BASE_URL}/appointment-types`, async () => {
  return withMiddleware(() => HttpResponse.json(acuityAppointmentTypesRaw));
});

// =============================================================================
// CALENDARS (Providers)
// =============================================================================

const getCalendars = http.get(`${BASE_URL}/calendars`, async () => {
  return withMiddleware(() => HttpResponse.json(acuityCalendarsRaw));
});

// =============================================================================
// AVAILABILITY
// =============================================================================

const getAvailabilityDates = http.get(`${BASE_URL}/availability/dates`, async ({ request }) => {
  const url = new URL(request.url);
  const appointmentTypeID = url.searchParams.get('appointmentTypeID');

  return withMiddleware(() => {
    // Validate required param
    if (!appointmentTypeID) {
      return HttpResponse.json(
        { error: 'appointmentTypeID is required' },
        { status: 400 }
      );
    }

    return HttpResponse.json(acuityAvailabilityDatesRaw);
  });
});

const getAvailabilityTimes = http.get(`${BASE_URL}/availability/times`, async ({ request }) => {
  const url = new URL(request.url);
  const appointmentTypeID = url.searchParams.get('appointmentTypeID');
  const date = url.searchParams.get('date');

  return withMiddleware(() => {
    if (!appointmentTypeID || !date) {
      return HttpResponse.json(
        { error: 'appointmentTypeID and date are required' },
        { status: 400 }
      );
    }

    return HttpResponse.json(acuityAvailabilityTimesRaw);
  });
});

const checkAvailability = http.get(`${BASE_URL}/availability/check-times`, async ({ request }) => {
  const url = new URL(request.url);
  const datetime = url.searchParams.get('datetime');

  return withMiddleware(() => {
    // Simulate slot taken scenario
    if (state.simulateSlotTaken) {
      state.simulateSlotTaken = false; // One-shot
      return HttpResponse.json({ valid: false });
    }

    // Check if slot is blocked
    const isBlocked = Array.from(state.blocks.values()).some(
      (block) => block.start === datetime
    );

    // Check if slot has appointment
    const hasAppointment = Array.from(state.appointments.values()).some(
      (apt) => apt.datetime === datetime
    );

    return HttpResponse.json({ valid: !isBlocked && !hasAppointment });
  });
});

// =============================================================================
// BLOCKS (Reservations)
// =============================================================================

const createBlock = http.post(`${BASE_URL}/blocks`, async ({ request }) => {
  const body = (await request.json()) as {
    calendarID: number;
    start: string;
    end: string;
    notes?: string;
  };

  return withMiddleware(() => {
    const blockId = state.nextBlockId++;
    const block = {
      id: blockId,
      calendarID: body.calendarID,
      start: body.start,
      end: body.end,
      notes: body.notes || 'Payment pending - slot reserved',
    };

    state.blocks.set(blockId, block);

    return HttpResponse.json(block, { status: 201 });
  });
});

const deleteBlock = http.delete(`${BASE_URL}/blocks/:id`, async ({ params }) => {
  const id = parseInt(params.id as string, 10);

  return withMiddleware(() => {
    if (!state.blocks.has(id)) {
      return HttpResponse.json({ error: 'Block not found' }, { status: 404 });
    }

    state.blocks.delete(id);
    return new HttpResponse(null, { status: 204 });
  });
});

// =============================================================================
// APPOINTMENTS (Bookings)
// =============================================================================

const createAppointment = http.post(`${BASE_URL}/appointments`, async ({ request }) => {
  // Clone request to read body multiple times
  const bodyText = await request.text();
  const body = JSON.parse(bodyText) as {
    appointmentTypeID: number;
    calendarID?: number;
    datetime: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    notes?: string;
  };

  // Extract idempotency key from notes or header
  const idempotencyKey = body.notes?.match(/idempotency:([^\s]+)/)?.[1] ||
    request.headers.get('Idempotency-Key');

  return withMiddleware(() => {
    // Check for idempotent replay
    if (idempotencyKey && state.idempotencyKeys.has(idempotencyKey)) {
      const existingId = state.idempotencyKeys.get(idempotencyKey)!;
      const existing = state.appointments.get(existingId);
      if (existing) {
        return HttpResponse.json(existing);
      }
    }

    // Simulate booking creation failure
    if (state.failOnBookingCreate) {
      state.failOnBookingCreate = false; // One-shot
      return HttpResponse.json(
        { error: 'Failed to create appointment' },
        { status: 500 }
      );
    }

    // Find service
    const service = acuityAppointmentTypesRaw.find((t) => t.id === body.appointmentTypeID);
    if (!service) {
      return HttpResponse.json(
        { error: `Appointment type ${body.appointmentTypeID} not found` },
        { status: 400 }
      );
    }

    // Find calendar
    const calendarId = body.calendarID || acuityCalendarsRaw[0].id;
    const calendar = acuityCalendarsRaw.find((c) => c.id === calendarId);
    if (!calendar) {
      return HttpResponse.json({ error: `Calendar ${calendarId} not found` }, { status: 400 });
    }

    const appointmentId = state.nextAppointmentId++;
    const startTime = new Date(body.datetime);
    const endTime = new Date(startTime.getTime() + service.duration * 60 * 1000);

    const appointment = {
      id: appointmentId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone || '',
      datetime: body.datetime,
      endTime: endTime.toISOString(),
      duration: service.duration,
      price: service.price,
      priceSold: service.price,
      paid: 'no',
      amountPaid: '0.00',
      type: service.name,
      appointmentTypeID: body.appointmentTypeID,
      calendarID: calendarId,
      calendar: calendar.name,
      confirmationPage: `https://acuityscheduling.com/confirm.php?id=${appointmentId}`,
      notes: body.notes || '',
      forms: [],
      labels: [],
    };

    state.appointments.set(appointmentId, appointment);

    // Store idempotency key for replay
    if (idempotencyKey) {
      state.idempotencyKeys.set(idempotencyKey, appointmentId);
    }

    return HttpResponse.json(appointment, { status: 201 });
  });
});

const getAppointment = http.get(`${BASE_URL}/appointments/:id`, async ({ params }) => {
  const id = parseInt(params.id as string, 10);

  return withMiddleware(() => {
    const appointment = state.appointments.get(id);
    if (!appointment) {
      // Return fixture for known IDs
      if (id === 100001) {
        return HttpResponse.json(acuityAppointmentRaw);
      }
      return HttpResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    return HttpResponse.json(appointment);
  });
});

const cancelAppointment = http.put(`${BASE_URL}/appointments/:id/cancel`, async ({ params }) => {
  const id = parseInt(params.id as string, 10);

  return withMiddleware(() => {
    const appointment = state.appointments.get(id);
    if (!appointment) {
      return HttpResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // Mark as cancelled - return updated appointment with cancelled status
    const cancelledAppointment = { ...appointment, canceled: true };
    state.appointments.delete(id);
    return HttpResponse.json(cancelledAppointment);
  });
});

const rescheduleAppointment = http.put(
  `${BASE_URL}/appointments/:id/reschedule`,
  async ({ params, request }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json()) as { datetime: string };

    return withMiddleware(() => {
      const appointment = state.appointments.get(id);
      if (!appointment) {
        return HttpResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }

      const updatedAppointment = {
        ...appointment,
        datetime: body.datetime,
        endTime: new Date(
          new Date(body.datetime).getTime() + appointment.duration * 60 * 1000
        ).toISOString(),
      };

      state.appointments.set(id, updatedAppointment);
      return HttpResponse.json(updatedAppointment);
    });
  }
);

// =============================================================================
// CLIENTS
// =============================================================================

const searchClients = http.get(`${BASE_URL}/clients`, async ({ request }) => {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');

  return withMiddleware(() => {
    if (!email) {
      return HttpResponse.json([]);
    }

    // Check if client has any appointments
    const clientAppointments = Array.from(state.appointments.values()).filter(
      (apt) => apt.email === email
    );

    if (clientAppointments.length > 0) {
      return HttpResponse.json([{ id: clientAppointments[0].id }]);
    }

    // Check fixture
    if (email === 'john.doe@example.com') {
      return HttpResponse.json([{ id: 100001 }]);
    }

    return HttpResponse.json([]);
  });
});

// =============================================================================
// ERROR SCENARIOS (for testing)
// =============================================================================

/**
 * Handler that always returns 401 Unauthorized
 */
export const unauthorizedHandler = http.get(`${BASE_URL}/*`, () => {
  return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
});

/**
 * Handler that always returns 500 Internal Server Error
 */
export const serverErrorHandler = http.get(`${BASE_URL}/*`, () => {
  return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
});

/**
 * Handler that always returns 429 Rate Limited
 */
export const rateLimitHandler = http.get(`${BASE_URL}/*`, () => {
  return HttpResponse.json(
    { error: 'Rate limit exceeded' },
    { status: 429, headers: { 'Retry-After': '5' } }
  );
});

/**
 * Handler that simulates network timeout
 */
export const timeoutHandler = http.get(`${BASE_URL}/*`, async () => {
  await delay(60000); // 60 second delay
  return HttpResponse.json({});
});

// =============================================================================
// EXPORT ALL HANDLERS
// =============================================================================

export const acuityHandlers = [
  // Appointment types
  getAppointmentTypes,
  // Calendars
  getCalendars,
  // Availability
  getAvailabilityDates,
  getAvailabilityTimes,
  checkAvailability,
  // Blocks
  createBlock,
  deleteBlock,
  // Appointments
  createAppointment,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
  // Clients
  searchClients,
];
