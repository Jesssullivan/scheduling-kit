/**
 * Booking Fixtures
 * Static test data for bookings, clients, and reservations
 */

import type {
  Booking,
  BookingRequest,
  ClientInfo,
  SlotReservation,
  TimeSlot,
  AvailableDate,
} from '../../core/types.js';
import { tmd60Service, tmd30Service, neckMassage60Service } from './services.js';

// =============================================================================
// CLIENT FIXTURES
// =============================================================================

/**
 * Standard test client
 */
export const johnDoeClient: ClientInfo = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '(607) 555-1234',
  notes: 'New patient, referred by Dr. Smith',
};

/**
 * Client with minimal info
 */
export const minimalClient: ClientInfo = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@test.com',
};

/**
 * Client with all fields populated
 */
export const fullClient: ClientInfo = {
  firstName: 'Alice',
  lastName: 'Johnson',
  email: 'alice.johnson@company.com',
  phone: '(607) 555-9876',
  notes: 'Existing patient. Prefers afternoon appointments.',
  customFields: {
    'insurance-provider': 'Blue Cross',
    'referral-source': 'Google Search',
    'medical-history': 'Previous TMD treatment 2024',
  },
};

/**
 * Client with unicode characters
 */
export const unicodeClient: ClientInfo = {
  firstName: 'José',
  lastName: 'García-López',
  email: 'jose@ejemplo.com',
  phone: '+34 612 345 678',
  notes: 'Habla español. Cita de seguimiento.',
};

// =============================================================================
// BOOKING REQUEST FIXTURES
// =============================================================================

/**
 * Standard booking request for TMD 60min
 */
export const tmd60BookingRequest: BookingRequest = {
  serviceId: tmd60Service.id,
  providerId: '67890',
  datetime: '2026-02-15T14:00:00-05:00',
  client: johnDoeClient,
  paymentMethod: 'cash',
  idempotencyKey: 'req-tmd60-12345',
};

/**
 * Booking request without provider (auto-assign)
 */
export const autoAssignRequest: BookingRequest = {
  serviceId: tmd30Service.id,
  datetime: '2026-02-16T10:00:00-05:00',
  client: minimalClient,
  paymentMethod: 'venmo',
  idempotencyKey: 'req-autoassign-67890',
};

/**
 * Booking request with Zelle payment
 */
export const zellePaymentRequest: BookingRequest = {
  serviceId: neckMassage60Service.id,
  providerId: '67890',
  datetime: '2026-02-17T15:30:00-05:00',
  client: fullClient,
  paymentMethod: 'zelle',
  idempotencyKey: 'req-zelle-11111',
};

// =============================================================================
// BOOKING FIXTURES
// =============================================================================

/**
 * Confirmed booking with cash payment
 */
export const confirmedCashBooking: Booking = {
  id: '100001',
  serviceId: tmd60Service.id,
  serviceName: tmd60Service.name,
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-15T14:00:00-05:00',
  endTime: '2026-02-15T15:00:00-05:00',
  duration: 60,
  price: 20000,
  currency: 'USD',
  client: johnDoeClient,
  status: 'confirmed',
  confirmationCode: '100001',
  paymentStatus: 'paid',
  paymentRef: '[CASH] Transaction: cash_100001',
  createdAt: '2026-02-10T09:00:00-05:00',
};

/**
 * Pending booking (payment not yet captured)
 */
export const pendingBooking: Booking = {
  id: '100002',
  serviceId: tmd30Service.id,
  serviceName: tmd30Service.name,
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-16T10:00:00-05:00',
  endTime: '2026-02-16T10:30:00-05:00',
  duration: 30,
  price: 10000,
  currency: 'USD',
  client: minimalClient,
  status: 'pending',
  confirmationCode: '100002',
  paymentStatus: 'pending',
  createdAt: '2026-02-10T10:00:00-05:00',
};

/**
 * Cancelled booking
 */
