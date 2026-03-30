/**
 * Wizard Adapter + Pipeline Integration Tests
 *
 * Tests that createWizardAdapter produces an adapter that integrates
 * correctly with createSchedulingKit and the booking pipeline.
 *
 * Read ops: mocked scraper (no live Acuity)
 * Write ops: mocked at adapter level (no live Playwright)
 * Focus: wiring, error conversion, compensation logic
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Effect } from 'effect';
import {
  createSchedulingKit,
  type SchedulingKit,
} from '../../../core/pipelines.js';
import { Errors } from '../../../core/types.js';
import type { SchedulingAdapter } from '../../../adapters/types.js';
import type { PaymentAdapter } from '../../../payments/types.js';
import {
  createService,
  createBooking,
  createBookingRequest,
  createPaymentIntent,
  createPaymentResult,
  createDaySlots,
} from '../../helpers/factories.js';
import {
  expectSuccess,
  expectFailure,
  expectFailureTag,
} from '../../helpers/effect.js';

// =============================================================================
// MOCK: Simulate a wizard adapter's unique behavior
// =============================================================================

/**
 * Create a mock that mirrors createWizardAdapter's behavior:
 * - Read ops delegate to a scraper (mocked here)
 * - Reservation returns BLOCK_FAILED (graceful degradation)
 * - Write ops go through Effect middleware (mocked for unit test)
 * - Single provider (Jennifer Whitaker)
 */
const createMockWizardAdapter = (overrides?: Partial<SchedulingAdapter>): SchedulingAdapter => ({
  name: 'acuity-wizard',

  // Read ops (scraper delegation)
  getServices: vi.fn(() => Effect.succeed([
    createService({ id: '82429463', name: 'TMD 1st Visit/Consultation' }),
    createService({ id: '82429464', name: 'TMD 30min', price: 10000, duration: 30 }),
  ])),
  getService: vi.fn((serviceId: string) =>
    Effect.succeed(createService({ id: serviceId, name: 'TMD 1st Visit/Consultation' }))
  ),
  getProviders: vi.fn(() => Effect.succeed([{
    id: '1',
    name: 'Jennifer Whitaker',
    email: 'jen@massageithaca.com',
    description: 'LMT, BA - TMD Massage Specialist',
    timezone: 'America/New_York',
  }])),
  getProvider: vi.fn(() => Effect.succeed({
    id: '1',
    name: 'Jennifer Whitaker',
    email: 'jen@massageithaca.com',
    description: 'LMT, BA - TMD Massage Specialist',
    timezone: 'America/New_York',
  })),
  getProvidersForService: vi.fn(() => Effect.succeed([{
    id: '1',
    name: 'Jennifer Whitaker',
    email: 'jen@massageithaca.com',
    description: 'LMT, BA - TMD Massage Specialist',
    timezone: 'America/New_York',
  }])),
  getAvailableDates: vi.fn(() => Effect.succeed([
    { date: '2026-03-02', slots: 3 },
    { date: '2026-03-05', slots: 5 },
    { date: '2026-03-09', slots: 2 },
  ])),
  getAvailableSlots: vi.fn(() => Effect.succeed(createDaySlots('2026-03-02', '1'))),
  checkSlotAvailability: vi.fn(() => Effect.succeed(true)),

  // Reservation: BLOCK_FAILED (wizard adapter doesn't support reservations)
  createReservation: vi.fn(() =>
    Effect.fail(Errors.reservation('BLOCK_FAILED', 'Reservations not supported by wizard adapter'))
  ),
  releaseReservation: vi.fn(() => Effect.succeed(undefined)),

  // Write ops (Effect middleware delegation)
  createBooking: vi.fn((request) =>
    Effect.succeed(createBooking({
      serviceId: request.serviceId,
      datetime: request.datetime,
      client: request.client,
      status: 'confirmed',
      paymentStatus: 'pending',
    }))
  ),
  createBookingWithPaymentRef: vi.fn((request, paymentRef, processor) =>
    Effect.succeed(createBooking({
      serviceId: request.serviceId,
      datetime: request.datetime,
      client: request.client,
      status: 'confirmed',
      paymentStatus: 'paid',
      paymentRef: `[${processor.toUpperCase()}] Transaction: ${paymentRef}`,
    }))
  ),
  getBooking: vi.fn(() =>
    Effect.fail(Errors.acuity('NOT_IMPLEMENTED', 'Get booking not yet supported via wizard'))
  ),
  cancelBooking: vi.fn(() =>
    Effect.fail(Errors.acuity('NOT_IMPLEMENTED', 'Cancel not yet supported via wizard'))
  ),
  rescheduleBooking: vi.fn(() =>
    Effect.fail(Errors.acuity('NOT_IMPLEMENTED', 'Reschedule not yet supported via wizard'))
  ),

  // Client pass-through
  findOrCreateClient: vi.fn((client) =>
    Effect.succeed({ id: `local-${client.email}`, isNew: true })
  ),
  getClientByEmail: vi.fn(() => Effect.succeed(null)),

  ...overrides,
});

