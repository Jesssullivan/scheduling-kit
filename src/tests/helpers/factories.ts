/**
 * Test Factories
 * fast-check arbitraries and factory functions for domain objects
 */

import * as fc from 'fast-check';
import type {
  Service,
  Provider,
  TimeSlot,
  AvailableDate,
  ClientInfo,
  BookingRequest,
  Booking,
  BookingStatus,
  PaymentStatus,
  SlotReservation,
  PaymentIntent,
  PaymentResult,
  RefundResult,
  CheckoutState,
  CheckoutStep,
} from '../../core/types.js';

// =============================================================================
// PRIMITIVE ARBITRARIES
// =============================================================================

/**
 * Valid email arbitrary
 */
export const emailArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 3, maxLength: 10 }),
    fc.constantFrom('gmail.com', 'outlook.com', 'example.com', 'test.org', 'company.net')
  )
  .map(([local, domain]) => `${local}@${domain}`);

/**
 * Phone number arbitrary (US format)
 */
export const phoneArb = fc
  .tuple(
    fc.integer({ min: 200, max: 999 }),
    fc.integer({ min: 100, max: 999 }),
    fc.integer({ min: 1000, max: 9999 })
  )
  .map(([area, exchange, subscriber]) => `(${area}) ${exchange}-${subscriber}`);

/**
 * US currency amount in cents (positive)
 */
export const priceArb = fc.integer({ min: 100, max: 100000 }); // $1 to $1000

/**
 * Duration in minutes (typical appointment lengths)
 */
export const durationArb = fc.constantFrom(15, 30, 45, 60, 90, 120);

/**
 * ISO date string (YYYY-MM-DD)
 */