export const cancelledBooking: Booking = {
  id: '100003',
  serviceId: neckMassage60Service.id,
  serviceName: neckMassage60Service.name,
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-14T11:00:00-05:00',
  endTime: '2026-02-14T12:00:00-05:00',
  duration: 60,
  price: 15000,
  currency: 'USD',
  client: fullClient,
  status: 'cancelled',
  confirmationCode: '100003',
  paymentStatus: 'refunded',
  paymentRef: '[ZELLE] Transaction: zelle_100003 [REFUND] refund_100003',
  createdAt: '2026-02-08T14:00:00-05:00',
};

/**
 * Completed booking (past appointment)
 */
export const completedBooking: Booking = {
  id: '100004',
  serviceId: tmd60Service.id,
  serviceName: tmd60Service.name,
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-01T09:00:00-05:00',
  endTime: '2026-02-01T10:00:00-05:00',
  duration: 60,
  price: 20000,
  currency: 'USD',
  client: johnDoeClient,
  status: 'completed',
  confirmationCode: '100004',
  paymentStatus: 'paid',
  paymentRef: '[VENMO] Transaction: venmo_100004',
  createdAt: '2026-01-25T11:00:00-05:00',
};

/**
 * No-show booking
 */
export const noShowBooking: Booking = {
  id: '100005',
  serviceId: tmd30Service.id,
  serviceName: tmd30Service.name,
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-05T13:00:00-05:00',
  endTime: '2026-02-05T13:30:00-05:00',
  duration: 30,
  price: 10000,
  currency: 'USD',
  client: unicodeClient,
  status: 'no-show',
  confirmationCode: '100005',
  paymentStatus: 'failed',
  createdAt: '2026-02-01T08:00:00-05:00',
};

/**
 * All bookings collection
 */
export const allBookings: Booking[] = [
  confirmedCashBooking,
  pendingBooking,
  cancelledBooking,
  completedBooking,
  noShowBooking,
];

// =============================================================================
// SLOT RESERVATION FIXTURES
// =============================================================================

/**
 * Active reservation (not expired)
 */
export const activeReservation: SlotReservation = {
  id: '999001',
  datetime: '2026-02-15T14:00:00-05:00',
  duration: 60,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 mins from now
  providerId: '67890',
};

/**
 * Reservation about to expire (< 1 min)
 */
export const expiringReservation: SlotReservation = {
  id: '999002',
  datetime: '2026-02-15T15:00:00-05:00',
  duration: 30,
  expiresAt: new Date(Date.now() + 30 * 1000).toISOString(), // 30 seconds from now
  providerId: '67890',
};

/**
 * Expired reservation
 */
export const expiredReservation: SlotReservation = {
  id: '999003',
  datetime: '2026-02-15T16:00:00-05:00',
  duration: 60,
  expiresAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
  providerId: '67890',
};

// =============================================================================
// TIME SLOT FIXTURES
// =============================================================================

/**
 * Available time slot
 */
export const availableSlot: TimeSlot = {
  datetime: '2026-02-15T14:00:00-05:00',
  available: true,
  providerId: '67890',
};

/**
 * Unavailable time slot (already booked)
 */
export const bookedSlot: TimeSlot = {
  datetime: '2026-02-15T09:00:00-05:00',
  available: false,
  providerId: '67890',
};

/**
 * Full day of slots (typical Saturday)
 */
export const saturdaySlots: TimeSlot[] = [
  { datetime: '2026-02-15T11:00:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T11:30:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T12:00:00-05:00', available: false, providerId: '67890' }, // booked
  { datetime: '2026-02-15T12:30:00-05:00', available: false, providerId: '67890' }, // booked
  { datetime: '2026-02-15T13:00:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T13:30:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T14:00:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T14:30:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T15:00:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T15:30:00-05:00', available: true, providerId: '67890' },
  { datetime: '2026-02-15T16:00:00-05:00', available: true, providerId: '67890' },
];

/**
 * Fully booked day
 */
export const fullyBookedSlots: TimeSlot[] = saturdaySlots.map((slot) => ({
  ...slot,
  available: false,
}));

