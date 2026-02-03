# CodeWeaves API

NestJS backend service for the CodeWeaves platform.

## Prerequisites

- Node.js >= 18
- Docker (for running PostgreSQL test containers)
- pnpm

## Getting Started

```bash
# Install dependencies from repo root
pnpm install

# Start development server
pnpm dev --filter @repo/api
```

## Testing

### Unit Tests

Unit tests run in isolation without external dependencies:

```bash
# Run unit tests
pnpm test --filter @repo/api

# Run with coverage
pnpm test:cov --filter @repo/api

# Watch mode during development
cd apps/api && pnpm test:watch
```

### Integration/E2E Tests

Integration tests use [Testcontainers](https://testcontainers.com/) to spin up a real PostgreSQL database:

```bash
# Run E2E tests (requires Docker)
pnpm test:e2e --filter @repo/api
```

**Note**: Docker must be running for E2E tests. The test framework will automatically:
1. Start a PostgreSQL 16 container
2. Set environment variables for database connection
3. Run tests against the real database
4. Clean up the container after tests complete

### Test Structure

```
apps/api/
├── src/
│   ├── *.spec.ts          # Unit tests (co-located)
│   └── ...
├── test/
│   ├── setup/
│   │   ├── global-setup.ts     # Starts PostgreSQL container
│   │   ├── global-teardown.ts  # Stops container
│   │   ├── jest-setup.ts       # Per-file setup
│   │   └── test-database.ts    # Database utilities
│   ├── utils/
│   │   └── test-app.ts         # Test app factory with Supertest
│   └── *.e2e-spec.ts           # Integration tests
├── jest.config.js              # Unit test config
└── jest.e2e.config.js          # E2E test config
```

### Writing Tests

#### Unit Test Example

```typescript
// src/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

#### E2E Test Example

```typescript
// test/users.e2e-spec.ts
import { createTestApp, TestApp } from '@test/utils/test-app';
import { UsersModule } from '@/users/users.module';

describe('Users (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      imports: [UsersModule],
      withDatabase: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /users - should create a user', async () => {
    const response = await app.request
      .post('/users')
      .send({ email: 'test@example.com', name: 'Test User' })
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.email).toBe('test@example.com');
  });
});
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm start:dev` | Start with hot-reload |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm test:e2e` | Run integration tests |
| `pnpm lint` | Run ESLint |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `DATABASE_HOST` | PostgreSQL host | `localhost` |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_NAME` | Database name | `codeweaves` |
| `DATABASE_USER` | Database user | `postgres` |
| `DATABASE_PASSWORD` | Database password | `postgres` |
