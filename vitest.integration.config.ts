import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['src/tests/setup.ts'],
    // Integration tests may need longer timeouts
    testTimeout: 30000,
    // Run integration test files sequentially to avoid shared-state races.
    fileParallelism: false,
  },
  resolve: {
    conditions: ['browser'],
  },
});
