# Development Guide - CodeWeaves Platform

> Generated: 2026-02-14

## Prerequisites

| Requirement | Version            | Notes                 |
| ----------- | ------------------ | --------------------- |
| Node.js     | >= 18 (CI uses 24) | JavaScript runtime    |
| Bun         | 1.3.8              | Package manager       |
| Docker      | Latest             | For Redis (local dev) |
| Git         | Latest             | Version control       |

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd codeweaves-platform
bun install
```

### 2. Environment

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Both templates document each variable inline. The ones you must fill before the
API will boot:

| Variable                                    | Where it comes from                                 |
| ------------------------------------------- | --------------------------------------------------- |
| `CLERK_ISSUER`, `CLERK_SECRET_KEY`          | Clerk dashboard (auth)                              |
| `AGENT_SECRET_KEY`                          | any 64-character hex string, `openssl rand -hex 32` |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_CLERK_ID` | your own Clerk account, so you can sign in          |

AI, voice and WhatsApp keys are optional. Without them the app boots fine and
those specific features fail when you use them.

> **Never put a Supabase URL in `apps/api/.env`.** Local development uses the
> Docker Postgres below. Staging and production URLs live in CI secrets, and only
> CI migrates them. See
> [ADR-0001](adr/0001-environments-and-deploy-pipeline.md). This is enforced:
> `prisma.config.ts` refuses `migrate dev`, `migrate reset` and `db push`
> against any non-local host.

### 3. Database and Redis

One command starts Postgres and Redis in Docker, applies every migration, and
creates your super-admin account:

```bash
bun db:setup
```

Everything after that:

| Command                         | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `bun db:up`                     | start Postgres (host port **5433**) + Redis, wait until healthy |
| `bun db:down`                   | stop them, keep the data                                        |
| `bun db:nuke`                   | stop them and **delete the data**                               |
| `bun db:setup`                  | `db:up`, then migrate, then seed. Safe to re-run                |
| `bun --cwd apps/api db:migrate` | create a new migration after editing `schema.prisma`            |
| `bun --cwd apps/api db:reset`   | drop and rebuild the local database from migrations             |
| `bun --cwd apps/api db:studio`  | browse the data in Prisma Studio                                |

### 4. Run the apps

```bash
bun run dev              # everything

# or individually
cd apps/api && bun run dev       # API on 3001
cd apps/web && bun run dev       # dashboard on 3000
cd apps/widget && bun run dev    # widget on the Vite dev server
```

Postgres is on **5433**, not 5432, so it cannot collide with a PostgreSQL
install you already have on your machine. The templates already use that port.

Check the API came up healthy:

```bash
curl http://localhost:3001/health/ready
```

`status: "ok"` means Postgres and Redis are both reachable. `degraded` means
Redis is down, which the app tolerates. `fail` with a 503 means Postgres is not
reachable, so check `docker compose ps`.

### 5. Changing the schema

```bash
# 1. edit apps/api/prisma/schema.prisma
# 2. create the migration against your LOCAL database
bun --cwd apps/api db:migrate
# 3. commit the generated folder in prisma/migrations/ with your code
# 4. open a PR. CI applies it to staging on merge.
```

Never run a migration against staging or production by hand. That is what left
six stray tables on the shared database before this was enforced.

## Development Commands

### Root (Turborepo)

| Command               | Description                |
| --------------------- | -------------------------- |
| `bun run dev`         | Start all apps in dev mode |
| `bun run build`       | Build all apps             |
| `bun run lint`        | Lint all apps              |
| `bun run check-types` | Type check all apps        |
| `bun run test`        | Run all tests              |
| `bun run test:cov`    | Run tests with coverage    |
| `bun run test:e2e`    | Run E2E tests              |
| `bun run format`      | Format code with Prettier  |

### API (`apps/api/`)

| Command                  | Description                |
| ------------------------ | -------------------------- |
| `bun run start:dev`      | Start with hot reload      |
| `bun run start:debug`    | Start with debugger        |
| `bun run build`          | Build with NestJS CLI      |
| `bun run test`           | Run unit tests             |
| `bun run test:cov`       | Tests with coverage        |
| `bun run test:e2e`       | E2E tests (Testcontainers) |
| `bun prisma generate`    | Generate Prisma client     |
| `bun prisma migrate dev` | Create new migration       |
| `bun prisma studio`      | Open database GUI          |

### Web (`apps/web/`)

| Command                         | Description             |
| ------------------------------- | ----------------------- |
| `bun run dev`                   | Start on port 3000      |
| `bun run build`                 | Production build        |
| `bun run start`                 | Start production server |
| `bunx shadcn@latest add <name>` | Add Shadcn component    |

### Widget (`apps/widget/`)

| Command           | Description              |
| ----------------- | ------------------------ |
| `bun run dev`     | Start Vite dev server    |
| `bun run build`   | Build single-file widget |
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

| Job        | Depends On       | Services               | Description                    |
| ---------- | ---------------- | ---------------------- | ------------------------------ |
| Lint       | -                | -                      | ESLint across all apps         |
| Type Check | -                | -                      | TypeScript compilation check   |
| Test       | -                | PostgreSQL 16, Redis 7 | Jest unit + coverage (Codecov) |
| Build      | Lint, Type Check | -                      | Production build of all apps   |

**CI features:**

- Concurrency groups (cancels in-progress runs)
- Turbo remote caching
- Build artifact upload (7-day retention)
- Frozen lockfile enforcement

## Docker (Local Development)

**File:** `docker-compose.yml`

| Service | Image             | Port | Purpose                |
| ------- | ----------------- | ---- | ---------------------- |
| redis   | redis:7-alpine    | 6379 | Rate limiting, caching |
| api     | Custom Dockerfile | 3001 | API server             |
| web     | Custom Dockerfile | 3000 | Web dashboard          |

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
