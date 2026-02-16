# Development Guide - CodeWeaves Platform

> Generated: 2026-02-14

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| Node.js | >= 18 (CI uses 24) | JavaScript runtime |
| Bun | 1.3.8 | Package manager |
| Docker | Latest | For Redis (local dev) |
| Git | Latest | Version control |

## Quick Start

### 1. Clone & Install

```bash
git clone <repository-url>
cd codeweaves-platform
bun install
```

### 2. Environment Setup

```bash
# Copy root env template
cp .env.example .env

# Copy app-specific env files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

**Required Environment Variables:**
- `DATABASE_URL` - Supabase PostgreSQL connection string
- `AUTH0_DOMAIN` - Auth0 tenant domain
- `AUTH0_CLIENT_ID` - Auth0 client ID (web)
- `AUTH0_AUDIENCE` - Auth0 API audience

### 3. Database Setup

```bash
# Generate Prisma client
cd apps/api && bun prisma generate

# Run migrations
bun prisma migrate deploy

# (Optional) Open Prisma Studio
bun prisma studio
```

### 4. Start Services

```bash
# Start Redis (required for API)
docker-compose up redis -d

# Start all apps in dev mode
bun run dev

# Or start individually:
cd apps/api && bun run start:dev    # API on port 3001
cd apps/web && bun run dev          # Web on port 3000
cd apps/widget && bun run dev       # Widget on Vite dev server
```

## Development Commands

### Root (Turborepo)

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all apps in dev mode |
| `bun run build` | Build all apps |
| `bun run lint` | Lint all apps |
| `bun run check-types` | Type check all apps |
| `bun run test` | Run all tests |
| `bun run test:cov` | Run tests with coverage |
| `bun run test:e2e` | Run E2E tests |
| `bun run format` | Format code with Prettier |

### API (`apps/api/`)

| Command | Description |
|---------|-------------|
| `bun run start:dev` | Start with hot reload |
| `bun run start:debug` | Start with debugger |
| `bun run build` | Build with NestJS CLI |
| `bun run test` | Run unit tests |
| `bun run test:cov` | Tests with coverage |
| `bun run test:e2e` | E2E tests (Testcontainers) |
| `bun prisma generate` | Generate Prisma client |
| `bun prisma migrate dev` | Create new migration |
| `bun prisma studio` | Open database GUI |

### Web (`apps/web/`)

| Command | Description |
|---------|-------------|
| `bun run dev` | Start on port 3000 |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bunx shadcn@latest add <name>` | Add Shadcn component |

### Widget (`apps/widget/`)

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Vite dev server |
| `bun run build` | Build single-file widget |
| `bun run preview` | Preview production build |

## Testing

### Unit Tests (API)

Tests are located in `apps/api/test/` mirroring the source structure:

```
test/
├── controllers/
│   ├── auth/users.controller.spec.ts
│   └── public/health.controller.spec.ts
├── services/
│   ├── app/app.service.spec.ts
│   └── users/users.service.spec.ts
├── guards/jwt-auth.guard.spec.ts
├── interceptors/user-sync.interceptor.spec.ts
├── decorators/current-user.decorator.spec.ts
├── strategies/jwt.strategy.spec.ts
├── setup/
│   ├── global-setup.ts
│   ├── global-teardown.ts
│   └── jest-setup.ts
└── utils/jwt.helper.ts
```

### E2E Tests

- Uses **Testcontainers** for real PostgreSQL instances
- Config: `apps/api/jest.e2e.config.cjs`
- Tests run against isolated Docker containers

### Coverage

- Tracked via **Codecov** in CI
- Coverage reports generated at `apps/*/coverage/`
- Run: `bun run test:cov`

## CI/CD Pipeline

**File:** `.github/workflows/ci.yml`

**Triggers:** Push/PR to `main` or `develop`

| Job | Depends On | Services | Description |
|-----|-----------|----------|-------------|
| Lint | - | - | ESLint across all apps |
| Type Check | - | - | TypeScript compilation check |
| Test | - | PostgreSQL 16, Redis 7 | Jest unit + coverage (Codecov) |
| Build | Lint, Type Check | - | Production build of all apps |

**CI features:**
- Concurrency groups (cancels in-progress runs)
- Turbo remote caching
- Build artifact upload (7-day retention)
- Frozen lockfile enforcement

## Docker (Local Development)

**File:** `docker-compose.yml`

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| redis | redis:7-alpine | 6379 | Rate limiting, caching |
| api | Custom Dockerfile | 3001 | API server |
| web | Custom Dockerfile | 3000 | Web dashboard |

**Note:** PostgreSQL runs on Supabase (cloud), not locally in Docker.

## Code Conventions

### Pre-Commit Checklist (from CLAUDE.md)

Before committing, always run:
1. `bun run lint` - No lint errors
2. `bun run check-types` - No type errors
3. `bun run build` - Successful build
4. `bun run test:cov` - All tests pass

### Project Rules
- Backend APIs must have unit tests
- UI components added via `bunx shadcn@latest add <name>`
- Performance optimization review for 10K customers/month
- No package installations without team approval
