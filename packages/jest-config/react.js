import { baseConfig } from './base.js';

/**
 * Jest configuration for React/Next.js packages.
 * Note: Playwright E2E setup is deferred per project constraints.
 *
 * @type {import('jest').Config}
 */
export const reactConfig = {
  ...baseConfig,

  // jsdom for React component testing
  testEnvironment: 'jsdom',

  // Setup files for React testing
  setupFilesAfterEnv: ['<rootDir>/test/setup/jest-setup.ts'],

  // Module name mapping for Next.js
  moduleNameMapper: {
    // Handle CSS imports (with CSS modules)
    '^.+\\.module\\.(css|sass|scss)$': 'identity-obj-proxy',
    // Handle CSS imports (without CSS modules)
    '^.+\\.(css|sass|scss)$': '<rootDir>/__mocks__/styleMock.js',
    // Handle image imports
    '^.+\\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$':
      '<rootDir>/__mocks__/fileMock.js',
    // Handle module aliases
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Transform ESM modules
  transformIgnorePatterns: [
    '/node_modules/(?!(@repo|@testing-library)/)',
  ],
};

export default reactConfig;
