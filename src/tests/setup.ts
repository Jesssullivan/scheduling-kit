/**
 * Global test setup for scheduling-kit
 * Configures vitest environment and shared utilities
 */

import { beforeAll, afterAll, afterEach, vi } from 'vitest';

// =============================================================================
// GLOBAL SETUP
// =============================================================================

beforeAll(() => {
  // Reset all mocks before test suite runs
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up after each test
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  // Final cleanup
  vi.restoreAllMocks();
});

// =============================================================================
// GLOBAL TEST UTILITIES
// =============================================================================

/**
 * Helper to run async tests with fake timers
 * Advances timers after each async operation
 */
export const runWithFakeTimers = async <T>(fn: () => Promise<T>): Promise<T> => {
  vi.useFakeTimers();
  const promise = fn();
  await vi.runAllTimersAsync();
  const result = await promise;
  vi.useRealTimers();
  return result;
};

/**
 * Helper to wait for all pending promises to resolve
 */
export const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Helper to create a deferred promise for testing async flows
 */
export const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

// =============================================================================
// ENVIRONMENT HELPERS
// =============================================================================

/**
 * Set environment variables for test duration
 */
export const withEnv = (vars: Record<string, string>, fn: () => void | Promise<void>) => {
  const original: Record<string, string | undefined> = {};

  // Save and set
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    process.env[key] = value;
  }

  const cleanup = () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
};

// =============================================================================
// DATE/TIME HELPERS
// =============================================================================

/**
 * Create a fixed date for consistent testing
 */
export const createFixedDate = (isoString: string = '2026-02-15T10:00:00-05:00') => {
  const date = new Date(isoString);
  vi.useFakeTimers();
  vi.setSystemTime(date);
  return {
    date,
    cleanup: () => vi.useRealTimers(),
  };
};

/**
 * Format date as YYYY-MM-DD (date only)
 */
export const toDateString = (date: Date): string => date.toISOString().split('T')[0];

/**
 * Get a date N days from the base date
 */
export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
