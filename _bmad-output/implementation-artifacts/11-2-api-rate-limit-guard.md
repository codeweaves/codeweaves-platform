# Story 11.2: API Rate Limit Guard

Status: ready-for-dev

## Story

As a **system**,
I want rate limits enforced on all API endpoints via a global NestJS guard,
so that no single client can overwhelm the system and all consumers receive fair access.

## Acceptance Criteria

1. **Given** rate limiting infrastructure exists (Story 11-1), **When** a request is made to any API endpoint, **Then** the `RateLimitGuard` checks the request against configured limits using `RateLimiterService.checkRateLimit()`.
2. **Given** an authenticated user (JWT validated, `request.user` populated), **When** requests are counted, **Then** the rate limit key is `rate_limit:user:{userId}:{endpoint}` and the limit is 100 requests per 60 seconds (`DEFAULT_API_RATE_LIMIT`).
3. **Given** an unauthenticated/public request (`@Public()` endpoint), **When** requests are counted, **Then** the rate limit key is `rate_limit:ip:{ip}:{endpoint}` using `request.ip` or the `x-forwarded-for` header, and the limit is 30 requests per 60 seconds (`DEFAULT_PUBLIC_RATE_LIMIT`).
4. **Given** a request exceeds the configured rate limit, **When** the guard runs, **Then** a `429 Too Many Requests` HTTP response is returned with a `Retry-After` header (value in seconds) and the standard rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
5. **Given** a request is within the configured rate limit, **When** the guard runs, **Then** the response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers and the request proceeds normally.
6. **Given** a `@SkipRateLimit()` decorator is applied to an endpoint or controller, **When** the guard runs, **Then** rate limiting is bypassed entirely (intended for health checks and internal endpoints).
7. **Given** a `@RateLimit({ limit, windowMs })` decorator is applied to an endpoint, **When** the guard runs, **Then** that endpoint uses the custom limits specified in the decorator instead of the defaults.
8. **Given** tests exist, **Then** unit tests cover: authenticated vs public keying strategies, limit exceeded (429), headers set on allowed requests, `@RateLimit()` custom override, and `@SkipRateLimit()` bypass.

## Tasks / Subtasks

