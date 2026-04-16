import tsParser from '@typescript-eslint/parser';
import eslintPluginSvelte from 'eslint-plugin-svelte';

const svelteConfig = eslintPluginSvelte.configs['flat/recommended'].map((config) => {
  if (!config.files) {
    return config;
  }

  return {
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        parser: tsParser,
        project: './tsconfig.json',
        extraFileExtensions: ['.svelte'],
      },
    },
  };
});

export default [
  {
    ignores: [
      '.svelte-kit/**',
      'bazel-*/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'pkg/**',
      'pkg-github/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...svelteConfig,
];