export const dateStringArb = fc
  .tuple(
    fc.integer({ min: 2024, max: 2028 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/**
 * ISO datetime string (UTC format for zod validation)
 */
export const datetimeArb = fc
  .tuple(
    dateStringArb,
    fc.integer({ min: 9, max: 17 }),
    fc.constantFrom(0, 15, 30, 45)
  )
  .map(
    ([date, hour, minute]) =>
      `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
  );

/**
 * Timezone arbitrary
 */
export const timezoneArb = fc.constantFrom(
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'UTC',
  'Europe/London'
);

/**
 * ID arbitrary (string representation of integer)
 */
export const idArb = fc.integer({ min: 1, max: 999999 }).map(String);

/**
 * UUID v4 arbitrary
 */
export const uuidArb = fc.uuid();

/**
 * Currency code arbitrary
 */
export const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'CAD');

// =============================================================================
// DOMAIN OBJECT ARBITRARIES
// =============================================================================

/**
 * Service (Appointment Type) arbitrary
 */
export const serviceArb: fc.Arbitrary<Service> = fc.record({
  id: idArb,
  name: fc.constantFrom(
    'TMD 60min',
    'TMD 30min',
    'Therapeutic Massage 60min',
    'Therapeutic Massage 90min',
    'Consultation'
  ),
  description: fc.option(fc.lorem({ maxCount: 10 }), { nil: undefined }),
  duration: durationArb,
  price: priceArb,
  currency: currencyArb,
  category: fc.option(fc.constantFrom('TMD', 'Massage', 'Consultation'), { nil: undefined }),
  color: fc.option(fc.hexaString({ minLength: 6, maxLength: 6 }).map((s) => `#${s}`), { nil: undefined }),
  active: fc.boolean(),
});

/**
 * Provider (Calendar) arbitrary
 */
export const providerArb: fc.Arbitrary<Provider> = fc.record({
  id: idArb,
  name: fc.constantFrom('Jen Sullivan', 'Jennifer Sullivan', 'Dr. Smith'),
  email: fc.option(emailArb, { nil: undefined }),
  description: fc.option(fc.lorem({ maxCount: 5 }), { nil: undefined }),
  image: fc.option(fc.webUrl(), { nil: undefined }),
  timezone: timezoneArb,
});

/**
 * TimeSlot arbitrary
 */
export const timeSlotArb: fc.Arbitrary<TimeSlot> = fc.record({
  datetime: datetimeArb,
  available: fc.boolean(),
  providerId: fc.option(idArb, { nil: undefined }),
});

/**
 * AvailableDate arbitrary
 */
export const availableDateArb: fc.Arbitrary<AvailableDate> = fc.record({
  date: dateStringArb,
  slots: fc.integer({ min: 1, max: 10 }),
});

/**
 * ClientInfo arbitrary
 */
export const clientInfoArb: fc.Arbitrary<ClientInfo> = fc.record({
  firstName: fc.constantFrom('John', 'Jane', 'Bob', 'Alice', 'Charlie'),
  lastName: fc.constantFrom('Smith', 'Doe', 'Johnson', 'Williams', 'Brown'),
  email: emailArb,
  phone: fc.option(phoneArb, { nil: undefined }),
  notes: fc.option(fc.lorem({ maxCount: 5 }), { nil: undefined }),
  customFields: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
});

/**
 * BookingStatus arbitrary
 */
export const bookingStatusArb: fc.Arbitrary<BookingStatus> = fc.constantFrom(
  'confirmed',
  'pending',
  'cancelled',
  'completed',
  'no-show'
);

/**
 * PaymentStatus arbitrary
 */
export const paymentStatusArb: fc.Arbitrary<PaymentStatus> = fc.constantFrom(
  'pending',
  'paid',
  'refunded',
  'failed'
);

/**
 * BookingRequest arbitrary
 */
export const bookingRequestArb: fc.Arbitrary<BookingRequest> = fc.record({
  serviceId: idArb,
  providerId: fc.option(idArb, { nil: undefined }),
  datetime: datetimeArb,
  client: clientInfoArb,
  paymentMethod: fc.option(fc.constantFrom('cash', 'venmo', 'zelle', 'check'), { nil: undefined }),
  idempotencyKey: uuidArb,
});

/**
 * Booking arbitrary
 */
export const bookingArb: fc.Arbitrary<Booking> = fc
  .tuple(serviceArb, clientInfoArb, datetimeArb, bookingStatusArb, paymentStatusArb, idArb, idArb)
  .map(([service, client, datetime, status, paymentStatus, bookingId, providerId]) => ({
    id: bookingId,
    serviceId: service.id,
    serviceName: service.name,
    providerId,
    providerName: 'Jen Sullivan',
    datetime,
    endTime: addMinutesToIso(datetime, service.duration),
    duration: service.duration,
    price: service.price,
    currency: service.currency,
    client,
    status,
    confirmationCode: bookingId,
    paymentStatus,
    paymentRef: paymentStatus === 'paid' ? `txn_${bookingId}` : undefined,
    createdAt: new Date().toISOString(),
  }));

/**
 * SlotReservation arbitrary
 */
export const slotReservationArb: fc.Arbitrary<SlotReservation> = fc.record({
  id: idArb,
  datetime: datetimeArb,
  duration: durationArb,
  expiresAt: fc.date({ min: new Date(), max: new Date(Date.now() + 30 * 60 * 1000) }).map((d) => d.toISOString()),
  providerId: fc.option(idArb, { nil: undefined }),
});

/**
 * PaymentIntent arbitrary
 */
export const paymentIntentArb: fc.Arbitrary<PaymentIntent> = fc.record({
  id: fc.string({ minLength: 10, maxLength: 20 }).map((s) => `pi_${s}`),
  amount: priceArb,
  currency: currencyArb,
  status: fc.constantFrom('pending', 'processing', 'completed', 'failed', 'cancelled'),
  processor: fc.constantFrom('cash', 'venmo', 'zelle', 'check', 'paypal'),
  processorTransactionId: fc.option(fc.string(), { nil: undefined }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
  createdAt: fc.date({ max: new Date() }).map((d) => d.toISOString()),
  expiresAt: fc.option(fc.date({ min: new Date() }).map((d) => d.toISOString()), { nil: undefined }),
});

/**
 * PaymentResult arbitrary
 */
export const paymentResultArb: fc.Arbitrary<PaymentResult> = fc.record({
  success: fc.boolean(),
  transactionId: fc.string({ minLength: 10, maxLength: 20 }).map((s) => `txn_${s}`),
  processor: fc.constantFrom('cash', 'venmo', 'zelle', 'check'),
  amount: priceArb,
  currency: currencyArb,
  timestamp: fc.date({ max: new Date() }).map((d) => d.toISOString()),
  receiptUrl: fc.option(fc.webUrl(), { nil: undefined }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
});

/**
 * RefundResult arbitrary
 */
export const refundResultArb: fc.Arbitrary<RefundResult> = fc.record({
  success: fc.boolean(),
  refundId: fc.string({ minLength: 10, maxLength: 20 }).map((s) => `refund_${s}`),
  originalTransactionId: fc.string({ minLength: 10, maxLength: 20 }).map((s) => `txn_${s}`),
  amount: priceArb,
  currency: currencyArb,
  timestamp: fc.date({ max: new Date() }).map((d) => d.toISOString()),
});

/**
 * CheckoutStep arbitrary
 */
export const checkoutStepArb: fc.Arbitrary<CheckoutStep> = fc.constantFrom(
  'service',
  'provider',
  'datetime',
  'details',
  'payment',
  'confirm',
  'complete',
  'error'
);

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a valid Service with optional overrides
 */
export const createService = (overrides?: Partial<Service>): Service => ({
  id: '12345',
  name: 'TMD 60min (including intraoral)',
  description: 'Temporomandibular disorder treatment',
  duration: 60,
  price: 20000, // $200 in cents
  currency: 'USD',
  category: 'TMD',
  color: '#4A90D9',
  active: true,
  ...overrides,
});

/**
 * Create a valid Provider with optional overrides
 */
export const createProvider = (overrides?: Partial<Provider>): Provider => ({
  id: '67890',
  name: 'Jen Sullivan',
  email: 'jen@massageithaca.com',
  description: 'Licensed massage therapist',
  timezone: 'America/New_York',
  ...overrides,
});

/**
 * Create a valid ClientInfo with optional overrides
 */
export const createClient = (overrides?: Partial<ClientInfo>): ClientInfo => ({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '(607) 555-1234',
  ...overrides,
});

/**
 * Create a valid BookingRequest with optional overrides
 */
export const createBookingRequest = (overrides?: Partial<BookingRequest>): BookingRequest => ({
  serviceId: '12345',
  providerId: '67890',
  datetime: '2026-02-15T19:00:00.000Z', // UTC format for zod validation
  client: createClient(),
  paymentMethod: 'cash',
  idempotencyKey: 'test-idempotency-key-12345',
  ...overrides,
});

/**
 * Create a valid Booking with optional overrides
 */
export const createBooking = (overrides?: Partial<Booking>): Booking => ({
  id: '11111',
  serviceId: '12345',
  serviceName: 'TMD 60min (including intraoral)',
  providerId: '67890',
  providerName: 'Jen Sullivan',
  datetime: '2026-02-15T19:00:00.000Z',
  endTime: '2026-02-15T20:00:00.000Z',
  duration: 60,
  price: 20000,
  currency: 'USD',
  client: createClient(),
  status: 'confirmed',
  confirmationCode: '11111',
  paymentStatus: 'paid',
  paymentRef: '[CASH] Transaction: cash_11111',
  createdAt: '2026-02-10T15:00:00.000Z',
  ...overrides,
});

/**
 * Create a valid SlotReservation with optional overrides
 */
export const createReservation = (overrides?: Partial<SlotReservation>): SlotReservation => ({
  id: '99999',
  datetime: '2026-02-15T19:00:00.000Z',
  duration: 60,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  providerId: '67890',
  ...overrides,
});

/**
 * Create a valid PaymentIntent with optional overrides
 */
export const createPaymentIntent = (overrides?: Partial<PaymentIntent>): PaymentIntent => ({
  id: 'pi_test_12345',
  amount: 20000,
  currency: 'USD',
  status: 'pending',
  processor: 'cash',
  createdAt: new Date().toISOString(),
  ...overrides,
});

/**
 * Create a valid PaymentResult with optional overrides
 */
export const createPaymentResult = (overrides?: Partial<PaymentResult>): PaymentResult => ({
  success: true,
  transactionId: 'txn_test_12345',
  processor: 'cash',
  amount: 20000,
  currency: 'USD',
  timestamp: new Date().toISOString(),
  ...overrides,
});

/**
 * Create a valid TimeSlot with optional overrides
 */
export const createTimeSlot = (overrides?: Partial<TimeSlot>): TimeSlot => ({
  datetime: '2026-02-15T19:00:00.000Z',
  available: true,
  providerId: '67890',
  ...overrides,
});

/**
 * Create multiple time slots for a day (UTC format)
 */
export const createDaySlots = (
  date: string,
  providerId: string,
  startHour = 14, // 9 AM EST = 14:00 UTC
  endHour = 22, // 5 PM EST = 22:00 UTC
  intervalMinutes = 30
): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      slots.push({
        datetime: `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
        available: true,
        providerId,
      });
    }
  }
  return slots;
};

/**
 * Create available dates for a month
 */
export const createMonthDates = (year: number, month: number, slotsPerDay = 8): AvailableDate[] => {
  const dates: AvailableDate[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    // Skip weekends (simple simulation)
    const date = new Date(year, month - 1, day);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      dates.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        slots: slotsPerDay,
      });
    }
  }

  return dates;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Add minutes to an ISO datetime string
 */
const addMinutesToIso = (isoString: string, minutes: number): string => {
  const date = new Date(isoString);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
};

/**
 * Generate a batch of unique services
 */
export const createServiceBatch = (count: number): Service[] =>
  Array.from({ length: count }, (_, i) =>
    createService({
      id: String(10000 + i),
      name: `Service ${i + 1}`,
      price: (i + 1) * 5000, // $50, $100, $150, ...
    })
  );

/**
 * Generate a batch of providers
 */
export const createProviderBatch = (count: number): Provider[] =>
  Array.from({ length: count }, (_, i) =>
    createProvider({
      id: String(20000 + i),
      name: `Provider ${i + 1}`,
      email: `provider${i + 1}@example.com`,
    })
  );
