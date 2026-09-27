// ESLint flat config for the whole monorepo (`npm run lint` from the root).
//
// The rule set matches what the codebase was written against — its existing
// `eslint-disable` comments reference `no-console`, `@typescript-eslint/*` and the
// classic `react-hooks` rules — rather than every newer preset.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'server/storage/**',
      'server/.test-storage/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      // Server code logs through pino; a stray console call is almost always a leftover.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['client/src/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },

  {
    files: ['server/**/*.ts', 'shared/**/*.ts', '**/*.config.{ts,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
