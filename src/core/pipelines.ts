/**
 * Orchestration Pipelines
 * Effect-based composition of scheduling + payment flows
 */

import { Effect, pipe } from 'effect';
import type {
  SchedulingResult,
  BookingRequest,
  Booking,
  SlotReservation,
  PaymentResult,
  Service,
  TimeSlot,
  AvailableDate,
} from './types.js';
import { Errors } from './types.js';
import { validateWith, generateIdempotencyKey, withCorrelationId } from './utils.js';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { PaymentAdapter, PaymentRegistry as CanonicalPaymentRegistry } from '../payments/types.js';
import { createPaymentRegistry, toPublicPaymentMethodId } from '../payments/types.js';
import { z } from 'zod';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const ClientInfoSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

const BookingRequestSchema = z.object({
  serviceId: z.string().min(1),
  providerId: z.string().optional(),
  datetime: z.string().datetime({ local: true }),
  client: ClientInfoSchema,
  paymentMethod: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

// =============================================================================
// PIPELINE CONTEXT
// =============================================================================

export interface PipelineContext {
  readonly scheduler: SchedulingAdapter;
  readonly payments: Map<string, PaymentAdapter>;
  readonly correlationId: string;
}

export interface BookingPipelineInput {
  readonly request: BookingRequest;
  readonly paymentMethod: string;
}

export interface BookingPipelineResult {
  readonly booking: Booking;
  readonly payment: PaymentResult;
  readonly reservation?: SlotReservation;
}

// =============================================================================
// MAIN BOOKING PIPELINE
// =============================================================================

/**
 * Complete booking with alternative payment
 *
 * Flow:
 * 1. Validate request
 * 2. Check slot availability
 * 3. Create slot reservation (block)
 * 4. Process payment
 * 5. Create booking with payment reference
 * 6. Release reservation
 * 7. Return result
 *
 * On payment failure: Release reservation, return error
 * On booking failure: Refund payment, release reservation, return error
 */
export const completeBookingWithAltPayment = (
  ctx: PipelineContext,
  input: BookingPipelineInput
): SchedulingResult<BookingPipelineResult> => {
  const { scheduler, payments, correlationId } = ctx;
  const { request, paymentMethod } = input;

  const paymentAdapter = payments.get(paymentMethod);
  if (!paymentAdapter) {
    return Effect.fail(Errors.payment('INVALID_METHOD', `Unknown payment method: ${paymentMethod}`, paymentMethod, false));
  }

  const pipeline = Effect.gen(function* () {
    // Phase A: Validate and check availability
    yield* validateWith(BookingRequestSchema, request);
    const service = yield* scheduler.getService(request.serviceId);
    const available = yield* scheduler.checkSlotAvailability({
      serviceId: request.serviceId,
      providerId: request.providerId,
      datetime: request.datetime,
    });
    if (!available) {
      return yield* Effect.fail(
        Errors.reservation('SLOT_TAKEN', 'This time slot is no longer available', request.datetime)
      );
    }

    // Phase B: Reserve slot (optional — graceful fallback if adapter doesn't support)
    const reservation = yield* pipe(
      scheduler.createReservation({
        serviceId: request.serviceId,
        providerId: request.providerId,
        datetime: request.datetime,
        duration: service.duration,
        notes: `Payment pending: ${request.idempotencyKey}`,
      }),
      Effect.map((r) => r as SlotReservation | undefined),
      Effect.catchAll(() => Effect.succeed(undefined as SlotReservation | undefined)),
    );

    // Phase C: Process payment (release reservation on failure)
    const payment = yield* pipe(
      Effect.flatMap(
        paymentAdapter.createIntent({
          amount: service.price,
          currency: service.currency,
          description: `${service.name} - ${request.client.firstName} ${request.client.lastName}`,
          metadata: { serviceId: request.serviceId, datetime: request.datetime, correlationId },
          idempotencyKey: `${request.idempotencyKey}_intent`,
        }),
        (intent) => paymentAdapter.capturePayment(intent.id),
      ),
      Effect.catchAll((error) => {
        if (reservation) {
          return Effect.flatMap(
            scheduler.releaseReservation(reservation.id),
            () => Effect.fail(error),
          );
        }
        return Effect.fail(error);
      }),
    );

    // Phase D: Create booking (refund + release on failure)
    const booking = yield* pipe(
      scheduler.createBookingWithPaymentRef(request, payment.transactionId, paymentAdapter.name),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.catchAll(
            paymentAdapter.refund({ transactionId: payment.transactionId, reason: 'Booking creation failed' }),
            () => Effect.succeed(undefined),
          );
          if (reservation) {
            yield* Effect.catchAll(
              scheduler.releaseReservation(reservation.id),
              () => Effect.succeed(undefined),
            );
          }
          return yield* Effect.fail(error);
        }),
      ),
    );

    // Phase E: Cleanup — release reservation
    if (reservation) {
      yield* Effect.catchAll(
        scheduler.releaseReservation(reservation.id),
        () => Effect.succeed(undefined),
      );
    }

    return { booking, payment, reservation } satisfies BookingPipelineResult;
  });

  return pipe(pipeline, withCorrelationId('completeBookingWithAltPayment', correlationId));
};

