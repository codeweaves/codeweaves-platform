# Story 12.3: Health Check Endpoint (Liveness)

Status: done

## Story

As a **load balancer**,
I want a liveness health check endpoint,
so that I can detect if the service process is running and able to respond to HTTP requests.

## Acceptance Criteria

1. **Given** the API is running, **When** `GET /health` is called, **Then** 200 OK is returned immediately.
2. **Given** the response, **When** returned, **Then** it includes `{ status: "ok", timestamp: <ISO string>, version: <string>, uptime: <number> }`.
3. **Given** the endpoint, **When** called, **Then** NO database or external service checks are performed (pure liveness).
4. **Given** performance, **When** called, **Then** response time is <10ms.
5. **Given** the endpoint, **When** called, **Then** it requires NO authentication (`@Public()` decorator) and is rate-limit exempt.
6. **Given** tests exist, **Then** unit tests verify response format, no-auth requirement, and fast response.

## Tasks / Subtasks

- [x] **Task 1: Refactor existing HealthController to root-level /health** (AC: #1, #2, #3, #5)
  - [x] Modify `apps/api/src/controllers/public/health.controller.ts` OR create new `apps/api/src/modules/health/health.controller.ts`
  - [x] Change the route so `GET /health` is served at the ROOT level, not under `/api/codeweaves/v1/public/health`
  - [x] Update `apps/api/src/main.ts` to exclude `health` from the global prefix: `app.setGlobalPrefix('api/codeweaves/v1', { exclude: ['health', 'health/ready'] })`
  - [x] Apply `@Public()` decorator to skip JwtAuthGuard
  - [x] Apply `@SkipThrottle()` or equivalent rate-limit exemption if rate limiting is configured (from Story 11-2)

- [x] **Task 2: Implement liveness response** (AC: #2, #3, #4)
  - [x] Return `{ status: 'ok', timestamp: new Date().toISOString(), version: process.env.npm_package_version || '0.0.0', uptime: process.uptime() }`
  - [x] Ensure NO database calls, NO Redis calls, NO external HTTP calls — pure in-memory response
  - [x] Keep the response synchronous (no async operations)

- [x] **Task 3: Create HealthModule** (AC: #1)
  - [x] Create `apps/api/src/modules/health/health.module.ts`
  - [x] Register `HealthController`
  - [x] Import `HealthModule` in `AppModule` and remove the old `HealthController` from AppModule's `controllers` array
  - [x] If keeping the existing `/public/health` and `/public/ping` for backward compatibility, plan a deprecation

- [x] **Task 4: Update main.ts prefix exclusion** (AC: #1)
  - [x] Change `app.setGlobalPrefix('api/codeweaves/v1')` to `app.setGlobalPrefix('api/codeweaves/v1', { exclude: ['health', 'health/ready'] })`
  - [x] The `health/ready` exclusion is pre-configured for Story 12-4

- [x] **Task 5: Unit tests** (AC: #6)
  - [x] Create `apps/api/test/controllers/health/health.controller.spec.ts`
  - [x] Test: `GET /health` returns 200 with `{ status: 'ok', timestamp, version, uptime }`
  - [x] Test: response has correct shape (status is string, timestamp is ISO format, version is string, uptime is number)
  - [x] Test: controller method is decorated with `@Public()`
  - [x] Test: response is returned without any injected dependencies (no DB, no Redis)

## Dev Notes

### Architecture Compliance

**Existing health endpoint at /api/codeweaves/v1/public/health** — There is already a `HealthController` at `apps/api/src/controllers/public/health.controller.ts` registered directly in AppModule's `controllers` array. It serves `GET /api/codeweaves/v1/public/health` and `GET /api/codeweaves/v1/public/ping`. This story moves the health check to the ROOT level (`GET /health`) so load balancers can hit it without knowing the API prefix.

**Global prefix exclusion** — NestJS `setGlobalPrefix()` accepts an `exclude` option. Routes listed there are served at the root, not under the prefix. This is the cleanest approach — no need for a separate Express router or custom middleware.

**No auth, no rate limiting** — The `@Public()` decorator (at `apps/api/src/decorators/public.decorator.ts`) sets `isPublic` metadata that `JwtAuthGuard` checks to skip authentication. Rate-limit exemption depends on Story 11-2's implementation (likely `@SkipThrottle()` from `@nestjs/throttler` or a custom `@SkipRateLimit()` decorator).

### Existing Patterns to Follow

**Current HealthController** — Located at `apps/api/src/controllers/public/health.controller.ts`:
```typescript
@Controller('public')
export class HealthController {
  @Public()
  @Get('health')
  getHealth() { return { status: 'ok', timestamp, version: '1.0.0' }; }
}
```
This story enhances the response (adds `uptime`) and moves it to the root level.

**@Public() decorator usage** — Already used throughout the codebase on public endpoints.

### What This Story Does NOT Include

- **Readiness checks** — Story 12-4 adds `GET /health/ready` with database and Redis checks
- **Kubernetes probes configuration** — That's infrastructure/DevOps configuration
- **Detailed system metrics** — That's a monitoring concern (Prometheus/Grafana)
- **Removing the old /public/health endpoint** — Consider deprecation rather than immediate removal to avoid breaking existing monitoring

### Project Structure Notes

New files to create:
```
apps/api/src/modules/health/
├── health.module.ts             # Module registering the controller
└── health.controller.ts         # GET /health (liveness)

apps/api/test/controllers/health/
└── health.controller.spec.ts    # Unit tests
```

Modified files:
```
apps/api/src/main.ts                # Add exclude list to setGlobalPrefix()
apps/api/src/modules/app.module.ts  # Import HealthModule, remove old HealthController from controllers
```

Files to potentially remove or deprecate:
```
apps/api/src/controllers/public/health.controller.ts  # Old health endpoint (evaluate backward compatibility)
```

### Testing Approach

Use `@nestjs/testing` `Test.createTestingModule()` to create the controller. Verify the response shape directly from the controller method. No mocking needed since liveness has no dependencies.

```typescript
const controller = new HealthController();
const result = controller.getHealth();
expect(result.status).toBe('ok');
expect(result.uptime).toBeGreaterThan(0);
expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
```

For verifying `@Public()` metadata, use `Reflect.getMetadata('isPublic', controller.getHealth)` or the appropriate metadata key.

### References

- [Source: apps/api/src/controllers/public/health.controller.ts — Existing health endpoint]
- [Source: apps/api/src/main.ts — Global prefix configuration at line 10]
- [Source: apps/api/src/modules/app.module.ts — HealthController registered in controllers array at line 40]
- [Source: apps/api/src/decorators/public.decorator.ts — @Public() decorator]
- [Source: _bmad-output/planning-artifacts/architecture.md — FR160: Health check endpoint, NFR40-50 Reliability]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A — no issues encountered.

### Completion Notes List
- Created new `HealthController` at `apps/api/src/modules/health/health.controller.ts` with `@Controller('health')`, `@Public()`, `@SkipRateLimit()` decorators. Returns `{ status, timestamp, version, uptime }` — pure in-memory, zero dependencies.
- Created `HealthModule` at `apps/api/src/modules/health/health.module.ts` registering the controller.
- Updated `AppModule` to import `HealthModule` and removed old `HealthController` from direct `controllers` array.
- Updated `main.ts` global prefix to exclude `['health', 'health/ready']` — `health/ready` pre-configured for Story 12-4.
- 9 unit tests all passing: response shape, ISO timestamp, version string, uptime number, @Public() metadata, @SkipRateLimit() metadata, no-dependency instantiation, <10ms performance.
- Full regression: 52 suites, 959 tests — all green.
- **Code Review Fixes (2026-03-11):**
  - Deleted old orphaned `controllers/public/health.controller.ts` + its test + barrel `index.ts` (was not registered in any module, routes were dead).
  - Updated frontend `use-health-check.ts` to call new `/health` endpoint instead of old `/public/health`.
  - Removed stale `./public` re-export from `controllers/index.ts`.
  - Added performance timing test (AC#4: <10ms assertion).
  - Fixed runtime crash: replaced `require('../../../package.json')` with `process.env.npm_package_version` and declared env var in `turbo.json`.

### File List
- `apps/api/src/modules/health/health.controller.ts` (new)
- `apps/api/src/modules/health/health.module.ts` (new)
- `apps/api/src/modules/app.module.ts` (modified — import HealthModule, removed old HealthController)
- `apps/api/src/main.ts` (modified — added exclude list to setGlobalPrefix)
- `apps/api/test/controllers/health/health.controller.spec.ts` (new)
- `apps/api/src/controllers/public/health.controller.ts` (deleted — replaced by new root-level controller)
- `apps/api/src/controllers/public/index.ts` (deleted — only re-exported deleted controller)
- `apps/api/test/controllers/public/health.controller.spec.ts` (deleted — tested orphaned controller)
- `apps/api/src/controllers/index.ts` (modified — removed `./public` re-export)
- `apps/web/hooks/use-health-check.ts` (modified — switched to new `/health` endpoint)
- `turbo.json` (modified — added `npm_package_version` to globalEnv)
