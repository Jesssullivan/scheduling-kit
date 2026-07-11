/**
 * Tests for core/pipelines.ts
 * Orchestration pipeline tests with mock adapters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import {
  completeBookingWithAltPayment,
  getAvailabilityWithService,
  getTimeSlotsWithService,
  cancelBookingWithRefund,
  createSchedulingKit,
  type PipelineContext,
  type BookingPipelineInput,
} from '../../../core/pipelines.js';
import { Errors } from '../../../core/types.js';
import { formatPaymentRef } from '../../../core/payment-ref.js';
import type { SchedulingAdapter } from '../../../adapters/types.js';
import type { PaymentAdapter, PaymentWebhookEvent } from '../../../payments/types.js';
import {
  createService,
  createProvider,
  createBooking,
  createBookingRequest,
  softHoldSlot,
  createPaymentIntent,
  createPaymentResult,
  createTimeSlot,
  createDaySlots,
} from '../../helpers/factories.js';
import {
  expectSuccess,
  expectFailure,
  expectFailureTag,
} from '../../helpers/effect.js';

// =============================================================================
// MOCK ADAPTERS
// =============================================================================

const createMockScheduler = (): SchedulingAdapter => ({
  name: 'mock',

  // Services
  getServices: vi.fn(() => Effect.succeed([createService()])),
  getService: vi.fn((id) => Effect.succeed(createService({ id }))),

  // Providers
  getProviders: vi.fn(() => Effect.succeed([createProvider()])),
  getProvider: vi.fn((id) => Effect.succeed(createProvider({ id }))),
  getProvidersForService: vi.fn(() => Effect.succeed([createProvider()])),

  // Availability
  getAvailableDates: vi.fn(() =>
    Effect.succeed([
      { date: '2026-02-15', slots: 5 },
      { date: '2026-02-16', slots: 3 },
    ])
  ),
  getAvailableSlots: vi.fn(() => Effect.succeed(createDaySlots('2026-02-15', '67890'))),
  checkSlotAvailability: vi.fn(() => Effect.succeed(true)),

  // Reservations
  softHoldSlot: vi.fn(() => Effect.succeed(softHoldSlot())),
  releaseSoftHold: vi.fn(() => Effect.succeed(undefined)),

  // Bookings
  createBooking: vi.fn(() => Effect.succeed(createBooking())),
  createBookingWithPaymentRef: vi.fn((_, ref, processor) =>
    Effect.succeed(createBooking({ paymentRef: formatPaymentRef({ processor, transactionId: ref }) }))
  ),
  getBooking: vi.fn(() => Effect.succeed(createBooking())),
  cancelBooking: vi.fn(() => Effect.succeed(undefined)),
  rescheduleBooking: vi.fn(() => Effect.succeed(createBooking())),

  // Clients
  findOrCreateClient: vi.fn(() => Effect.succeed({ id: 'client-1', isNew: true })),
  getClientByEmail: vi.fn(() => Effect.succeed(null)),
});

const createMockPaymentAdapter = (name = 'cash'): PaymentAdapter => ({
  name,
  displayName: 'Cash',
  isAvailable: vi.fn(() => Effect.succeed(true)),
  createIntent: vi.fn(() => Effect.succeed(createPaymentIntent())),
  capturePayment: vi.fn(() => Effect.succeed(createPaymentResult())),
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
      type: 'payment.completed',
      intentId: 'pi_test_12345',
      transactionId: 'txn_test_12345',
      amount: 20000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
      raw: {},
    } satisfies PaymentWebhookEvent)
  ),
  getClientConfig: () => ({
    name,
    displayName: 'Cash',
    instructions: { cash: 'Pay in cash at appointment' },
    environment: 'production',
    supportedCurrencies: ['USD'],
  }),
});

// =============================================================================
// COMPLETE BOOKING PIPELINE TESTS
// =============================================================================

describe('completeBookingWithAltPayment', () => {
  let scheduler: SchedulingAdapter;
  let paymentAdapter: PaymentAdapter;
  let ctx: PipelineContext;
  let input: BookingPipelineInput;

  beforeEach(() => {
    scheduler = createMockScheduler();
    paymentAdapter = createMockPaymentAdapter();
    ctx = {
      scheduler,
      payments: new Map([['cash', paymentAdapter]]),
      correlationId: 'test-correlation-id',
    };
    input = {
      request: createBookingRequest(),
      paymentMethod: 'cash',
    };
  });

  it('completes booking successfully with all steps', async () => {
    const result = await expectSuccess(completeBookingWithAltPayment(ctx, input));

    expect(result.booking).toBeDefined();
    expect(result.payment).toBeDefined();
    expect(result.payment.success).toBe(true);

    // Verify all steps were called
    expect(scheduler.getService).toHaveBeenCalledWith(input.request.serviceId);
    expect(scheduler.checkSlotAvailability).toHaveBeenCalled();
    expect(scheduler.softHoldSlot).toHaveBeenCalled();
    expect(paymentAdapter.createIntent).toHaveBeenCalled();
    expect(paymentAdapter.capturePayment).toHaveBeenCalled();
    expect(scheduler.createBookingWithPaymentRef).toHaveBeenCalled();
    expect(scheduler.releaseSoftHold).toHaveBeenCalled();
  });

  it('returns error for unknown payment method', async () => {
    const unknownInput: BookingPipelineInput = { ...input, paymentMethod: 'unknown' };

    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, unknownInput),
      'PaymentError'
    );

    expect(error._tag).toBe('PaymentError');
    if (error._tag === 'PaymentError') {
      expect(error.code).toBe('INVALID_METHOD');
    }
  });

  it('resolves the public card id to the internally named stripe adapter', async () => {
    const stripe = createMockPaymentAdapter('stripe');
    const cardCtx: PipelineContext = {
      scheduler,
      payments: new Map([['stripe', stripe]]),
      correlationId: 'test-correlation-id',
    };

    const result = await expectSuccess(
      completeBookingWithAltPayment(cardCtx, { ...input, paymentMethod: 'card' })
    );

    expect(result.payment.success).toBe(true);
    expect(stripe.createIntent).toHaveBeenCalled();
    expect(stripe.capturePayment).toHaveBeenCalled();
  });

  it('fails unsupported card selection with a typed error instead of a manual adapter', async () => {
    // Only a manual cash adapter is registered; the public 'card' selection
    // must NOT fall through to it.
    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, { ...input, paymentMethod: 'card' }),
      'PaymentError'
    );

    expect(error._tag).toBe('PaymentError');
    if (error._tag === 'PaymentError') {
      expect(error.code).toBe('INVALID_METHOD');
    }
    expect(paymentAdapter.createIntent).not.toHaveBeenCalled();
  });

  it('fails unsupported venmo selection with a typed error instead of a manual adapter', async () => {
    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, { ...input, paymentMethod: 'venmo' }),
      'PaymentError'
    );

    expect(error._tag).toBe('PaymentError');
    if (error._tag === 'PaymentError') {
      expect(error.code).toBe('INVALID_METHOD');
    }
    expect(paymentAdapter.createIntent).not.toHaveBeenCalled();
  });

  it('returns validation error for invalid request', async () => {
    const invalidInput: BookingPipelineInput = {
      ...input,
      request: { ...input.request, client: { ...input.request.client, email: 'invalid' } },
    };

    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, invalidInput),
      'ValidationError'
    );

    expect(error._tag).toBe('ValidationError');
  });

  it('returns soft hold error when slot is taken', async () => {
    vi.mocked(scheduler.checkSlotAvailability).mockReturnValue(Effect.succeed(false));

    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, input),
      'ReservationError'
    );

    expect(error._tag).toBe('ReservationError');
    if (error._tag === 'ReservationError') {
      expect(error.code).toBe('SLOT_TAKEN');
    }
  });

  it('stops before payment when atomic soft-hold acquisition reports SLOT_TAKEN', async () => {
    vi.mocked(scheduler.softHoldSlot).mockReturnValue(
      Effect.fail(
        Errors.reservation(
          'SLOT_TAKEN',
          'Another checkout already holds this slot',
          input.request.datetime,
        ),
      ),
    );

    const error = await expectFailureTag(
      completeBookingWithAltPayment(ctx, input),
      'ReservationError',
    );

    expect(error).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(paymentAdapter.createIntent).not.toHaveBeenCalled();
    expect(paymentAdapter.capturePayment).not.toHaveBeenCalled();
    expect(scheduler.createBookingWithPaymentRef).not.toHaveBeenCalled();
  });

  it('injects only the hold acquired by the pipeline into the booking write', async () => {
    const requestWithForeignHold = {
      ...input.request,
      softHoldId: 'caller-supplied-hold',
    };

    await expectSuccess(
      completeBookingWithAltPayment(ctx, {
        ...input,
        request: requestWithForeignHold,
      }),
    );

    expect(scheduler.createBookingWithPaymentRef).toHaveBeenCalledWith(
      expect.objectContaining({ softHoldId: '99999' }),
      expect.any(String),
      expect.any(String),
    );
    const bookingRequest = vi.mocked(scheduler.createBookingWithPaymentRef)
      .mock.calls[0][0] as typeof requestWithForeignHold;
    expect(bookingRequest.softHoldId).not.toBe('caller-supplied-hold');
  });

  it('releases soft hold on payment intent failure', async () => {
    vi.mocked(paymentAdapter.createIntent).mockReturnValue(
      Effect.fail(Errors.payment('INTENT_FAILED', 'Failed to create intent', 'cash'))
    );

    await expectFailure(completeBookingWithAltPayment(ctx, input));

    // Soft hold should have been released
    expect(scheduler.releaseSoftHold).toHaveBeenCalled();
  });

  it('releases soft hold on payment capture failure', async () => {
    vi.mocked(paymentAdapter.capturePayment).mockReturnValue(
      Effect.fail(Errors.payment('CAPTURE_FAILED', 'Failed to capture payment', 'cash'))
    );

    await expectFailure(completeBookingWithAltPayment(ctx, input));

    expect(scheduler.releaseSoftHold).toHaveBeenCalled();
  });

  it('refunds payment on booking creation failure', async () => {
    vi.mocked(scheduler.createBookingWithPaymentRef).mockReturnValue(
      Effect.fail(Errors.acuity('BOOKING_FAILED', 'Failed to create booking'))
    );

    await expectFailure(completeBookingWithAltPayment(ctx, input));

    // Payment should have been refunded
    expect(paymentAdapter.refund).toHaveBeenCalled();
    expect(scheduler.releaseSoftHold).toHaveBeenCalled();
  });

  it('continues without softHold if softHold fails', async () => {
    vi.mocked(scheduler.softHoldSlot).mockReturnValue(
      Effect.fail(Errors.reservation('BLOCK_FAILED', 'Could not create block'))
    );

    const result = await expectSuccess(completeBookingWithAltPayment(ctx, input));

    expect(result.booking).toBeDefined();
    expect(result.softHold).toBeUndefined();
  });
});

// =============================================================================
// AVAILABILITY PIPELINE TESTS
// =============================================================================

describe('getAvailabilityWithService', () => {
  let scheduler: SchedulingAdapter;

  beforeEach(() => {
    scheduler = createMockScheduler();
  });

  it('returns service with available dates', async () => {
    const result = await expectSuccess(
      getAvailabilityWithService(scheduler, {
        serviceId: '12345',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })
    );

    expect(result.service).toBeDefined();
    expect(result.dates.length).toBeGreaterThan(0);
    expect(scheduler.getService).toHaveBeenCalledWith('12345');
    expect(scheduler.getAvailableDates).toHaveBeenCalled();
  });

  it('passes provider ID when specified', async () => {
    await expectSuccess(
      getAvailabilityWithService(scheduler, {
        serviceId: '12345',
        providerId: '67890',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })
    );

    expect(scheduler.getAvailableDates).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: '67890' })
    );
  });

  it('propagates service not found error', async () => {
    vi.mocked(scheduler.getService).mockReturnValue(
      Effect.fail(Errors.acuity('NOT_FOUND', 'Service not found'))
    );

    const error = await expectFailureTag(
      getAvailabilityWithService(scheduler, {
        serviceId: 'unknown',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      }),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
  });
});

// =============================================================================
// TIME SLOTS PIPELINE TESTS
// =============================================================================

describe('getTimeSlotsWithService', () => {
  let scheduler: SchedulingAdapter;

  beforeEach(() => {
    scheduler = createMockScheduler();
  });

  it('returns service with time slots', async () => {
    const result = await expectSuccess(
      getTimeSlotsWithService(scheduler, {
        serviceId: '12345',
        date: '2026-02-15',
      })
    );

    expect(result.service).toBeDefined();
    expect(result.date).toBe('2026-02-15');
    expect(result.slots.length).toBeGreaterThan(0);
  });

  it('propagates availability fetch error', async () => {
    vi.mocked(scheduler.getAvailableSlots).mockReturnValue(
      Effect.fail(Errors.acuity('API_ERROR', 'Failed to fetch slots'))
    );

    const error = await expectFailure(
      getTimeSlotsWithService(scheduler, {
        serviceId: '12345',
        date: '2026-02-15',
      })
    );

    expect(error._tag).toBe('AcuityError');
  });
});

// =============================================================================
// CANCELLATION PIPELINE TESTS
// =============================================================================

describe('cancelBookingWithRefund', () => {
  let scheduler: SchedulingAdapter;
  let paymentAdapter: PaymentAdapter;
  let ctx: PipelineContext;

  beforeEach(() => {
    scheduler = createMockScheduler();
    paymentAdapter = createMockPaymentAdapter();
    ctx = {
      scheduler,
      payments: new Map([['cash', paymentAdapter]]),
      correlationId: 'test-correlation-id',
    };
  });

  it('cancels booking without refund', async () => {
    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, {
        bookingId: '100001',
        reason: 'Customer request',
        refund: false,
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund).toBeUndefined();
    expect(scheduler.cancelBooking).toHaveBeenCalledWith('100001', 'Customer request');
    expect(paymentAdapter.refund).not.toHaveBeenCalled();
  });

  it('cancels booking with refund when payment ref exists', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: '[CASH] Transaction: cash_12345',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, {
        bookingId: '100001',
        refund: true,
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(true);
    expect(result.refund?.refundId).toBeDefined();
    expect(paymentAdapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'cash_12345' })
    );
  });

  it('returns success with failed refund when processor not found', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: '[UNKNOWN] Transaction: unknown_12345',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, {
        bookingId: '100001',
        refund: true,
      })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(false);
  });

  it('fails with typed ValidationError and does not cancel when payment ref is unparseable', async () => {
    // Legacy behavior: cancelled the booking and silently reported
    // refund.success: false. New behavior: a refund that cannot be honored
    // refuses the whole operation before any state is mutated.
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: '[CASH] No transaction here',
        })
      )
    );

    const error = await expectFailureTag(
      cancelBookingWithRefund(ctx, {
        bookingId: '100001',
        refund: true,
      }),
      'ValidationError'
    );

    expect(error._tag === 'ValidationError' && error.field).toBe('paymentRef');
    expect(scheduler.cancelBooking).not.toHaveBeenCalled();
    expect(paymentAdapter.refund).not.toHaveBeenCalled();
  });

  it('fails with typed ValidationError for a raw payment ref with no structured paymentMethod', async () => {
    // No wire format AND no structured processor field — there is nothing to
    // route the refund with, so the operation is refused before mutation.
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
          paymentMethod: undefined,
        })
      )
    );

    const error = await expectFailureTag(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: true }),
      'ValidationError'
    );

    expect(error._tag === 'ValidationError' && error.value).toBe('pi_3MtwBwLkdIwHu7ix28a3tqPa');
    expect(scheduler.cancelBooking).not.toHaveBeenCalled();
  });

  it('refunds via the structured paymentMethod when the stored ref is a raw transaction id', async () => {
    // The homegrown adapter never writes the wire format: it stores the bare
    // transaction id in paymentRef and the processor in its own
    // paymentMethod column. This is the steady state for every paid booking
    // the kit's own happy path creates on a homegrown backend.
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: 'txn_homegrown_1',
          paymentMethod: 'cash',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: true })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(true);
    expect(paymentAdapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn_homegrown_1' })
    );
  });

  it('keeps the soft refund failure when the structured paymentMethod has no registered adapter', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: 'txn_homegrown_2',
          paymentMethod: 'venmo',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: true })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(false);
    expect(paymentAdapter.refund).not.toHaveBeenCalled();
  });

  it('prefers the wire-format ref over the structured paymentMethod when both resolve', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: '[CASH] Transaction: cash_55',
          paymentMethod: 'venmo',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: true })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(true);
    expect(paymentAdapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'cash_55' })
    );
  });

  it('still cancels a booking with an unparseable ref when no refund is requested', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef: 'not a wire-format ref',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: false })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund).toBeUndefined();
    expect(scheduler.cancelBooking).toHaveBeenCalledWith('100001', undefined);
  });

  it('refunds using the canonical marker when the ref is embedded in note text', async () => {
    // Acuity stores the payment marker inside the appointment notes field,
    // surrounded by client notes and refund annotations. The stray [VIP]
    // token would have been mis-parsed as the processor by the legacy regex;
    // the codec prefers the intact canonical marker.
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.succeed(
        createBooking({
          paymentRef:
            'Client prefers afternoons [VIP]\n\n[CASH] Transaction: cash_77777 [REFUND] refund_77777',
        })
      )
    );

    const result = await expectSuccess(
      cancelBookingWithRefund(ctx, { bookingId: '100001', refund: true })
    );

    expect(result.cancelled).toBe(true);
    expect(result.refund?.success).toBe(true);
    expect(paymentAdapter.refund).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'cash_77777' })
    );
  });

  it('propagates booking not found error', async () => {
    vi.mocked(scheduler.getBooking).mockReturnValue(
      Effect.fail(Errors.acuity('NOT_FOUND', 'Booking not found'))
    );

    const error = await expectFailureTag(
      cancelBookingWithRefund(ctx, { bookingId: 'unknown' }),
      'AcuityError'
    );

    expect(error._tag).toBe('AcuityError');
  });
});

// =============================================================================
// SCHEDULING KIT FACTORY TESTS
// =============================================================================

describe('createSchedulingKit', () => {
  let scheduler: SchedulingAdapter;
  let paymentAdapter: PaymentAdapter;

  beforeEach(() => {
    scheduler = createMockScheduler();
    paymentAdapter = createMockPaymentAdapter();
  });

  it('creates kit with all methods', () => {
    const kit = createSchedulingKit(scheduler, [paymentAdapter]);

    expect(kit.scheduler).toBe(scheduler);
    expect(kit.payments.get('cash')).toBe(paymentAdapter);
    expect(kit.completeBooking).toBeDefined();
    expect(kit.getAvailability).toBeDefined();
    expect(kit.getTimeSlots).toBeDefined();
    expect(kit.cancelBooking).toBeDefined();
  });

  it('registers multiple payment adapters', () => {
    const venmo = createMockPaymentAdapter('venmo');
    const zelle = createMockPaymentAdapter('zelle');
    const kit = createSchedulingKit(scheduler, [paymentAdapter, venmo, zelle]);

    expect(kit.payments.get('cash')).toBeDefined();
    expect(kit.payments.get('venmo')).toBeDefined();
    expect(kit.payments.get('zelle')).toBeDefined();
    expect(kit.payments.getAll().length).toBe(3);
  });

  it('completeBooking delegates to pipeline', async () => {
    const kit = createSchedulingKit(scheduler, [paymentAdapter]);

    const result = await expectSuccess(
      kit.completeBooking(createBookingRequest(), 'cash')
    );

    expect(result.booking).toBeDefined();
  });

  it('aliases stripe adapters behind the public card id', async () => {
    const stripe = createMockPaymentAdapter('stripe');
    const kit = createSchedulingKit(scheduler, [stripe]);

    expect(kit.payments.get('stripe')).toBe(stripe);
    expect(kit.payments.get('card')).toBe(stripe);

    const methods = await kit.payments.getAvailableMethods();
    expect(methods.map((m) => m.id)).toEqual(['card']);
    expect(methods.map((m) => m.id)).not.toContain('stripe');
  });

  it('never lets the stripe alias clobber a literally named card adapter', async () => {
    // Registration order must not decide who owns the 'card' id: the
    // literally named adapter wins, matching registry.get() precedence.
    for (const order of ['card-first', 'stripe-first'] as const) {
      const card = createMockPaymentAdapter('card');
      const stripe = createMockPaymentAdapter('stripe');
      const adapters = order === 'card-first' ? [card, stripe] : [stripe, card];
      const kit = createSchedulingKit(scheduler, adapters);

      expect(kit.payments.get('card')).toBe(card);
      expect(kit.payments.get('stripe')).toBe(stripe);

      const result = await expectSuccess(
        kit.completeBooking(createBookingRequest(), 'card')
      );

      expect(result.booking).toBeDefined();
      expect(card.createIntent).toHaveBeenCalled();
      expect(stripe.createIntent).not.toHaveBeenCalled();
    }
  });

  it('completeBooking accepts the public card id for stripe-backed flows', async () => {
    const stripe = createMockPaymentAdapter('stripe');
    const kit = createSchedulingKit(scheduler, [stripe]);

    const result = await expectSuccess(
      kit.completeBooking(createBookingRequest(), 'card')
    );

    expect(result.booking).toBeDefined();
    expect(stripe.createIntent).toHaveBeenCalled();
    expect(stripe.capturePayment).toHaveBeenCalled();
  });

  it('completeBooking rejects card when no card-capable adapter is registered', async () => {
    const kit = createSchedulingKit(scheduler, [paymentAdapter]);

    const error = await expectFailureTag(
      kit.completeBooking(createBookingRequest(), 'card'),
      'PaymentError'
    );

    if (error._tag === 'PaymentError') {
      expect(error.code).toBe('INVALID_METHOD');
    }
    expect(paymentAdapter.createIntent).not.toHaveBeenCalled();
  });

  it('getAvailability delegates to pipeline', async () => {
    const kit = createSchedulingKit(scheduler, []);

    const result = await expectSuccess(
      kit.getAvailability({
        serviceId: '12345',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })
    );

    expect(result.service).toBeDefined();
    expect(result.dates).toBeDefined();
  });

  it('getTimeSlots delegates to pipeline', async () => {
    const kit = createSchedulingKit(scheduler, []);

    const result = await expectSuccess(
      kit.getTimeSlots({
        serviceId: '12345',
        date: '2026-02-15',
      })
    );

    expect(result.slots).toBeDefined();
  });

  it('cancelBooking delegates to pipeline', async () => {
    const kit = createSchedulingKit(scheduler, [paymentAdapter]);

    const result = await expectSuccess(
      kit.cancelBooking({ bookingId: '100001' })
    );

    expect(result.cancelled).toBe(true);
  });
});
