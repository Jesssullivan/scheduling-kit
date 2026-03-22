import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    include: ['src/tests/**/*.test.ts', 'src/adapters/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/tests/**',
        'src/testing/**',
        'src/**/*.d.ts',
        'src/**/*.svelte',
        'src/**/*.svelte.ts', // Svelte 5 runes files need Svelte runtime
        'src/**/index.ts', // Re-export files
        'src/adapters/calcom.ts', // Stub - not implemented
        'src/adapters/types.ts', // Types only
        'src/payments/types.ts', // Types only
      ],
      // Coverage thresholds - target 80%, fail CI at 70%
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
    // Timeout for slower integration tests
    testTimeout: 10000,
    // Pool configuration for parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
  resolve: {
    conditions: ['browser'],
  },
});
