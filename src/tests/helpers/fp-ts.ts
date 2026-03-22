/**
 * fp-ts Test Helpers
 * Assertion utilities for Either, TaskEither, and Option types
 */

import { expect } from 'vitest';
import * as E from 'fp-ts/Either';
import * as O from 'fp-ts/Option';
import type { TaskEither } from 'fp-ts/TaskEither';
import type { SchedulingError } from '../../core/types.js';

// =============================================================================
// EITHER ASSERTIONS
// =============================================================================

/**
 * Assert that an Either is Right and return the value
 * @throws AssertionError if Either is Left
 */
export const expectRight = <E, A>(either: E.Either<E, A>): A => {
  expect(E.isRight(either), `Expected Right but got Left: ${JSON.stringify(either)}`).toBe(true);
  if (E.isRight(either)) {
    return either.right;
  }
  // TypeScript narrowing fallback (unreachable)
  throw new Error('Unreachable');
};

/**
 * Assert that an Either is Left and return the error
 * @throws AssertionError if Either is Right
 */
export const expectLeft = <E, A>(either: E.Either<E, A>): E => {
  expect(E.isLeft(either), `Expected Left but got Right: ${JSON.stringify(either)}`).toBe(true);
  if (E.isLeft(either)) {
    return either.left;
  }
  throw new Error('Unreachable');
};

/**
 * Assert that an Either is Left with a specific error tag
 * For discriminated unions with _tag field
 */
export const expectLeftTag = <A>(
  either: E.Either<SchedulingError, A>,
  expectedTag: SchedulingError['_tag']
): SchedulingError => {
  const error = expectLeft(either);
  expect(error._tag, `Expected error tag '${expectedTag}' but got '${error._tag}'`).toBe(
    expectedTag
  );
  return error;
};

/**
 * Assert Either is Right and matches expected value
 */
export const expectRightEquals = <E, A>(either: E.Either<E, A>, expected: A): void => {
  const value = expectRight(either);
  expect(value).toEqual(expected);
};

/**
 * Assert Either is Left and error matches predicate
 */
export const expectLeftMatches = <E, A>(
  either: E.Either<E, A>,
  predicate: (error: E) => boolean
): void => {
  const error = expectLeft(either);
  expect(predicate(error), `Error did not match predicate: ${JSON.stringify(error)}`).toBe(true);
};

// =============================================================================
// TASKEITHER ASSERTIONS
// =============================================================================

/**
 * Run TaskEither and assert it resolves to Right
 */
export const expectRightAsync = async <E, A>(te: TaskEither<E, A>): Promise<A> => {
  const result = await te();
  return expectRight(result);
};

/**
 * Run TaskEither and assert it resolves to Left
 */
export const expectLeftAsync = async <E, A>(te: TaskEither<E, A>): Promise<E> => {
  const result = await te();
  return expectLeft(result);
};

/**
 * Run TaskEither and assert it resolves to Left with specific tag
 */
export const expectLeftTagAsync = async <A>(
  te: TaskEither<SchedulingError, A>,
  expectedTag: SchedulingError['_tag']
): Promise<SchedulingError> => {
  const result = await te();
  return expectLeftTag(result, expectedTag);
};

/**
 * Run TaskEither and assert it resolves to Right matching expected value
 */
export const expectRightEqualsAsync = async <E, A>(
  te: TaskEither<E, A>,
  expected: A
): Promise<void> => {
  const result = await te();
  expectRightEquals(result, expected);
};

// =============================================================================
// OPTION ASSERTIONS
// =============================================================================

/**
 * Assert that an Option is Some and return the value
 */
export const expectSome = <A>(option: O.Option<A>): A => {
  expect(O.isSome(option), `Expected Some but got None`).toBe(true);
  if (O.isSome(option)) {
    return option.value;
  }
  throw new Error('Unreachable');
};

/**
 * Assert that an Option is None
 */
export const expectNone = <A>(option: O.Option<A>): void => {
  expect(O.isNone(option), `Expected None but got Some: ${JSON.stringify(option)}`).toBe(true);
};

/**
 * Assert Option is Some and matches expected value
 */
export const expectSomeEquals = <A>(option: O.Option<A>, expected: A): void => {
  const value = expectSome(option);
  expect(value).toEqual(expected);
};

// =============================================================================
// SCHEDULING-SPECIFIC ASSERTIONS
// =============================================================================

/**
 * Assert that an error has the AcuityError tag with specific code
 */
export const expectAcuityError = <A>(
  either: E.Either<SchedulingError, A>,
  expectedCode?: string
): SchedulingError => {
  const error = expectLeftTag(either, 'AcuityError');
  if (expectedCode && error._tag === 'AcuityError') {
    expect(error.code).toBe(expectedCode);
  }
  return error;
};

/**
 * Assert that an error has the PaymentError tag
 */
export const expectPaymentError = <A>(
  either: E.Either<SchedulingError, A>,
  expectedCode?: string,
  expectedRecoverable?: boolean
): SchedulingError => {
  const error = expectLeftTag(either, 'PaymentError');
  if (error._tag === 'PaymentError') {
    if (expectedCode) {
      expect(error.code).toBe(expectedCode);
    }
    if (expectedRecoverable !== undefined) {
      expect(error.recoverable).toBe(expectedRecoverable);
    }
  }
  return error;
};

/**
 * Assert that an error has the ValidationError tag
 */
export const expectValidationError = <A>(
  either: E.Either<SchedulingError, A>,
  expectedField?: string
): SchedulingError => {
  const error = expectLeftTag(either, 'ValidationError');
  if (expectedField && error._tag === 'ValidationError') {
    expect(error.field).toBe(expectedField);
  }
  return error;
};

/**
 * Assert that an error has the ReservationError tag
 */
export const expectReservationError = <A>(
  either: E.Either<SchedulingError, A>,
  expectedCode?: 'SLOT_TAKEN' | 'BLOCK_FAILED' | 'TIMEOUT'
): SchedulingError => {
  const error = expectLeftTag(either, 'ReservationError');
  if (expectedCode && error._tag === 'ReservationError') {
    expect(error.code).toBe(expectedCode);
  }
  return error;
};

/**
 * Assert that an error has the InfrastructureError tag
 */
export const expectInfrastructureError = <A>(
  either: E.Either<SchedulingError, A>,
  expectedCode?: 'NETWORK' | 'TIMEOUT' | 'REDIS' | 'UNKNOWN'
): SchedulingError => {
  const error = expectLeftTag(either, 'InfrastructureError');
  if (expectedCode && error._tag === 'InfrastructureError') {
    expect(error.code).toBe(expectedCode);
  }
  return error;
};
