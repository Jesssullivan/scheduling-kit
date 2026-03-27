/**
 * Tests for core/utils.ts
 * Effect utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Effect } from 'effect';
import { z } from 'zod';

import {
  fromPromise,
  fromPromiseK,
  validateWith,
  validateFields,
  withRetry,
  withTimeout,
  fromOption,
  fromNullable,
  sequenceResults,
  parallelResults,
  recoverWith,
  mapError,
  generateId,
  generateIdempotencyKey,
  withIdempotency,
} from '../core/utils.js';
import { Errors } from '../core/types.js';
import { expectSuccess, expectFailure, expectFailureTag } from './helpers/effect.js';

describe('Promise Converters', () => {
  describe('fromPromise', () => {
    it('converts successful promise to success', async () => {
      const value = await expectSuccess(
        fromPromise(() => Promise.resolve(42), () => Errors.infrastructure('TEST' as any, 'fail'))
      );
      expect(value).toBe(42);
    });

    it('converts rejected promise to failure with mapped error', async () => {
      const error = await expectFailure(
        fromPromise(
          () => Promise.reject(new Error('boom')),
          (e) => Errors.infrastructure('TEST' as any, String(e))
        )
      );
      expect(error._tag).toBe('InfrastructureError');
      expect((error as any).message).toContain('boom');
    });

    it('is lazy — does not run until executed', async () => {
      let called = false;
      const effect = fromPromise(
        async () => { called = true; return 'done'; },
        () => Errors.infrastructure('TEST' as any, 'fail')
      );
      expect(called).toBe(false);
      await Effect.runPromise(effect);
      expect(called).toBe(true);
    });
  });

  describe('fromPromiseK', () => {
    it('creates a function that returns Effect', async () => {
      const fetchUser = fromPromiseK(
        async (id: string) => ({ id, name: 'Test' }),
        () => Errors.infrastructure('HTTP' as any, 'Failed')
      );
      const value = await expectSuccess(fetchUser('123'));
      expect(value).toEqual({ id: '123', name: 'Test' });
    });
  });
});

describe('Validation', () => {
  describe('validateWith', () => {
    const TestSchema = z.object({
      name: z.string().min(1),
      age: z.number().positive(),
    });

    it('succeeds for valid data', async () => {
      const value = await expectSuccess(validateWith(TestSchema, { name: 'John', age: 30 }));
      expect(value).toEqual({ name: 'John', age: 30 });
    });

    it('fails with ValidationError for invalid data', async () => {
      await expectFailureTag(validateWith(TestSchema, { name: '', age: -5 }), 'ValidationError');
    });

    it('transforms data through schema', async () => {
      const schema = z.string().transform((s) => s.toUpperCase());
      const value = await expectSuccess(validateWith(schema, 'hello'));
      expect(value).toBe('HELLO');
    });
  });

  describe('validateFields', () => {
    it('validates multiple fields', async () => {
      await expectSuccess(validateFields(
        { email: z.string().email(), age: z.number().min(18) },
        { email: 'test@example.com', age: 25 }
      ));
    });

    it('collects multiple errors', async () => {
      const error = await expectFailure(validateFields(
        { email: z.string().email(), age: z.number().min(18) },
        { email: 'invalid', age: 10 }
      ));
      expect(error._tag).toBe('ValidationError');
      expect((error as any).message).toContain('email');
      expect((error as any).message).toContain('age');
    });
  });
});

describe('Retry & Resilience', () => {
  describe('withRetry', () => {
    it('returns success on first try if successful', async () => {
      const effect = Effect.succeed(42);
      const value = await expectSuccess(withRetry({ maxAttempts: 3 })(effect));
      expect(value).toBe(42);
    });

    it('retries on infrastructure error', async () => {
      let attempts = 0;
      const effect = Effect.suspend(() => {
        attempts++;
        if (attempts < 3) {
          return Effect.fail(Errors.infrastructure('NETWORK', 'Network error'));
        }
        return Effect.succeed(42);
      });

      const value = await expectSuccess(withRetry({ maxAttempts: 3, initialDelayMs: 1 })(effect));
      expect(attempts).toBe(3);
      expect(value).toBe(42);
    });

    it('eventually fails after retries exhausted', async () => {
      const error = await expectFailure(
        withRetry({ maxAttempts: 1, initialDelayMs: 1 })(
          Effect.fail(Errors.infrastructure('NETWORK', 'Always fails'))
        )
      );
      expect(error._tag).toBe('InfrastructureError');
    });

    it('does not retry validation errors by default', async () => {
      let attempts = 0;
      const effect = Effect.suspend(() => {
        attempts++;
        return Effect.fail(Errors.validation('field', 'Invalid'));
      });

      await expectFailure(withRetry({ maxAttempts: 3, initialDelayMs: 1 })(effect));
      expect(attempts).toBe(1);
    });
  });

  describe('withTimeout', () => {
    it('returns result if completes in time', async () => {
      const value = await expectSuccess(withTimeout<number>(1000)(Effect.succeed(42)));
      expect(value).toBe(42);
    });

    it('returns timeout error if too slow', async () => {
      const slow = Effect.tryPromise(() => new Promise((r) => setTimeout(() => r(42), 500)));
      const error = await expectFailure(withTimeout<number>(10)(slow as any));
      expect(error._tag).toBe('InfrastructureError');
      expect((error as any).code).toBe('TIMEOUT');
    });
  });
});

describe('Nullable Helpers', () => {
  describe('fromOption (nullable)', () => {
    it('succeeds for non-null value', async () => {
      const value = await expectSuccess(fromOption(() => Errors.validation('test', 'Missing'))(42));
      expect(value).toBe(42);
    });

    it('fails for null', async () => {
      await expectFailure(fromOption(() => Errors.validation('test', 'Missing'))(null));
    });

    it('fails for undefined', async () => {
      await expectFailure(fromOption(() => Errors.validation('test', 'Missing'))(undefined));
    });
  });

  describe('fromNullable', () => {
    it('succeeds for value', async () => {
      await expectSuccess(fromNullable(42, () => Errors.validation('test', 'Missing')));
    });

    it('fails for null', async () => {
      await expectFailure(fromNullable(null, () => Errors.validation('test', 'Missing')));
    });

    it('fails for undefined', async () => {
      await expectFailure(fromNullable(undefined, () => Errors.validation('test', 'Missing')));
    });
  });
});

describe('Sequencing Helpers', () => {
  describe('sequenceResults', () => {
    it('collects all successful results', async () => {
      const effects = [Effect.succeed(1), Effect.succeed(2), Effect.succeed(3)];
      const value = await expectSuccess(sequenceResults(effects));
      expect(value).toEqual([1, 2, 3]);
    });

    it('fails on first error', async () => {
      const effects = [
        Effect.succeed(1),
        Effect.fail(Errors.validation('test', 'Error at 2')),
        Effect.succeed(3),
      ];
      await expectFailure(sequenceResults(effects));
    });
  });

  describe('parallelResults', () => {
    it('runs effects in parallel', async () => {
      const effects = [
        Effect.succeed(1),
        Effect.succeed(2),
      ];
      const value = await expectSuccess(parallelResults(effects));
      expect(value).toEqual([1, 2]);
    });
  });
});

describe('Error Recovery', () => {
  describe('recoverWith', () => {
    it('recovers from matching error', async () => {
      const effect = Effect.fail(Errors.infrastructure('UNKNOWN', 'Missing'));
      const recovered = recoverWith<number>(
        (e) => e._tag === 'InfrastructureError',
        0
      )(effect);
      const value = await expectSuccess(recovered);
      expect(value).toBe(0);
    });

    it('does not recover from non-matching error', async () => {
      const effect = Effect.fail(Errors.validation('test', 'Invalid'));
      const recovered = recoverWith<number>(
        (e) => e._tag === 'InfrastructureError',
        0
      )(effect);
      await expectFailure(recovered);
    });
  });

  describe('mapError', () => {
    it('transforms errors', async () => {
      const effect = Effect.fail(Errors.infrastructure('NETWORK', 'Network'));
      const mapped = mapError(
        (e) => Errors.infrastructure('UNKNOWN', `Wrapped: ${(e as any).message}`)
      )(effect);
      const error = await expectFailure(mapped);
      expect((error as any).message).toContain('Wrapped:');
    });
  });
});

describe('Idempotency', () => {
  describe('withIdempotency', () => {
    it('executes effect when key not found', async () => {
      const store = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      };

      const effect = Effect.succeed({ id: '123' });
      const value = await expectSuccess(withIdempotency(store, 'test-key')(effect));

      expect(store.get).toHaveBeenCalledWith('test-key');
      expect(store.set).toHaveBeenCalledWith('test-key', { id: '123' }, 86400);
      expect(value).toEqual({ id: '123' });
    });

    it('returns idempotency error when key exists', async () => {
      const store = {
        get: vi.fn().mockResolvedValue({ id: '123' }),
        set: vi.fn().mockResolvedValue(undefined),
      };

      const effect = Effect.succeed({ id: '456' });
      await expectFailureTag(withIdempotency(store, 'test-key')(effect), 'IdempotencyError');
      expect(store.set).not.toHaveBeenCalled();
    });
  });
});

describe('UUID Generation', () => {
  describe('generateId', () => {
    it('generates valid UUIDs', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateId();
          expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        }),
        { numRuns: 100 }
      );
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
      expect(ids.size).toBe(1000);
    });
  });

  describe('generateIdempotencyKey', () => {
    it('includes prefix', () => {
      expect(generateIdempotencyKey('booking')).toMatch(/^booking_[0-9a-f-]+$/i);
    });

    it('defaults to "idem" prefix', () => {
      expect(generateIdempotencyKey()).toMatch(/^idem_[0-9a-f-]+$/i);
    });
  });
});

describe('Property-based tests', () => {
  describe('validateWith', () => {
    it('round-trips valid strings', () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), async (s) => {
          const value = await expectSuccess(validateWith(z.string().min(1), s));
          expect(value).toBe(s);
        })
      );
    });

    it('rejects invalid emails', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => !s.includes('@') || !s.includes('.')),
          async (s) => {
            await expectFailure(validateWith(z.string().email(), s));
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('fromNullable', () => {
    it('always succeeds for non-null values', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything().filter((x) => x !== null && x !== undefined),
          async (value) => {
            await expectSuccess(fromNullable(value, () => Errors.validation('test', 'Missing')));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