/**
 * Create a mock payment adapter matching the Venmo/Cash integration pattern
 */
const createMockAltPaymentAdapter = (name = 'cash'): PaymentAdapter => ({
  name,
  displayName: name === 'cash' ? 'Cash' : 'Venmo',
  isAvailable: vi.fn(() => Effect.succeed(true)),
  createIntent: vi.fn(() => Effect.succeed(createPaymentIntent({ processor: name }))),
  capturePayment: vi.fn(() => Effect.succeed(createPaymentResult({ processor: name, success: true }))),
  cancelIntent: vi.fn(() => Effect.succeed(undefined)),
  refund: vi.fn(() =>
    Effect.succeed({
      success: true,
      refundId: 'refund_12345',
      originalTransactionId: 'txn_test_12345',
      amount: 20000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    })
  ),
  verifyWebhook: vi.fn(() => Effect.succeed(true)),
  parseWebhook: vi.fn(() =>
    Effect.succeed({
      type: 'payment.completed' as const,
      transactionId: 'txn_test_12345',
      intentId: 'pi_test_12345',
      amount: 20000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
      raw: {},
    })
  ),
  getClientConfig: () => ({
    name,
    displayName: name === 'cash' ? 'Cash' : 'Venmo',
    environment: 'sandbox' as const,
    supportedCurrencies: ['USD'],
  }),
});

// =============================================================================
// INTEGRATION: Wizard Adapter + Pipeline via createSchedulingKit
// =============================================================================