// =============================================================================
// AVAILABLE DATE FIXTURES
// =============================================================================

/**
 * February 2026 availability (weekdays + Saturday)
 */
export const february2026Dates: AvailableDate[] = [
  // Week 1
  { date: '2026-02-02', slots: 8 }, // Monday
  { date: '2026-02-03', slots: 0 }, // Tuesday - no slots
  { date: '2026-02-04', slots: 4 }, // Wednesday
  { date: '2026-02-05', slots: 6 }, // Thursday
  { date: '2026-02-06', slots: 10 }, // Friday
  { date: '2026-02-07', slots: 6 }, // Saturday
  // Week 2
  { date: '2026-02-09', slots: 8 }, // Monday
  { date: '2026-02-10', slots: 0 }, // Tuesday - no slots
  { date: '2026-02-11', slots: 4 }, // Wednesday
  { date: '2026-02-12', slots: 6 }, // Thursday
  { date: '2026-02-13', slots: 10 }, // Friday
  { date: '2026-02-14', slots: 0 }, // Saturday - Valentine's Day, booked
  // Week 3
  { date: '2026-02-16', slots: 8 }, // Monday
  { date: '2026-02-17', slots: 0 }, // Tuesday - no slots
  { date: '2026-02-18', slots: 4 }, // Wednesday
  { date: '2026-02-19', slots: 6 }, // Thursday
  { date: '2026-02-20', slots: 10 }, // Friday
  { date: '2026-02-21', slots: 6 }, // Saturday
];

/**
 * Month with no availability (vacation)
 */
export const noAvailabilityDates: AvailableDate[] = [];

// =============================================================================
// ACUITY RAW RESPONSE FIXTURES
// =============================================================================

/**
 * Raw Acuity appointment response
 */
export const acuityAppointmentRaw = {
  id: 100001,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '(607) 555-1234',
  datetime: '2026-02-15T14:00:00-05:00',
  endTime: '2026-02-15T15:00:00-05:00',
  duration: 60,
  price: '200.00',
  priceSold: '200.00',
  paid: 'no', // Acuity paid field is read-only
  amountPaid: '0.00',
  type: 'TMD 60 min (including intraoral)',
  appointmentTypeID: 12345,
  calendarID: 67890,
  calendar: 'Jen Sullivan',
  confirmationPage: 'https://acuityscheduling.com/confirm.php?id=100001',
  notes: '[CASH] Transaction: cash_100001\nNew patient, referred by Dr. Smith',
  forms: [],
  labels: [],
};

/**
 * Raw Acuity block (reservation) response
 */
export const acuityBlockRaw = {
  id: 999001,
  start: '2026-02-15T14:00:00-05:00',
  end: '2026-02-15T15:00:00-05:00',
  notes: 'Payment pending - slot reserved',
  calendarID: 67890,
};

/**
 * Raw Acuity availability dates response
 */
export const acuityAvailabilityDatesRaw = [
  { date: '2026-02-15' },
  { date: '2026-02-16' },
  { date: '2026-02-17' },
  { date: '2026-02-18' },
  { date: '2026-02-19' },
  { date: '2026-02-20' },
  { date: '2026-02-21' },
];

/**
 * Raw Acuity availability times response
 */
export const acuityAvailabilityTimesRaw = [
  { time: '2026-02-15T11:00:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T11:30:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T12:00:00-05:00', slotsAvailable: 0 },
  { time: '2026-02-15T12:30:00-05:00', slotsAvailable: 0 },
  { time: '2026-02-15T13:00:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T13:30:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T14:00:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T14:30:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T15:00:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T15:30:00-05:00', slotsAvailable: 1 },
  { time: '2026-02-15T16:00:00-05:00', slotsAvailable: 1 },
];

/**
 * Raw Acuity check-times response (slot available)
 */
export const acuityCheckTimesValidRaw = {
  valid: true,
};

/**
 * Raw Acuity check-times response (slot taken)
 */
export const acuityCheckTimesInvalidRaw = {
  valid: false,
};
