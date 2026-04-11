// jest.config.js
// Run: npx jest --coverage
// Preset: jest-expo — handles RN transforms, native module mocks, and Metro aliases.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  // Only collect coverage from pure utility files — screens require a full RN
  // environment and are covered by E2E tests (Detox / EAS build).
  collectCoverageFrom: [
    'lib/format.ts',
    'lib/validation.ts',
    'lib/retry.ts',
    'lib/notifications.ts',
  ],

  // Map native modules that have no Jest implementation to mocks
  moduleNameMapper: {
    // expo-* native modules are auto-mocked by jest-expo; list extras here if needed
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Silence noisy native-module warnings in test output
  testEnvironment: 'node',

  // Transform everything under node_modules that ships raw ESM or uses RN syntax
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@sentry/.*|@supabase/.*)',
  ],

  setupFilesAfterFramework: [],
};