// =============================================================================
// AVAILABILITY PIPELINE
// =============================================================================

export interface AvailabilityInput {
  readonly serviceId: string;
  readonly providerId?: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface AvailabilityResult {
  readonly service: Service;
  readonly dates: AvailableDate[];
}

/**
 * Get availability with service details
 */
export const getAvailabilityWithService = (
  scheduler: SchedulingAdapter,
  input: AvailabilityInput
): SchedulingResult<AvailabilityResult> =>
  Effect.gen(function* () {
    const service = yield* scheduler.getService(input.serviceId);
    const dates = yield* scheduler.getAvailableDates({
      serviceId: input.serviceId,
      providerId: input.providerId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return { service, dates };
  });

// =============================================================================
// TIME SLOTS PIPELINE
// =============================================================================

export interface TimeSlotsInput {
  readonly serviceId: string;
  readonly providerId?: string;
  readonly date: string;
}

export interface TimeSlotsResult {
  readonly service: Service;
  readonly date: string;
  readonly slots: TimeSlot[];
}

/**
 * Get time slots with service details
 */
export const getTimeSlotsWithService = (
  scheduler: SchedulingAdapter,
  input: TimeSlotsInput
): SchedulingResult<TimeSlotsResult> =>
  Effect.gen(function* () {
    const service = yield* scheduler.getService(input.serviceId);
    const slots = yield* scheduler.getAvailableSlots({
      serviceId: input.serviceId,
      providerId: input.providerId,
      date: input.date,
    });
    return { service, date: input.date, slots };
  });

// =============================================================================
// CANCELLATION PIPELINE
// =============================================================================

export interface CancellationInput {
  readonly bookingId: string;
  readonly reason?: string;
  readonly refund?: boolean;
}

export interface CancellationResult {
  readonly cancelled: true;
  readonly refund?: {
    readonly success: boolean;
    readonly refundId?: string;
  };
}

/**
 * Cancel booking with optional refund
 */
export const cancelBookingWithRefund = (
  ctx: PipelineContext,
  input: CancellationInput
): SchedulingResult<CancellationResult> => {
  const { scheduler, payments } = ctx;

  return Effect.gen(function* () {
    const booking = yield* scheduler.getBooking(input.bookingId);
    yield* scheduler.cancelBooking(input.bookingId, input.reason);

    if (!input.refund || !booking.paymentRef) {
      return { cancelled: true } satisfies CancellationResult;
    }

    // Extract payment processor from notes
    const processorMatch = booking.paymentRef?.match(/\[(\w+)\]/);
    const processor = processorMatch?.[1]?.toLowerCase();
    const paymentAdapter = processor ? payments.get(processor) : undefined;

    if (!paymentAdapter) {
      return { cancelled: true, refund: { success: false } } satisfies CancellationResult;
    }

    const txMatch = booking.paymentRef?.match(/Transaction:\s*(\S+)/);
    const transactionId = txMatch?.[1];

    if (!transactionId) {
      return { cancelled: true, refund: { success: false } } satisfies CancellationResult;
    }

    const refundResult = yield* pipe(
      paymentAdapter.refund({ transactionId, reason: input.reason ?? 'Booking cancelled' }),
      Effect.catchAll(() => Effect.succeed({ success: false, refundId: '', originalTransactionId: transactionId, amount: 0, currency: 'USD', timestamp: new Date().toISOString() })),
    );

    return {
      cancelled: true,
      refund: {
        success: refundResult.success,
        refundId: refundResult.refundId,
      },
    } satisfies CancellationResult;
  });
};

// =============================================================================
// FACTORY
// =============================================================================

export interface SchedulingKit {
  readonly scheduler: SchedulingAdapter;
  readonly payments: CanonicalPaymentRegistry;

  completeBooking(
    request: BookingRequest,
    paymentMethod: string
  ): SchedulingResult<BookingPipelineResult>;

  getAvailability(input: AvailabilityInput): SchedulingResult<AvailabilityResult>;

  getTimeSlots(input: TimeSlotsInput): SchedulingResult<TimeSlotsResult>;

  cancelBooking(input: CancellationInput): SchedulingResult<CancellationResult>;
}

export const createSchedulingKit = (
  scheduler: SchedulingAdapter,
  paymentAdapters: PaymentAdapter[]
): SchedulingKit => {
  const registry = createPaymentRegistry();
  for (const adapter of paymentAdapters) {
    registry.register(adapter);
  }

  const payments = new Map<string, PaymentAdapter>();
  for (const a of registry.getAll()) {
    payments.set(a.name, a);
    payments.set(toPublicPaymentMethodId(a.name), a);
  }

  return {
    scheduler,
    payments: registry,

    completeBooking: (request, paymentMethod) =>
      completeBookingWithAltPayment(
        {
          scheduler,
          payments,
          correlationId: generateIdempotencyKey('booking'),
        },
        { request, paymentMethod }
      ),

    getAvailability: (input) => getAvailabilityWithService(scheduler, input),

    getTimeSlots: (input) => getTimeSlotsWithService(scheduler, input),

    cancelBooking: (input) =>
      cancelBookingWithRefund(
        {
          scheduler,
          payments,
          correlationId: generateIdempotencyKey('cancel'),
        },
        input
      ),
  };
};
