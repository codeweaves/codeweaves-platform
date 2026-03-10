# Story 11.1: Rate Limiting Infrastructure (Redis)

Status: done

## Story

As a **system**,
I want request rate limiting infrastructure using Redis with a sliding window algorithm,
so that the platform is protected from abuse and can enforce per-endpoint, per-org, and per-IP rate limits.

## Acceptance Criteria

1. **Given** Redis client is configured, **When** the API starts, **Then** a Redis connection is established using `ioredis` with the `REDIS_URL` environment variable, automatic reconnection, and health logging.
2. **Given** the Redis module exists, **When** imported by other modules, **Then** a singleton `RedisService` is available app-wide (global module) wrapping `ioredis` with get/set/incr/expire/eval (Lua) methods.
3. **Given** a `RateLimiterService` exists, **When** `checkRateLimit(key, limit, windowMs)` is called, **Then** it uses a sliding window algorithm via Redis sorted sets (`ZADD`/`ZRANGEBYSCORE`/`ZCARD`/`ZREMRANGEBYSCORE`) to count requests within the window.
4. **Given** a request is within the limit, **When** checked, **Then** the method returns `{ allowed: true, remaining: N, resetMs: T }`.
5. **Given** a request exceeds the limit, **When** checked, **Then** the method returns `{ allowed: false, remaining: 0, retryAfterMs: T }`.
6. **Given** Redis is unavailable, **When** rate limiting is checked, **Then** the request is **allowed** (fail-open) and a warning is logged — rate limiting must never block requests when Redis is down.
7. **Given** the Redis module is registered, **When** `GET /health/ready` is eventually implemented (Story 12-4), **Then** Redis connectivity can be checked via `RedisService.ping()`.
8. **Given** the infrastructure is set up, **When** tests run, **Then** unit tests cover the sliding window logic, fail-open behavior, and Redis error handling using mocked Redis clients.

## Tasks / Subtasks

