/**
 * fp-ts utilities for scheduling-kit
 * Composable helpers for monadic operations
 */

import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import * as T from 'fp-ts/Task';
import * as O from 'fp-ts/Option';
import { pipe, flow } from 'fp-ts/function';
import { z } from 'zod';
import type { SchedulingError, SchedulingResult } from './types.js';
import { Errors } from './types.js';

// =============================================================================
// PROMISE → TASKEITHER CONVERTERS
// =============================================================================

/**
 * Convert a Promise to TaskEither with error mapping
 */
export const fromPromise = <A>(
  promise: () => Promise<A>,
  onError: (e: unknown) => SchedulingError
): SchedulingResult<A> =>
  TE.tryCatch(promise, onError);

/**
 * Convert a Promise with known error type
 */
export const fromPromiseK = <A, Args extends unknown[]>(
  fn: (...args: Args) => Promise<A>,
  onError: (e: unknown) => SchedulingError
) => (...args: Args): SchedulingResult<A> =>
  fromPromise(() => fn(...args), onError);

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate with Zod schema, converting to SchedulingResult
 */
export const validateWith = <T>(
  schema: z.ZodType<T>,
  data: unknown
): SchedulingResult<T> =>
  pipe(
    TE.fromEither(
      E.tryCatch(
        () => schema.parse(data),
        (e) => {
          if (e instanceof z.ZodError) {
            const firstError = e.issues[0];
            return Errors.validation(
              firstError?.path.join('.') || 'unknown',
              firstError?.message || 'Validation failed',
              data
            );
          }
          return Errors.validation('unknown', 'Validation failed', data);
        }
      )
    )
  );

/**
 * Validate multiple fields, collecting all errors
 */
export const validateFields = <T extends Record<string, unknown>>(
  validators: { [K in keyof T]: z.ZodType<T[K]> },
  data: Record<string, unknown>
): SchedulingResult<T> => {
  const errors: string[] = [];
  const result: Record<string, unknown> = {};

  for (const [key, schema] of Object.entries(validators)) {
    const parsed = (schema as z.ZodType).safeParse(data[key]);
    if (parsed.success) {
      result[key] = parsed.data;
    } else {
      errors.push(`${key}: ${parsed.error.issues[0]?.message}`);
    }
  }

  if (errors.length > 0) {
    return TE.left(Errors.validation('multiple', errors.join('; '), data));
  }

  return TE.right(result as T);
};

// =============================================================================
// RETRY & RESILIENCE
// =============================================================================

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryOn?: (error: SchedulingError) => boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Retry a TaskEither with exponential backoff
 */
export const withRetry = <A>(
  config: Partial<RetryConfig> = {}
) => (task: SchedulingResult<A>): SchedulingResult<A> => {
  const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, retryOn } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  const shouldRetry = retryOn ?? ((e: SchedulingError) =>
    e._tag === 'InfrastructureError' && e.code !== 'TIMEOUT'
  );

  const attempt = (attemptNum: number, delay: number): SchedulingResult<A> =>
    pipe(
      task,
      TE.orElse((error) => {
        if (attemptNum >= maxAttempts || !shouldRetry(error)) {
          return TE.left(error);
        }

        const nextDelay = Math.min(delay * backoffMultiplier, maxDelayMs);

        return pipe(
          TE.fromTask(T.delay(delay)(T.of(undefined))),
          TE.chain(() => attempt(attemptNum + 1, nextDelay))
        );
      })
    );

  return attempt(1, initialDelayMs);
};

// =============================================================================
// TIMEOUT
// =============================================================================

/**
 * Add timeout to a TaskEither
 */
export const withTimeout = <A>(
  timeoutMs: number,
  timeoutError?: SchedulingError
) => (task: SchedulingResult<A>): SchedulingResult<A> => {
  const error = timeoutError ?? Errors.infrastructure('TIMEOUT', `Operation timed out after ${timeoutMs}ms`);

  return () =>
    Promise.race([
      task(),
      new Promise<E.Either<SchedulingError, A>>((resolve) =>
        setTimeout(() => resolve(E.left(error)), timeoutMs)
      ),
    ]);
};

