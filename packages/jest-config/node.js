import { baseConfig } from './base.js';

/**
 * Jest configuration for Node.js/NestJS packages.
 * Includes support for API testing with Supertest.
 *
 * @type {import('jest').Config}
 */
export const nodeConfig = {
  ...baseConfig,

  // Node.js test environment
  testEnvironment: 'node',

  // Extended timeout for integration tests
  testTimeout: 30000,

  // Setup files for database containers
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/jest-setup.ts'],

  // Module name mapping for monorepo imports
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },

  // Separate unit and integration tests
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      testEnvironment: 'node',
      testTimeout: 60000,
    },
  ],
};

export default nodeConfig;
