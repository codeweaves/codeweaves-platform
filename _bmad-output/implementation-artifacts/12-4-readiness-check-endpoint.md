# Story 12.4: Readiness Check Endpoint

Status: ready-for-dev

## Story

As a **load balancer**,
I want a readiness health check endpoint,
so that I can detect if the service can handle traffic by verifying all dependencies are reachable.

## Acceptance Criteria

1. **Given** the API is running, **When** `GET /health/ready` is called, **Then** dependency checks are performed against database and Redis.
2. **Given** checks run, **When** all pass, **Then** 200 OK is returned with `{ status: "ok", checks: { database: "ok", redis: "ok" }, timestamp: <ISO string> }`.
3. **Given** any check fails, **When** responded, **Then** 503 Service Unavailable is returned with `{ status: "degraded", checks: { database: "ok", redis: "error", details: "..." }, timestamp: <ISO string> }`.
4. **Given** database check, **When** run, **Then** a simple query (`SELECT 1`) is executed via Prisma.
5. **Given** Redis check, **When** run, **Then** `RedisService.ping()` is called (from Story 11-1).
6. **Given** the endpoint, **When** called, **Then** it requires NO authentication and is rate-limit exempt.
7. **Given** checks, **When** run, **Then** each has a timeout of 2 seconds so a hanging dependency does not block the response.
8. **Given** tests exist, **Then** unit tests cover all-healthy, partial-failure, and full-failure scenarios with mocked services.

## Tasks / Subtasks

