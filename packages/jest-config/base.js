/**
 * Shared Jest base configuration for the monorepo.
 * All packages extend this configuration.
 *
 * @type {import('jest').Config}
 */
export const baseConfig = {
  // Use ts-jest for TypeScript transformation
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/index.{ts,tsx}',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Test patterns
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/*.test.{ts,tsx}',
  ],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
  transformIgnorePatterns: ['/node_modules/(?!(@repo)/)'],

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,

  // Verbose output for CI
  verbose: true,

  // Timeout for slow tests
  testTimeout: 10000,
};

export default baseConfig;