- [ ] **Task 1: Create rate limit decorators** (AC: #6, #7)
  - [ ] Create `apps/api/src/decorators/rate-limit.decorator.ts`
  - [ ] Implement `@SkipRateLimit()` decorator using `SetMetadata('skipRateLimit', true)`
  - [ ] Implement `@RateLimit({ limit, windowMs })` decorator using `SetMetadata('rateLimit', { limit, windowMs })`
  - [ ] Export both from `apps/api/src/decorators/index.ts`

- [ ] **Task 2: Create RateLimitGuard** (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] Create `apps/api/src/guards/rate-limit.guard.ts`
  - [ ] Implement `CanActivate` interface
  - [ ] Inject `Reflector`, `RateLimiterService`
  - [ ] Guard logic flow:
    1. Check `@SkipRateLimit()` metadata via Reflector — if true, return `true` immediately
    2. Check `@RateLimit()` metadata for custom config — if present, use it; otherwise use defaults
    3. Check `@Public()` metadata (`IS_PUBLIC_KEY`) — determines keying strategy
    4. Build rate limit key:
       - Authenticated: `rate_limit:user:{request.user.id}:{method}:{path}`
       - Public/unauthenticated: `rate_limit:ip:{clientIp}:{method}:{path}`
    5. Call `RateLimiterService.checkRateLimit(key, limit, windowMs)`
    6. Set response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
    7. If `allowed: false`, throw `HttpException(429)` with `Retry-After` header
    8. If `allowed: true`, return `true`
  - [ ] Extract client IP from `request.ip` with `x-forwarded-for` header fallback
  - [ ] Build endpoint identifier from `request.method` + `request.route.path` (use route pattern, not actual URL, to avoid per-ID key explosion)
  - [ ] Export from `apps/api/src/guards/index.ts`

- [ ] **Task 3: Register RateLimitGuard as APP_GUARD** (AC: #1)
  - [ ] Add to `apps/api/src/modules/app.module.ts` providers array as 3rd `APP_GUARD` (after `UserSyncGuard`, before any future `RolesGuard` global registration)
  - [ ] Import `RateLimitGuard` from guards
  - [ ] Ensure `RedisModule` is imported in `AppModule` (may already be done by Story 11-1)

- [ ] **Task 4: Apply @SkipRateLimit() to health endpoints** (AC: #6)
  - [ ] Add `@SkipRateLimit()` to `HealthController` (apps/api/src/controllers/public/health.controller.ts)

- [ ] **Task 5: Unit tests** (AC: #8)
  - [ ] Create `apps/api/test/guards/rate-limit.guard.spec.ts`
  - [ ] Test: authenticated request uses `rate_limit:user:{userId}:{endpoint}` key
  - [ ] Test: public/unauthenticated request uses `rate_limit:ip:{ip}:{endpoint}` key
  - [ ] Test: request within limit — guard returns `true`, response headers are set
  - [ ] Test: request exceeds limit — `HttpException` with status 429, `Retry-After` header set
  - [ ] Test: `@SkipRateLimit()` — guard returns `true` without calling `RateLimiterService`
  - [ ] Test: `@RateLimit({ limit: 5, windowMs: 10000 })` — custom config is used instead of defaults
  - [ ] Test: IP extraction from `x-forwarded-for` header when `request.ip` is not available
  - [ ] Mock `RateLimiterService`, `Reflector`, and `ExecutionContext`

## Dev Notes

### Architecture Compliance

**Guard execution order matters.** NestJS executes global guards in the order they are registered as `APP_GUARD` providers. The `RateLimitGuard` must be registered AFTER `UserSyncGuard` so that `request.user` is populated (allowing user-based keying for authenticated requests). Current order in `app.module.ts`:

```
1. APP_GUARD: JwtAuthGuard      (validates JWT, sets request.user.auth0Id)
2. APP_GUARD: UserSyncGuard     (syncs user to DB, sets request.user.id)
3. APP_GUARD: RateLimitGuard    <-- NEW (this story)
```

`RolesGuard` is currently applied per-controller (not as `APP_GUARD`), so no ordering conflict there. `TenantGuard` is also per-controller.

**Response header access.** The guard needs the `Response` object to set headers. Use `context.switchToHttp().getResponse()` to get the Express Response object. This is the standard NestJS pattern — no need for `@Inject(REQUEST)`.

**429 response format.** Use `throw new HttpException({ statusCode: 429, message: 'Too Many Requests', retryAfter: seconds }, HttpStatus.TOO_MANY_REQUESTS)` and set the `Retry-After` header on the response before throwing.

### Existing Patterns to Follow

**Guard pattern** — Follow `RolesGuard` (`apps/api/src/guards/roles.guard.ts`):
```typescript
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rateLimiterService: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ...
  }
}
```

**Decorator pattern** — Follow `@Public()` and `@Roles()`:
```typescript
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);
```

**Reflector usage** — Use `reflector.getAllAndOverride()` to check handler-level then class-level metadata (handler takes priority).

**APP_GUARD registration** — Follow the existing pattern in `app.module.ts`:
```typescript
{
  provide: APP_GUARD,
  useClass: RateLimitGuard,
},
```

### What This Story Does NOT Include

- **Redis infrastructure setup** — That's Story 11-1 (prerequisite)
- **Widget/chat-specific message rate limiting** — That's Story 11-3
- **Per-organization rate limits** — Future enhancement; this story does per-user and per-IP only
- **Rate limit dashboard/monitoring** — Not in scope
- **Dynamic rate limit configuration** — Limits are code-defined constants; admin-configurable limits are a future feature

### Project Structure Notes

New files to create:
```
apps/api/src/decorators/rate-limit.decorator.ts    # @RateLimit() and @SkipRateLimit()
apps/api/src/guards/rate-limit.guard.ts            # RateLimitGuard (CanActivate)
apps/api/test/guards/rate-limit.guard.spec.ts      # Unit tests
```

Files to modify:
```
apps/api/src/decorators/index.ts                   # Export new decorators
apps/api/src/guards/index.ts                       # Export RateLimitGuard
apps/api/src/modules/app.module.ts                 # Register as APP_GUARD
apps/api/src/controllers/public/health.controller.ts  # Add @SkipRateLimit()
```

### Testing Approach

Mock all dependencies — no real Redis or HTTP connections:

```typescript
const mockRateLimiterService = {
  checkRateLimit: jest.fn(),
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

// Mock ExecutionContext with both Request and Response
const mockRequest = { user: { id: 'user-123' }, ip: '127.0.0.1', method: 'GET', route: { path: '/api/agents' } };
const mockResponse = { setHeader: jest.fn() };
const mockContext = {
  switchToHttp: () => ({ getRequest: () => mockRequest, getResponse: () => mockResponse }),
  getHandler: () => jest.fn(),
  getClass: () => jest.fn(),
};
```

Follow existing test patterns from `apps/api/test/guards/` (if any) or `apps/api/test/common/`.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md -- Security Layer 5: Rate Limiting]
- [Source: _bmad-output/planning-artifacts/prd.md -- FR109: Sliding window algorithm, FR110: Client blocking]
- [Source: _bmad-output/planning-artifacts/architecture.md -- NFR20: Rate limiting per organization]
- [Source: apps/api/src/guards/roles.guard.ts -- Guard implementation pattern]
- [Source: apps/api/src/decorators/public.decorator.ts -- Decorator pattern]
- [Source: apps/api/src/modules/app.module.ts -- APP_GUARD registration order]
- [Source: _bmad-output/implementation-artifacts/11-1-rate-limiting-infrastructure-redis.md -- Prerequisite story]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
