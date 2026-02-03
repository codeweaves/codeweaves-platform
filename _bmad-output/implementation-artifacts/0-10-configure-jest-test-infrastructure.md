# Story 0.10: Configure Jest Test Infrastructure

Status: done

## Story

As a **developer**,
I want Jest configured for unit and integration testing,
So that I can write and run tests across all packages.

## Acceptance Criteria

1. **Given** the need for testing infrastructure
   **When** I configure Jest
   **Then** Jest is configured in each testable package

2. **And** TypeScript is supported via `ts-jest`

3. **And** Coverage reports are generated

4. **And** `pnpm test` runs all tests across packages

5. **And** Test database setup is documented

## Tasks / Subtasks

- [ ] Task 1: Verify shared Jest config (AC: 1, 2)
  - [ ] Check `packages/jest-config/` exists
  - [ ] Verify TypeScript support configured
  - [ ] Ensure coverage settings included
  - [ ] Add NestJS preset configuration

- [ ] Task 2: Configure API testing (AC: 1, 5)
  - [ ] Create `apps/api/jest.config.ts`
  - [ ] Set up test database container
  - [ ] Create test utilities (auth helpers, factories)
  - [ ] Configure e2e test setup

- [ ] Task 3: Configure Web testing (AC: 1)
  - [ ] Create `apps/web/jest.config.ts`
  - [ ] Set up React Testing Library
  - [ ] Configure jsdom environment

- [ ] Task 4: Set up coverage reporting (AC: 3)
  - [ ] Configure coverage thresholds (80%)
  - [ ] Set up coverage output directory
  - [ ] Configure coverage reporters (text, lcov)

- [ ] Task 5: Verify test commands work (AC: 4)
  - [ ] Run `pnpm test` across all packages
  - [ ] Run `pnpm test:cov` for coverage
  - [ ] Verify Turbo caching works for tests

## Dev Notes

### Shared Jest Config

```typescript
// packages/jest-config/jest.base.ts
import type { Config } from 'jest';

const baseConfig: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  resetMocks: true,
};

export default baseConfig;
```

### NestJS Jest Config

```typescript
// apps/api/jest.config.ts
import type { Config } from 'jest';
import baseConfig from '@repo/jest-config';

const config: Config = {
  ...baseConfig,
  displayName: 'api',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup/jest.setup.ts'],
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
};

export default config;
```

### Test Database Setup

```typescript
// apps/api/test/setup/global-setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';

let container: StartedPostgreSqlContainer;

export default async function globalSetup() {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();

  // Run migrations
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
  });

  // Store container for teardown
  (global as any).__POSTGRES_CONTAINER__ = container;
}

// apps/api/test/setup/global-teardown.ts
export default async function globalTeardown() {
  const container = (global as any).__POSTGRES_CONTAINER__;
  if (container) {
    await container.stop();
  }
}
```

### Test Auth Helpers

```typescript
// apps/api/test/utils/auth.helper.ts
import { JwtService } from '@nestjs/jwt';

export function generateTestToken(payload: {
  sub: string;
  email: string;
  organizationId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'CLIENT';
}) {
  const jwtService = new JwtService({ secret: 'test-secret' });
  return jwtService.sign({
    ...payload,
    iss: 'https://test.auth0.com/',
    aud: 'https://api.codeweaves.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

export const testUsers = {
  superAdmin: {
    sub: 'auth0|super-admin',
    email: 'super@test.com',
    organizationId: 'org-1',
    role: 'SUPER_ADMIN' as const,
  },
  admin: {
    sub: 'auth0|admin',
    email: 'admin@test.com',
    organizationId: 'org-1',
    role: 'ADMIN' as const,
  },
  client: {
    sub: 'auth0|client',
    email: 'client@test.com',
    organizationId: 'org-1',
    role: 'CLIENT' as const,
  },
};
```

### Architecture Compliance

- **NFR64:** Codebase must maintain >80% test coverage
- **NFR68:** All new features must include unit tests
- **NFR69:** Critical user flows must have integration tests
- **NFR71:** Automated tests must run in CI/CD pipeline

### Test Commands

```bash
pnpm test              # Run all tests
pnpm test:cov          # Run with coverage
pnpm test:e2e          # Run e2e tests
pnpm test --filter=api # Run only API tests
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#19-Testing-Strategy]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.10]
- [Jest Documentation: https://jestjs.io/docs/getting-started]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create/modify:
- `packages/jest-config/jest.base.ts`
- `apps/api/jest.config.ts`
- `apps/api/test/setup/jest.setup.ts`
- `apps/api/test/setup/global-setup.ts`
- `apps/api/test/setup/global-teardown.ts`
- `apps/api/test/utils/auth.helper.ts`
- `apps/web/jest.config.ts`
