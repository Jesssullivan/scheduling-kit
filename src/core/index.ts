/**
 * Core module exports
 */

// Types
export * from './types.js';

// Utilities
export {
  fromPromise,
  fromPromiseK,
  validateWith,
  validateFields,
  withRetry,
  withTimeout,
  withCorrelationId,
  fromOption,
  fromNullable,
  sequenceResults,
  parallelResults,
  recoverWith,
  mapError,
  withIdempotency,
  generateId,
  generateIdempotencyKey,
  type RetryConfig,
  type IdempotencyStore,
} from './utils.js';

// Pipelines
export {
  completeBookingWithAltPayment,
  getAvailabilityWithService,
  getTimeSlotsWithService,
  cancelBookingWithRefund,
  createSchedulingKit,
  type PipelineContext,
  type BookingPipelineInput,
  type BookingPipelineResult,
  type AvailabilityInput,
  type AvailabilityResult,
  type TimeSlotsInput,
  type TimeSlotsResult,
  type CancellationInput,
  type CancellationResult,
  type SchedulingKit,
} from './pipelines.js';

// Cache
export {
  SimpleCache,
  createSchedulingCache,
  getSchedulingCache,
  resetSchedulingCache,
  type CacheEntry,
  type CacheConfig,
  type CacheStats,
} from './cache.js';
