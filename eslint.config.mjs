// ESLint flat config for the whole monorepo (`npm run lint` from the root).
//
// The rule set matches what the codebase was written against â€” its existing
// `eslint-disable` comments reference `no-console`, `@typescript-eslint/*` and the
// classic `react-hooks` rules â€” rather than every newer preset.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
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
      'client/tools/**',
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

  // Accessibility (§Phase 16): the recommended jsx-a11y rules, as errors, on every
  // client component — the automated half of the audit (a screen-reader pass is still manual).
  {
    files: ['client/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Our sheets are modal dialogs that already trap and restore focus (Sheet.tsx);
      // moving focus to the first field on open is the intended behaviour there.
      'jsx-a11y/no-autofocus': 'off',
      // The design-system inputs wrap native controls, which the rule can't see through.
      'jsx-a11y/label-has-associated-control': [
        'error',
        { controlComponents: ['Input', 'MoneyInput', 'Select', 'Textarea'], assert: 'either', depth: 4 },
      ],
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
