/**
 * Orchestration Pipelines
 * Monadic composition of scheduling + payment flows
 */

import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
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
import { createPaymentRegistry } from '../payments/types.js';
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
    return TE.left(Errors.payment('INVALID_METHOD', `Unknown payment method: ${paymentMethod}`, paymentMethod, false));
  }

  // Break the pipeline into segments for TypeScript inference
  // (fp-ts pipe loses type accuracy after ~7 chained stages)

  // Phase A: Validate and get service
  const validated: SchedulingResult<{ service: Service }> = pipe(
    validateWith(BookingRequestSchema, request),
    TE.chain(() => scheduler.getService(request.serviceId)),
    TE.chain((service) =>
      pipe(
        scheduler.checkSlotAvailability({
          serviceId: request.serviceId,
          providerId: request.providerId,
          datetime: request.datetime,
        }),
        TE.chain((available) =>
          available
            ? TE.right({ service })
            : TE.left(Errors.reservation('SLOT_TAKEN', 'This time slot is no longer available', request.datetime))
        ),
      ),
    ),
  );

  // Phase B: Reserve slot (each step is a separate variable for TS inference)
  type WithService = { service: Service; reservation: SlotReservation | undefined };
  const reserved: SchedulingResult<WithService> = pipe(
    validated,
    TE.chain(({ service }) =>
      pipe(
        scheduler.createReservation({
          serviceId: request.serviceId,
          providerId: request.providerId,
          datetime: request.datetime,
          duration: service.duration,
          notes: `Payment pending: ${request.idempotencyKey}`,
        }),
        TE.map((reservation): WithService => ({ service, reservation })),
        TE.orElse((): SchedulingResult<WithService> => TE.right({ service, reservation: undefined })),
      ),
    ),
  );

  // Phase C: Process payment
  type WithPayment = WithService & { payment: PaymentResult };
  const paid: SchedulingResult<WithPayment> = pipe(
    reserved,
    TE.chain(({ service, reservation }) =>
      pipe(
        paymentAdapter.createIntent({
          amount: service.price,
          currency: service.currency,
          description: `${service.name} - ${request.client.firstName} ${request.client.lastName}`,
          metadata: { serviceId: request.serviceId, datetime: request.datetime, correlationId },
          idempotencyKey: `${request.idempotencyKey}_intent`,
        }),
        TE.chain((intent) => paymentAdapter.capturePayment(intent.id)),
        TE.map((payment): WithPayment => ({ service, reservation, payment })),
        TE.orElse((error) =>
          reservation
            ? pipe(scheduler.releaseReservation(reservation.id), TE.chain(() => TE.left(error)))
            : TE.left(error),
        ),
      ),
    ),
  );

  // Phase D: Create booking with payment reference
  const booked: SchedulingResult<BookingPipelineResult> = pipe(
    paid,
    TE.chain(({ reservation, payment }) => {
      const bookingCreated: SchedulingResult<BookingPipelineResult> = pipe(
        scheduler.createBookingWithPaymentRef(request, payment.transactionId, paymentAdapter.name),
        TE.map((booking): BookingPipelineResult => ({ booking, payment, reservation })),
      );

      // On booking failure: refund + release reservation
      return pipe(
        bookingCreated,
        TE.orElse((error): SchedulingResult<BookingPipelineResult> =>
          pipe(
            paymentAdapter.refund({ transactionId: payment.transactionId, reason: 'Booking creation failed' }),
            TE.chain(() => (reservation ? scheduler.releaseReservation(reservation.id) : TE.right(undefined))),
            TE.chain(() => TE.left(error)),
          ),
        ),
      );
    }),
  );

  // Phase E: Release reservation (cleanup) + logging
  const cleaned: SchedulingResult<BookingPipelineResult> = pipe(
    booked,
    TE.chain((result) =>
      result.reservation
        ? pipe(scheduler.releaseReservation(result.reservation.id), TE.map(() => result))
        : TE.right(result),
    ),
  );

  return pipe(cleaned, withCorrelationId('completeBookingWithAltPayment', correlationId));
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
  pipe(
    TE.Do,
    TE.bind('service', () => scheduler.getService(input.serviceId)),
    TE.bind('dates', () =>
      scheduler.getAvailableDates({
        serviceId: input.serviceId,
        providerId: input.providerId,
        startDate: input.startDate,
        endDate: input.endDate,
      })
    ),
    TE.map(({ service, dates }) => ({ service, dates }))
  );

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
  pipe(
    TE.Do,
    TE.bind('service', () => scheduler.getService(input.serviceId)),
    TE.bind('slots', () =>
      scheduler.getAvailableSlots({
        serviceId: input.serviceId,
        providerId: input.providerId,
        date: input.date,
      })
    ),
    TE.map(({ service, slots }) => ({ service, date: input.date, slots }))
  );

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

  return pipe(
    // Get booking to find payment info
    scheduler.getBooking(input.bookingId),

    // Cancel the booking
    TE.chain((booking) =>
      pipe(
        scheduler.cancelBooking(input.bookingId, input.reason),
        TE.map(() => booking)
      )
    ),

    // Process refund if requested and payment exists
    TE.chain((booking) => {
      if (!input.refund || !booking.paymentRef) {
        return TE.right({ cancelled: true });
      }

      // Extract payment processor from notes
      const processorMatch = booking.paymentRef?.match(/\[(\w+)\]/);
      const processor = processorMatch?.[1]?.toLowerCase();
      const paymentAdapter = processor ? payments.get(processor) : undefined;

      if (!paymentAdapter) {
        return TE.right({ cancelled: true, refund: { success: false } });
      }

      // Extract transaction ID from notes
      const txMatch = booking.paymentRef?.match(/Transaction:\s*(\S+)/);
      const transactionId = txMatch?.[1];

      if (!transactionId) {
        return TE.right({ cancelled: true, refund: { success: false } });
      }

      return pipe(
        paymentAdapter.refund({
          transactionId,
          reason: input.reason ?? 'Booking cancelled',
        }),
        TE.map((refundResult): CancellationResult => ({
          cancelled: true,
          refund: {
            success: refundResult.success,
            refundId: refundResult.refundId,
          },
        })),
        TE.orElse((): SchedulingResult<CancellationResult> => TE.right({ cancelled: true, refund: { success: false } }))
      );
    })
  );
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

  // Internal Map for pipeline use (PipelineContext expects Map<string, PaymentAdapter>)
  const payments = new Map<string, PaymentAdapter>();
  for (const a of registry.getAll()) {
    payments.set(a.name, a);
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