- [ ] **Task 1: Create HealthService** (AC: #1, #2, #3, #4, #5, #7)
  - [ ] Create `apps/api/src/modules/health/health.service.ts`
  - [ ] Inject `PrismaService` and `RedisService`
  - [ ] Implement `checkReadiness(): Promise<{ status: string, checks: Record<string, string>, timestamp: string }>`
  - [ ] Run all checks in parallel using `Promise.allSettled()`
  - [ ] Each check wrapped with `Promise.race()` against a 2-second timeout
  - [ ] Database check: `this.prisma.$queryRaw\`SELECT 1\`` — return `"ok"` on success, `"error"` with details on failure
  - [ ] Redis check: `this.redisService.ping()` — return `"ok"` if ping returns `"PONG"`, `"error"` with details on failure
  - [ ] Aggregate results: if all checks pass, `status: "ok"`; if any fail, `status: "degraded"`
  - [ ] Include error message in a `details` field for failed checks (but not full stack traces)

- [ ] **Task 2: Update HealthController with /health/ready** (AC: #1, #2, #3, #6)
  - [ ] In `apps/api/src/modules/health/health.controller.ts`, add `GET /health/ready` endpoint
  - [ ] Inject `HealthService`
  - [ ] Call `this.healthService.checkReadiness()`
  - [ ] Return 200 if `status === "ok"`, 503 if `status === "degraded"`
  - [ ] Apply `@Public()` to skip authentication
  - [ ] Apply `@SkipThrottle()` or equivalent rate-limit exemption (from Story 11-2)
  - [ ] Add Swagger decorators: `@ApiOperation`, `@ApiResponse` for 200 and 503

- [ ] **Task 3: Ensure /health/ready is excluded from global prefix** (AC: #6)
  - [ ] Verify `apps/api/src/main.ts` has `health/ready` in the exclude list (should be pre-configured in Story 12-3)
  - [ ] If not, update: `app.setGlobalPrefix('api/codeweaves/v1', { exclude: ['health', 'health/ready'] })`

- [ ] **Task 4: Update HealthModule** (AC: #1)
  - [ ] Update `apps/api/src/modules/health/health.module.ts` to provide `HealthService`
  - [ ] Import required modules if `PrismaService` and `RedisService` are not globally available
  - [ ] `PrismaModule` is global, so `PrismaService` should be injectable without import
  - [ ] `RedisModule` (from Story 11-1) should be global, so `RedisService` should be injectable without import

- [ ] **Task 5: Implement timeout wrapper utility** (AC: #7)
  - [ ] Create a helper function `withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>` that rejects with a timeout error after `ms` milliseconds
  - [ ] Use `Promise.race([promise, timeoutPromise])` pattern
  - [ ] Can be a private method in HealthService or a shared utility
  - [ ] Ensure the timeout promise is properly cleaned up (clear timer on success)

- [ ] **Task 6: Unit tests** (AC: #8)
  - [ ] Update `apps/api/test/controllers/health/health.controller.spec.ts` with readiness tests
  - [ ] Test: all checks healthy — returns 200 with `{ status: "ok", checks: { database: "ok", redis: "ok" }, timestamp }`
  - [ ] Test: database fails, Redis ok — returns 503 with `{ status: "degraded", checks: { database: "error", redis: "ok" }, timestamp }`
  - [ ] Test: Redis fails, database ok — returns 503 with `{ status: "degraded", checks: { redis: "error", database: "ok" }, timestamp }`
  - [ ] Test: all checks fail — returns 503 with `{ status: "degraded", checks: { database: "error", redis: "error" }, timestamp }`
  - [ ] Test: check timeout — mock a hanging promise, verify it resolves as "error" after 2 seconds
  - [ ] Test: endpoint is decorated with `@Public()`
  - [ ] Mock `PrismaService.$queryRaw` and `RedisService.ping()`

## Dev Notes

### Architecture Compliance

**Readiness vs. Liveness separation** — Kubernetes and cloud load balancers distinguish between liveness (is the process alive?) and readiness (can it serve traffic?). Story 12-3 handles liveness with zero dependencies. This story handles readiness by checking that the database and Redis are reachable. A service can be live but not ready (e.g., database is down).

**PrismaService is globally available** — `PrismaModule` is registered as a global module in AppModule. `PrismaService` extends `PrismaClient` and can be injected anywhere. Use `$queryRaw` for a minimal health check query.

**RedisService from Story 11-1** — Story 11-1 creates a global `RedisModule` with `RedisService` that has a `ping()` method. This story depends on 11-1 being implemented. If `RedisService` is not yet available, the check should gracefully skip or report "not configured".

### Existing Patterns to Follow

**Promise.allSettled() for parallel checks** — Run database and Redis checks simultaneously. `allSettled` ensures one failing check does not prevent others from completing:
```typescript
const results = await Promise.allSettled([
  this.withTimeout(this.checkDatabase(), 2000),
  this.withTimeout(this.checkRedis(), 2000),
]);
```

**Error handling pattern** — Each check returns `"ok"` or `"error"`. On failure, include the error message (not the full stack) in a `details` field for operator visibility. Do not leak internal implementation details.

**Controller response pattern** — Use `@HttpCode()` or `@Res()` to control status code based on readiness result:
```typescript
@Get('ready')
async checkReadiness(@Res() res: Response) {
  const result = await this.healthService.checkReadiness();
  const statusCode = result.status === 'ok' ? 200 : 503;
  return res.status(statusCode).json(result);
}
```

### What This Story Does NOT Include

- **Auth0 JWKS endpoint check** — Could be added later as an optional check, but not required for MVP readiness
- **Caching of readiness results** — Each call performs fresh checks; caching could mask transient failures
- **Metrics/alerting on readiness failures** — That's a monitoring concern
- **Circuit breaker on failing checks** — Out of scope; the readiness endpoint is informational
- **Custom health check registration API** — No extensible "register your own check" pattern yet

### Project Structure Notes

New files to create:
```
apps/api/src/modules/health/
└── health.service.ts            # checkReadiness() with dependency checks

apps/api/test/controllers/health/
└── health.controller.spec.ts    # Updated with readiness test cases (extends 12-3 tests)
```

Modified files:
```
apps/api/src/modules/health/health.module.ts      # Add HealthService to providers
apps/api/src/modules/health/health.controller.ts  # Add GET /health/ready endpoint
apps/api/src/main.ts                              # Verify health/ready in exclude list (from 12-3)
```

### Testing Approach

Mock `PrismaService` and `RedisService` to control check outcomes:
```typescript
const mockPrisma = { $queryRaw: jest.fn() };
const mockRedis = { ping: jest.fn() };
```

For the all-healthy case, both mocks resolve successfully. For partial failures, one mock rejects. For timeout testing, mock a promise that never resolves and verify the timeout mechanism triggers after 2 seconds (use `jest.useFakeTimers()` to avoid actual waits).

Test the `HealthService` independently from the controller. Then test the controller to verify it returns the correct HTTP status code (200 vs 503) based on the service result.

### References

- [Source: apps/api/src/modules/health/health.controller.ts — Created in Story 12-3, extended here]
- [Source: apps/api/src/modules/prisma.module.ts — Global PrismaModule]
- [Source: Story 11-1 — RedisModule and RedisService with ping()]
- [Source: Story 12-3 — Liveness endpoint and main.ts prefix exclusion]
- [Source: _bmad-output/planning-artifacts/architecture.md — FR161: Readiness check, Health check monitors Redis/DB connectivity]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