// =============================================================================
// LOGGING & TRACING
// =============================================================================

export interface LogContext {
  readonly correlationId: string;
  readonly operation: string;
  readonly startTime: number;
}

/**
 * Add correlation ID and timing to operations
 */
export const withCorrelationId = <A>(
  operation: string,
  correlationId: string = crypto.randomUUID()
) => (task: SchedulingResult<A>): SchedulingResult<A> =>
  pipe(
    TE.Do,
    TE.bind('startTime', () => TE.right(Date.now())),
    TE.bind('result', () => task),
    TE.map(({ result, startTime }) => {
      const duration = Date.now() - startTime;
      console.debug(`[${correlationId}] ${operation} completed in ${duration}ms`);
      return result;
    }),
    TE.mapLeft((error) => {
      console.error(`[${correlationId}] ${operation} failed:`, error);
      return error;
    })
  );

// =============================================================================
// OPTION HELPERS
// =============================================================================

/**
 * Convert Option to TaskEither with error for None
 */
export const fromOption = <A>(
  onNone: () => SchedulingError
) => (option: O.Option<A>): SchedulingResult<A> =>
  pipe(
    option,
    O.fold(
      () => TE.left(onNone()),
      (a) => TE.right(a)
    )
  );

/**
 * Convert nullable to TaskEither
 */
export const fromNullable = <A>(
  value: A | null | undefined,
  onNull: () => SchedulingError
): SchedulingResult<A> =>
  value != null ? TE.right(value) : TE.left(onNull());

// =============================================================================
// SEQUENCING HELPERS
// =============================================================================

/**
 * Run tasks in sequence, stopping on first error
 */
export const sequenceResults = <A>(
  tasks: SchedulingResult<A>[]
): SchedulingResult<A[]> =>
  pipe(
    TE.sequenceArray(tasks),
    TE.map((xs) => [...xs]),
  );

/**
 * Run tasks in parallel, collecting all results or first error
 */
export const parallelResults = <A>(
  tasks: SchedulingResult<A>[]
): SchedulingResult<A[]> =>
  pipe(
    tasks,
    (ts) => () => Promise.all(ts.map((t) => t())),
    T.map(E.sequenceArray),
    T.map(E.map((xs) => [...xs])),
  );

// =============================================================================
// ERROR RECOVERY
// =============================================================================

/**
 * Provide fallback value on specific error
 */
export const recoverWith = <A>(
  predicate: (error: SchedulingError) => boolean,
  fallback: A
) => (task: SchedulingResult<A>): SchedulingResult<A> =>
  pipe(
    task,
    TE.orElse((error) =>
      predicate(error) ? TE.right(fallback) : TE.left(error)
    )
  );

/**
 * Map specific errors to different errors
 */
export const mapError = (
  fn: (error: SchedulingError) => SchedulingError
) => <A>(task: SchedulingResult<A>): SchedulingResult<A> =>
  TE.mapLeft(fn)(task);

// =============================================================================
// IDEMPOTENCY
// =============================================================================

export interface IdempotencyStore {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>;
}

/**
 * Make an operation idempotent using a key-value store
 */
export const withIdempotency = <A>(
  store: IdempotencyStore,
  key: string,
  ttlSeconds: number = 86400 // 24 hours
) => (task: SchedulingResult<A>): SchedulingResult<A> =>
  pipe(
    fromPromise(
      () => store.get(key),
      (e) => Errors.infrastructure('REDIS', `Failed to check idempotency: ${e}`)
    ),
    TE.chain((existing) => {
      if (existing !== null) {
        return TE.left(Errors.idempotency(key, existing));
      }
      return task;
    }),
    TE.chainFirst((result) =>
      fromPromise(
        () => store.set(key, result, ttlSeconds),
        (e) => Errors.infrastructure('REDIS', `Failed to store idempotency: ${e}`)
      )
    )
  );

// =============================================================================
// UUID GENERATION
// =============================================================================

export const generateId = (): string => crypto.randomUUID();

export const generateIdempotencyKey = (prefix: string = 'idem'): string =>
  `${prefix}_${generateId()}`;