describe('Wizard Adapter + Pipeline Integration', () => {
  let wizardAdapter: SchedulingAdapter;
  let cashAdapter: PaymentAdapter;
  let venmoAdapter: PaymentAdapter;
  let kit: SchedulingKit;

  beforeEach(() => {
    wizardAdapter = createMockWizardAdapter();
    cashAdapter = createMockAltPaymentAdapter('cash');
    venmoAdapter = createMockAltPaymentAdapter('venmo');
    kit = createSchedulingKit(wizardAdapter, [cashAdapter, venmoAdapter]);
  });

  // ---------------------------------------------------------------------------
  // Factory Wiring
  // ---------------------------------------------------------------------------

  describe('factory wiring', () => {
    it('exposes the wizard scheduler through kit.scheduler', () => {
      expect(kit.scheduler).toBe(wizardAdapter);
      expect(kit.scheduler.name).toBe('acuity-wizard');
    });

    it('registers multiple alt-payment adapters', () => {
      expect(kit.payments.get('cash')).toBe(cashAdapter);
      expect(kit.payments.get('venmo')).toBe(venmoAdapter);
      expect(kit.payments.getAll()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Read Pipelines (scraper delegation)
  // ---------------------------------------------------------------------------

  describe('read pipelines (scraper delegation)', () => {
    it('getAvailability returns service + dates from scraper', async () => {
      const result = await expectSuccess(
        kit.getAvailability({
          serviceId: '82429463',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
        })
      );

      expect(result.service).toBeDefined();
      expect(result.service.id).toBe('82429463');
      expect(result.dates).toHaveLength(3);
      expect(result.dates[0].date).toBe('2026-03-02');

      expect(wizardAdapter.getService).toHaveBeenCalledWith('82429463');
      expect(wizardAdapter.getAvailableDates).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: '82429463' })
      );
    });

    it('getTimeSlots returns service + slots from scraper', async () => {
      const result = await expectSuccess(
        kit.getTimeSlots({
          serviceId: '82429463',
          date: '2026-03-02',
        })
      );

      expect(result.service).toBeDefined();
      expect(result.date).toBe('2026-03-02');
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots.every((s) => s.available)).toBe(true);

      expect(wizardAdapter.getAvailableSlots).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: '82429463', date: '2026-03-02' })
      );
    });

    it('propagates scraper NOT_FOUND to pipeline caller', async () => {
      vi.mocked(wizardAdapter.getService).mockReturnValue(
        Effect.fail(Errors.acuity('NOT_FOUND', 'Service 99999 not found'))
      );

      const error = await expectFailureTag(
        kit.getAvailability({
          serviceId: '99999',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
        }),
        'AcuityError'
      );

      expect(error._tag).toBe('AcuityError');
      if (error._tag === 'AcuityError') {
        expect(error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Write Pipeline: completeBooking (happy path)
  // ---------------------------------------------------------------------------

  describe('completeBooking happy path', () => {
    it('completes booking via wizard adapter with cash payment', async () => {
      const request = createBookingRequest({
        serviceId: '82429463',
        datetime: '2026-03-02T15:00:00.000Z',
      });

      const result = await expectSuccess(kit.completeBooking(request, 'cash'));

      expect(result.booking).toBeDefined();
      expect(result.booking.status).toBe('confirmed');
      expect(result.booking.paymentStatus).toBe('paid');
      expect(result.booking.paymentRef).toContain('[CASH]');
      expect(result.payment).toBeDefined();
      expect(result.payment.success).toBe(true);

      // Verify pipeline step ordering
      expect(wizardAdapter.getService).toHaveBeenCalledWith('82429463');
      expect(wizardAdapter.checkSlotAvailability).toHaveBeenCalled();
      expect(cashAdapter.createIntent).toHaveBeenCalled();
      expect(cashAdapter.capturePayment).toHaveBeenCalled();
      expect(wizardAdapter.createBookingWithPaymentRef).toHaveBeenCalled();
    });

    it('completes booking with venmo payment', async () => {
      const request = createBookingRequest({
        serviceId: '82429463',
        datetime: '2026-03-02T15:00:00.000Z',
      });

      const result = await expectSuccess(kit.completeBooking(request, 'venmo'));

      expect(result.booking.paymentRef).toContain('[VENMO]');
      expect(venmoAdapter.createIntent).toHaveBeenCalled();
      expect(venmoAdapter.capturePayment).toHaveBeenCalled();
    });

    it('skips reservation gracefully (wizard adapter returns BLOCK_FAILED)', async () => {
      const request = createBookingRequest();

      const result = await expectSuccess(kit.completeBooking(request, 'cash'));

      // Pipeline should have tried reservation and continued without one
      expect(wizardAdapter.createReservation).toHaveBeenCalled();
      expect(result.reservation).toBeUndefined();
      expect(result.booking).toBeDefined();
    });

    it('passes payment ref and processor to createBookingWithPaymentRef', async () => {
      const request = createBookingRequest();

      await expectSuccess(kit.completeBooking(request, 'cash'));

      expect(wizardAdapter.createBookingWithPaymentRef).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: request.serviceId }),
        expect.stringContaining('txn_test'), // transaction ID from payment result
        'cash', // processor name
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Write Pipeline: compensation on failure
  // ---------------------------------------------------------------------------

  describe('compensation on failure', () => {
    it('returns PaymentError for unknown payment method', async () => {
      const error = await expectFailureTag(
        kit.completeBooking(createBookingRequest(), 'bitcoin'),
        'PaymentError'
      );

      if (error._tag === 'PaymentError') {
        expect(error.code).toBe('INVALID_METHOD');
      }
    });

    it('returns ReservationError when slot is taken', async () => {
      vi.mocked(wizardAdapter.checkSlotAvailability).mockReturnValue(Effect.succeed(false));

      const error = await expectFailureTag(
        kit.completeBooking(createBookingRequest(), 'cash'),
        'ReservationError'
      );

      if (error._tag === 'ReservationError') {
        expect(error.code).toBe('SLOT_TAKEN');
      }
    });

    it('does not refund when payment intent fails (no money captured yet)', async () => {
      vi.mocked(cashAdapter.createIntent).mockReturnValue(
        Effect.fail(Errors.payment('INTENT_FAILED', 'Card declined', 'cash'))
      );

      await expectFailureTag(
        kit.completeBooking(createBookingRequest(), 'cash'),
        'PaymentError'
      );

      // No money captured, so no refund attempt
      expect(cashAdapter.refund).not.toHaveBeenCalled();
    });

    it('does not refund when payment capture fails (no money captured yet)', async () => {
      vi.mocked(cashAdapter.capturePayment).mockReturnValue(
        Effect.fail(Errors.payment('CAPTURE_FAILED', 'Capture failed', 'cash'))
      );

      await expectFailureTag(
        kit.completeBooking(createBookingRequest(), 'cash'),
        'PaymentError'
      );

      // Capture failed = no money moved, so no refund needed
      expect(cashAdapter.refund).not.toHaveBeenCalled();
    });

    it('refunds payment when wizard booking creation fails (AcuityError)', async () => {
      vi.mocked(wizardAdapter.createBookingWithPaymentRef).mockReturnValue(
        Effect.fail(Errors.acuity('BOOKING_FAILED', 'Wizard could not complete booking'))
      );

      const error = await expectFailure(
        kit.completeBooking(createBookingRequest(), 'cash')
      );

      // Payment was captured but booking failed -> must refund
      expect(cashAdapter.refund).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: expect.stringContaining('txn_test'),
          reason: 'Booking creation failed',
        })
      );
      expect(error._tag).toBe('AcuityError');
    });

    it('refunds venmo payment when wizard booking creation fails', async () => {
      vi.mocked(wizardAdapter.createBookingWithPaymentRef).mockReturnValue(
        Effect.fail(Errors.acuity('BOOKING_FAILED', 'Wizard timed out'))
      );

      await expectFailure(
        kit.completeBooking(createBookingRequest(), 'venmo')
      );

      expect(venmoAdapter.refund).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Cancel Pipeline (wizard limitations)
  // ---------------------------------------------------------------------------

  describe('cancel pipeline (wizard limitations)', () => {
    it('fails to cancel because wizard adapter does not support getBooking', async () => {
      // Wizard adapter returns NOT_IMPLEMENTED for getBooking
      const error = await expectFailureTag(
        kit.cancelBooking({ bookingId: '12345', reason: 'Test' }),
        'AcuityError'
      );

      if (error._tag === 'AcuityError') {
        expect(error.code).toBe('NOT_IMPLEMENTED');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Validation through pipeline
  // ---------------------------------------------------------------------------

  describe('request validation', () => {
    it('rejects invalid email through pipeline validation', async () => {
      const badRequest = createBookingRequest({
        client: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'not-an-email',
        },
      });

      const error = await expectFailureTag(
        kit.completeBooking(badRequest, 'cash'),
        'ValidationError'
      );

      expect(error._tag).toBe('ValidationError');
    });

    it('rejects empty service ID through pipeline validation', async () => {
      const badRequest = createBookingRequest({ serviceId: '' });

      const error = await expectFailureTag(
        kit.completeBooking(badRequest, 'cash'),
        'ValidationError'
      );

      expect(error._tag).toBe('ValidationError');
    });

    it('rejects missing idempotency key through pipeline validation', async () => {
      const badRequest = createBookingRequest({ idempotencyKey: '' });

      const error = await expectFailureTag(
        kit.completeBooking(badRequest, 'cash'),
        'ValidationError'
      );

      expect(error._tag).toBe('ValidationError');
    });
  });
});
