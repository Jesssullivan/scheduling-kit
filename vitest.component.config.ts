import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Vitest configuration for Svelte component tests
 * Uses jsdom environment for browser-like testing
 */
export default defineConfig({
  plugins: [
    svelte({
      hot: !process.env.VITEST,
      compilerOptions: {
        // Don't generate CSS - avoids preprocessing issues in jsdom
        css: 'external',
      },
      // Skip Vite's CSS preprocessing - just pass styles through as-is
      preprocess: [],
    }),
  ],
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/tests/setup.ts', 'tests/e2e/setup.ts'],
    // Component tests may need longer timeouts
    testTimeout: 15000,
  },
  resolve: {
    conditions: ['browser'],
  },
});
