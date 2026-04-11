const tsPlugin    = require('@typescript-eslint/eslint-plugin');
const tsParser    = require('@typescript-eslint/parser');
const hooksPlugin = require('eslint-plugin-react-hooks');

module.exports = [
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'supabase/functions/**', // Deno runtime — linted separately via deno lint
      'coverage/**',
    ],
  },

  // ── TypeScript source ──────────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': hooksPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Unused vars: error (not warn) so --max-warnings 0 catches them
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // require() is common in config files and RN native bridges
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      // React hooks
      'react-hooks/rules-of-hooks':   'error',
      'react-hooks/exhaustive-deps':  'warn',
    },
  },
];
