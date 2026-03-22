import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env.test.local for live tests
config({ path: '.env.test.local' });

/**
 * Vitest configuration for live API tests
 * Runs against real Acuity instance (read-only)
 */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['src/tests/setup.ts'],
    // Live tests need longer timeouts for real API calls
    testTimeout: 30000,
    // Run sequentially to avoid rate limiting
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Pass environment variables to tests
    env: {
      RUN_LIVE_TESTS: process.env.RUN_LIVE_TESTS || 'false',
      RUN_SMOKE_TEST: process.env.RUN_SMOKE_TEST || 'false',
      ACUITY_USER_ID: process.env.ACUITY_USER_ID || '',
      ACUITY_API_KEY: process.env.ACUITY_API_KEY || '',
      ACUITY_BYPASS_COUPON: process.env.ACUITY_BYPASS_COUPON || '',
    },
  },
  resolve: {
    conditions: ['browser'],
  },
});