- [x] **Task 1: Install Redis dependencies** (AC: #1, #2)
  - [x] `cd apps/api && bun add ioredis`
  - [x] `cd apps/api && bun add -D @types/ioredis` (if needed — check if ioredis ships its own types) — ioredis@5.10.0 ships own types, no @types needed

- [x] **Task 2: Create RedisModule (global)** (AC: #1, #2, #7)
  - [x] Create `apps/api/src/common/redis/redis.module.ts`
  - [x] Create `apps/api/src/common/redis/redis.service.ts`
  - [x] RedisService wraps `ioredis` client instance
  - [x] Constructor reads `REDIS_URL` from `ConfigService`
  - [x] Implements `OnModuleInit` (connect + log) and `OnModuleDestroy` (disconnect)
  - [x] Exposes: `ping()`, `get()`, `set()`, `del()`, `incr()`, `expire()`, `eval()` (for Lua scripts), `zadd()`, `zrangebyscore()`, `zcard()`, `zremrangebyscore()`, `pipeline()`
  - [x] Mark module as `@Global()` so it's available everywhere without explicit imports
  - [x] Register in `AppModule` imports

- [x] **Task 3: Create RateLimiterService** (AC: #3, #4, #5, #6)
  - [x] Create `apps/api/src/common/redis/rate-limiter.service.ts`
  - [x] Implement sliding window algorithm using Redis sorted sets:
    ```
    Key pattern: rate_limit:{identifier}:{endpoint}
    Algorithm:
    1. ZREMRANGEBYSCORE key 0 (now - windowMs)  // Remove expired entries
    2. ZADD key now now                          // Add current request
    3. ZCARD key                                 // Count requests in window
    4. EXPIRE key (windowMs / 1000)              // Set TTL for cleanup
    ```
  - [x] Method signature: `checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>`
  - [x] Return type: `{ allowed: boolean; remaining: number; retryAfterMs: number; resetMs: number }`
  - [x] Wrap all Redis calls in try/catch — on error, return `allowed: true` (fail-open) and log warning
  - [x] Use Redis pipeline for atomic multi-command execution

- [x] **Task 4: Create types and constants** (AC: #3, #4, #5)
  - [x] Create `apps/api/src/common/redis/rate-limiter.types.ts`
  - [x] Define `RateLimitResult` interface
  - [x] Define `RateLimitConfig` interface: `{ limit: number; windowMs: number }`
  - [x] Define default configs as constants:
    - `DEFAULT_API_RATE_LIMIT`: 100 requests / 60s (authenticated)
    - `DEFAULT_PUBLIC_RATE_LIMIT`: 30 requests / 60s (unauthenticated/widget)
    - `DEFAULT_MESSAGE_RATE_LIMIT`: 10 messages / 60s per device

- [x] **Task 5: Unit tests** (AC: #8)
  - [x] Create `apps/api/test/common/redis/redis.service.spec.ts`
  - [x] Create `apps/api/test/common/redis/rate-limiter.service.spec.ts`
  - [x] Test sliding window: requests within limit → allowed
  - [x] Test sliding window: requests exceeding limit → blocked with retryAfterMs
  - [x] Test window expiry: old requests drop off, new ones allowed
  - [x] Test fail-open: Redis error → allowed: true + warning logged
  - [x] Test ping: successful and failed
  - [x] Mock ioredis client (do NOT connect to real Redis in unit tests)

- [x] **Task 6: Docker compose verification** (AC: #1)
  - [x] Verify Redis service is running: `docker compose up redis -d` — Redis 7-alpine already in docker-compose.yml
  - [x] Verify API can connect on startup (check logs) — REDIS_URL already in .env and .env.example

## Dev Notes

### Architecture Compliance

**Redis is already in Docker Compose** — `redis:7-alpine` on port 6379 with health checks and persistent volume. The `REDIS_URL=redis://localhost:6379` env var exists in `.env` and `.env.example`. No infrastructure changes needed.

**No Redis packages exist yet** — `apps/api/package.json` has no `ioredis`, `redis`, `@nestjs/throttler`, or `@nestjs/cache-manager`. We're using `ioredis` directly (not `@nestjs/throttler`) because we need the sliding window algorithm with sorted sets, which throttler doesn't support out of the box.

**Why ioredis over redis package:** ioredis has better TypeScript support, built-in reconnection, Lua scripting, pipeline support, and is the de facto standard for production NestJS apps.

### Existing Patterns to Follow

**Global module pattern** — Follow `CryptoModule` and `TracerModule`:
```typescript
// apps/api/src/common/crypto/crypto.module.ts
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

**AppModule registration** — Add to imports array in `apps/api/src/modules/app.module.ts` alongside existing globals:
```typescript
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  PrismaModule,
  RedisModule,  // <-- Add here
  // ...
]
```

**ConfigService usage** — Read env vars via `@nestjs/config`:
```typescript
constructor(private configService: ConfigService) {
  const redisUrl = this.configService.get<string>('REDIS_URL');
}
```

**Guard execution order** (for context — rate limiting guard comes in Story 11-2):
```
CorrelationIdMiddleware → JwtAuthGuard → UserSyncGuard → RateLimitGuard → RolesGuard → TenantGuard
```

### Sliding Window Algorithm Detail

Using Redis sorted sets for precise sliding window (not fixed-window or token bucket):
- Each request is a member with score = timestamp in ms
- Window slides: remove entries older than `now - windowMs`
- Count remaining entries = requests in current window
- Atomic via Redis pipeline (MULTI/EXEC not needed for sorted set ops)

This is more accurate than fixed windows (no burst at window boundaries) and simpler than token bucket.

### What This Story Does NOT Include

- **Rate limit guard/middleware** — That's Story 11-2 (API Rate Limit Guard)
- **Widget-specific rate limits** — That's Story 11-3
- **Health check integration** — That's Story 12-4 (will use `RedisService.ping()`)
- **Caching** — Redis caching is a separate concern; this story is rate limiting infrastructure only

### Project Structure Notes

New files to create:
```
apps/api/src/common/redis/
├── redis.module.ts           # Global module, exports RedisService + RateLimiterService
├── redis.service.ts          # ioredis wrapper with connection management
├── rate-limiter.service.ts   # Sliding window algorithm
└── rate-limiter.types.ts     # Interfaces and constants

apps/api/test/common/redis/
├── redis.service.spec.ts
└── rate-limiter.service.spec.ts
```

### Testing Approach

Mock the ioredis client — do NOT depend on a running Redis instance for unit tests:
```typescript
const mockRedisClient = {
  zadd: jest.fn(),
  zremrangebyscore: jest.fn(),
  zcard: jest.fn(),
  expire: jest.fn(),
  pipeline: jest.fn().mockReturnValue({
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
  }),
  ping: jest.fn().mockResolvedValue('PONG'),
  quit: jest.fn(),
};
```

Follow existing test patterns from `apps/api/test/common/tracer/tracer.service.spec.ts` for global service testing.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — Security Layer 5: Rate Limiting]
- [Source: _bmad-output/planning-artifacts/prd.md — FR109: Sliding window algorithm, FR110: Client blocking]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR20: Rate limiting per organization]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR25: Replay attack prevention (nonce cache uses Redis)]
- [Source: docker-compose.yml — Redis 7-alpine service configuration]
- [Source: apps/api/.env.example — REDIS_URL=redis://localhost:6379]
- [Source: apps/api/src/common/crypto/crypto.module.ts — Global module pattern]
- [Source: apps/api/src/common/tracer/tracer.module.ts — Global module pattern]
- [Source: apps/api/src/modules/app.module.ts — Module registration pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- ioredis mock issue: jest.mock hoisting prevents external variable references; resolved by injecting mock client directly via bracket notation

### Completion Notes List
- Installed ioredis@5.10.0 (ships own TypeScript types)
- Created RedisModule as @Global() module exporting RedisService + RateLimiterService
- RedisService wraps ioredis with connection management (OnModuleInit/OnModuleDestroy), event logging, auto-reconnection
- RateLimiterService implements sliding window via Redis sorted sets + pipeline for atomic execution
- Fail-open: all Redis errors return allowed=true with warning log
- Defined RateLimitResult, RateLimitConfig interfaces and 3 default rate limit configs
- Registered RedisModule in AppModule imports
- 33 unit tests: 19 for RedisService, 14 for RateLimiterService
- Full suite: 837 tests pass, 0 regressions
- Lint, type-check, build all pass

### Code Review Fixes (2026-03-10)
- Fixed onModuleInit to be async and await Redis connection (was fire-and-forget)
- Added onModuleInit success path tests (event listeners, connect call, graceful failure)
- Improved retryAfterMs precision using ZRANGE to fetch oldest entry score
- Added 3 retryAfterMs precision tests (precise calc, empty fallback, error fallback)
- Added bun.lock to File List

### File List
- apps/api/package.json (modified — added ioredis dependency)
- apps/api/src/common/redis/redis.module.ts (new)
- apps/api/src/common/redis/redis.service.ts (new)
- apps/api/src/common/redis/rate-limiter.service.ts (new)
- apps/api/src/common/redis/rate-limiter.types.ts (new)
- apps/api/src/modules/app.module.ts (modified — added RedisModule import)
- apps/api/test/common/redis/redis.service.spec.ts (new)
- apps/api/test/common/redis/rate-limiter.service.spec.ts (new)
- bun.lock (modified — ioredis dependency added)

### Change Log
- 2026-03-10: Implemented rate limiting infrastructure with Redis sliding window algorithm (Story 11-1)
- 2026-03-10: Code review fixes — async onModuleInit, precise retryAfterMs, expanded test coverage
