# Story 11.5: Replay Attack Prevention (Nonce Cache)

Status: ready-for-dev

## Story

As a **system**,
I want to prevent replay attacks using a nonce cache with timestamp validation,
so that captured requests cannot be reused by attackers.

## Acceptance Criteria

1. **Given** replay protection is enabled on an endpoint, **When** a request includes `X-Request-Nonce` and `X-Request-Timestamp` headers, **Then** the nonce is checked against the Redis cache.
2. **Given** a nonce has been seen before, **When** the same nonce is submitted, **Then** the request is rejected with `409 Conflict` and a security event is logged via TracerService.
3. **Given** a fresh nonce, **When** verified, **Then** the nonce is stored in Redis with a 5-minute TTL.
4. **Given** a request timestamp, **When** it is older than 5 minutes, **Then** the request is rejected (even if the nonce is fresh) to prevent delayed replays.
5. **Given** replay protection is implemented as a guard, **When** applied via `@ReplayProtected()` decorator, **Then** only decorated endpoints are checked (not all endpoints).
6. **Given** Redis is unavailable, **When** the nonce check fails due to a Redis error, **Then** the request is allowed (fail-open) with a warning logged.
7. **Given** tests exist, **Then** unit tests cover: fresh nonce accepted, duplicate nonce rejected, expired timestamp rejected, Redis failure fail-open, decorator application/skip.

## Tasks / Subtasks

- [ ] **Task 1: Create NonceService** (AC: #1, #2, #3, #4, #6)
  - [ ] 1.1 Create `apps/api/src/common/security/nonce.service.ts`
  - [ ] 1.2 Inject `RedisService` (from Story 11-1) and `Logger`
  - [ ] 1.3 Implement `checkAndStoreNonce(nonce: string, timestampMs: number): Promise<{ valid: boolean; reason?: string }>`
  - [ ] 1.4 Validate timestamp: reject if `|Date.now() - timestampMs| > 300000` (5 minutes)
  - [ ] 1.5 Hash the nonce with SHA-256 before using as Redis key: `nonce:{sha256(nonce)}`
  - [ ] 1.6 Check if hashed nonce exists in Redis (`GET`); if exists, return `{ valid: false, reason: 'duplicate_nonce' }`
  - [ ] 1.7 If fresh, store hashed nonce in Redis with `SET ... EX 300` (5-minute TTL)
  - [ ] 1.8 Wrap all Redis calls in try/catch — on error, return `{ valid: true }` (fail-open) and log warning

- [ ] **Task 2: Create @ReplayProtected() decorator** (AC: #5)
  - [ ] 2.1 Create `apps/api/src/decorators/replay-protected.decorator.ts`
  - [ ] 2.2 Use `SetMetadata` with key `REPLAY_PROTECTED` and value `true`
  - [ ] 2.3 Export from `apps/api/src/decorators/index.ts`

- [ ] **Task 3: Create ReplayProtectionGuard** (AC: #1, #2, #3, #4, #5, #6)
  - [ ] 3.1 Create `apps/api/src/guards/replay-protection.guard.ts`
  - [ ] 3.2 Inject `Reflector`, `NonceService`, and `TracerService`
  - [ ] 3.3 In `canActivate()`, check `Reflector` for `REPLAY_PROTECTED` metadata — if not present, return `true` (skip)
  - [ ] 3.4 Read `X-Request-Nonce` and `X-Request-Timestamp` headers from the request
  - [ ] 3.5 If headers are missing, throw `HttpException(409, 'Missing replay protection headers')`
  - [ ] 3.6 Parse timestamp as integer, validate it is a number
  - [ ] 3.7 Call `NonceService.checkAndStoreNonce(nonce, timestamp)`
  - [ ] 3.8 If `valid: false`, log security audit event via TracerService and throw `ConflictException`
  - [ ] 3.9 If `valid: true`, return `true` to allow the request
  - [ ] 3.10 Export from `apps/api/src/guards/index.ts`

- [ ] **Task 4: Add NonceService to SecurityModule** (AC: #1)
  - [ ] 4.1 Add `NonceService` to providers and exports in `apps/api/src/common/security/security.module.ts` (created in Story 11-4)
  - [ ] 4.2 Register `ReplayProtectionGuard` as a provider in SecurityModule (or let it be injectable via guards)

- [ ] **Task 5: Register ReplayProtectionGuard globally** (AC: #5)
  - [ ] 5.1 Register guard globally via `APP_GUARD` provider in `AppModule` — the guard itself checks for the `@ReplayProtected()` decorator, so it is safe to register globally
  - [ ] 5.2 Guard execution order: `JwtAuthGuard → UserSyncGuard → RateLimitGuard → ReplayProtectionGuard → RolesGuard → TenantGuard`

- [ ] **Task 6: Unit tests for NonceService** (AC: #7)
  - [ ] 6.1 Create `apps/api/test/common/security/nonce.service.spec.ts`
  - [ ] 6.2 Mock `RedisService` with `get`, `set` methods
  - [ ] 6.3 Test fresh nonce: Redis returns `null` → stores nonce → returns `{ valid: true }`
  - [ ] 6.4 Test duplicate nonce: Redis returns existing value → returns `{ valid: false, reason: 'duplicate_nonce' }`
  - [ ] 6.5 Test expired timestamp (older than 5 min): returns `{ valid: false, reason: 'expired_timestamp' }` without hitting Redis
  - [ ] 6.6 Test future timestamp (more than 5 min ahead): returns `{ valid: false, reason: 'expired_timestamp' }`
  - [ ] 6.7 Test Redis failure: Redis throws error → returns `{ valid: true }` (fail-open) + warning logged
  - [ ] 6.8 Test nonce is hashed before storage (verify the Redis key format is `nonce:{sha256hash}`)

- [ ] **Task 7: Unit tests for ReplayProtectionGuard** (AC: #7)
  - [ ] 7.1 Create `apps/api/test/guards/replay-protection.guard.spec.ts`
  - [ ] 7.2 Mock `Reflector`, `NonceService`, `TracerService`
  - [ ] 7.3 Test endpoint without `@ReplayProtected()` decorator: guard returns `true` (skips)
  - [ ] 7.4 Test endpoint with `@ReplayProtected()` and valid nonce/timestamp: guard returns `true`
  - [ ] 7.5 Test endpoint with `@ReplayProtected()` and duplicate nonce: guard throws `ConflictException`
  - [ ] 7.6 Test endpoint with `@ReplayProtected()` and missing headers: guard throws `ConflictException`
  - [ ] 7.7 Test that `TracerService.logAuditEvent` is called on rejection with event `REPLAY_ATTACK_DETECTED`

## Dev Notes

### Architecture Compliance

This story implements **NFR25: Replay attack prevention** and **FR112: Nonce cache with timestamp validation** from the architecture document. It depends on **Story 11-1** (RedisModule with RedisService) for the Redis cache and **Story 11-4** (SecurityModule) for the module structure.

### Existing Patterns to Follow

**Guard + decorator pattern** — Follow the `RolesGuard` + `@Roles()` decorator pattern exactly:
```typescript
// apps/api/src/decorators/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// apps/api/src/guards/roles.guard.ts
const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
  context.getHandler(),
  context.getClass(),
]);
if (!requiredRoles || requiredRoles.length === 0) return true;
```

Apply the same pattern for `@ReplayProtected()`:
```typescript
// apps/api/src/decorators/replay-protected.decorator.ts
export const REPLAY_PROTECTED_KEY = 'replay_protected';
export const ReplayProtected = () => SetMetadata(REPLAY_PROTECTED_KEY, true);

// apps/api/src/guards/replay-protection.guard.ts
const isProtected = this.reflector.getAllAndOverride<boolean>(REPLAY_PROTECTED_KEY, [
  context.getHandler(),
  context.getClass(),
]);
if (!isProtected) return true;
```

**Fail-open pattern** — Matches the `RateLimiterService` from Story 11-1. Security infrastructure must never cause outages:
```typescript
try {
  // Redis operations
} catch (error) {
  this.logger.warn(`Redis error during nonce check: ${error.message}`);
  return { valid: true }; // fail-open
}
```

**TracerService audit logging** — Use the same pattern as other security events:
```typescript
await this.tracerService.logAuditEvent(
  'system',
  'REPLAY_ATTACK_DETECTED',
  { nonce: hashedNonce, reason, ip: request.ip, path: request.path },
);
```

### NonceService Implementation

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';

const NONCE_TTL_SECONDS = 300; // 5 minutes
const NONCE_WINDOW_MS = 300_000; // 5 minutes in ms

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);

  constructor(private readonly redis: RedisService) {}

  async checkAndStoreNonce(
    nonce: string,
    timestampMs: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    // 1. Validate timestamp window
    const drift = Math.abs(Date.now() - timestampMs);
    if (drift > NONCE_WINDOW_MS) {
      return { valid: false, reason: 'expired_timestamp' };
    }

    // 2. Hash the nonce (don't store raw values)
    const hashedNonce = createHash('sha256').update(nonce).digest('hex');
    const redisKey = `nonce:${hashedNonce}`;

    try {
      // 3. Check if nonce already exists
      const existing = await this.redis.get(redisKey);
      if (existing) {
        return { valid: false, reason: 'duplicate_nonce' };
      }

      // 4. Store with TTL
      await this.redis.set(redisKey, '1', 'EX', NONCE_TTL_SECONDS);
      return { valid: true };
    } catch (error) {
      // Fail-open: allow request if Redis is down
      this.logger.warn(
        `Redis error during nonce check, failing open: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return { valid: true };
    }
  }
}
```

### Where to Apply @ReplayProtected()

Apply to **sensitive mutation endpoints** only — NOT to read endpoints or high-frequency chat messages:
- Password change / profile update endpoints
- Invitation acceptance (`POST /invitations/:id/accept`)
- Data export triggers (`POST /analytics/export`)
- Organization settings changes
- Agent secret updates

Do **NOT** apply to:
- Chat message endpoints (too high frequency, would hurt UX)
- Read/GET endpoints (inherently idempotent)
- Public/widget endpoints (no auth context for nonce tracking)

### Security Design Decisions

1. **Hash nonces before storage** — If Redis is compromised, raw nonces are not exposed. The SHA-256 hash is one-way.
2. **5-minute window** — Balances security (short window) with clock drift tolerance. The `Math.abs()` check handles both past and future timestamps.
3. **Fail-open** — A Redis outage should not block all protected requests. Log warnings so ops can investigate, but don't cause a P1 incident.
4. **409 Conflict** — Standard HTTP status for duplicate/conflict scenarios. The client can interpret this as "request already processed."

### What This Story Does NOT Include

- **Client-side nonce generation** — Frontend must generate UUID v4 nonces and include `X-Request-Nonce` and `X-Request-Timestamp` headers. That is a frontend task for when `@ReplayProtected()` is applied to specific endpoints.
- **Nonce generation utility** — The client generates the nonce, not the server.
- **Applying @ReplayProtected() to specific endpoints** — This story creates the infrastructure. Applying the decorator to specific endpoints will be done in those endpoint stories or as a follow-up.
- **Redis cluster support** — Single Redis instance is sufficient for current scale. Cluster support is a future concern.

### Project Structure Notes

New files:
```
apps/api/src/common/security/
└── nonce.service.ts                        # NEW — Nonce validation with Redis cache

apps/api/src/decorators/
└── replay-protected.decorator.ts           # NEW — @ReplayProtected() decorator

apps/api/src/guards/
└── replay-protection.guard.ts              # NEW — NestJS CanActivate guard

apps/api/test/common/security/
└── nonce.service.spec.ts                   # NEW — NonceService unit tests

apps/api/test/guards/
└── replay-protection.guard.spec.ts         # NEW — ReplayProtectionGuard unit tests
```

Modified files:
```
apps/api/src/common/security/security.module.ts   # MODIFIED — add NonceService (created in 11-4)
apps/api/src/decorators/index.ts                   # MODIFIED — export ReplayProtected
apps/api/src/guards/index.ts                       # MODIFIED — export ReplayProtectionGuard
apps/api/src/modules/app.module.ts                 # MODIFIED — register ReplayProtectionGuard as APP_GUARD
```

### Testing Approach

**NonceService tests** — Mock `RedisService` completely:
```typescript
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
};

// Fresh nonce
mockRedisService.get.mockResolvedValue(null);
mockRedisService.set.mockResolvedValue('OK');
const result = await nonceService.checkAndStoreNonce('unique-nonce', Date.now());
expect(result.valid).toBe(true);
expect(mockRedisService.set).toHaveBeenCalledWith(
  expect.stringMatching(/^nonce:[a-f0-9]{64}$/),
  '1', 'EX', 300,
);

// Duplicate nonce
mockRedisService.get.mockResolvedValue('1');
const result2 = await nonceService.checkAndStoreNonce('duplicate-nonce', Date.now());
expect(result2.valid).toBe(false);
expect(result2.reason).toBe('duplicate_nonce');
```

**ReplayProtectionGuard tests** — Mock `Reflector`, `NonceService`, `TracerService`:
```typescript
const mockReflector = { getAllAndOverride: jest.fn() };
const mockNonceService = { checkAndStoreNonce: jest.fn() };
const mockTracerService = { logAuditEvent: jest.fn() };
```

Follow existing test patterns from `apps/api/test/guards/` if present, otherwise follow `apps/api/test/common/tracer/tracer.service.spec.ts` pattern.

### References

- [Source: `_bmad-output/planning-artifacts/architecture.md` — NFR25: Replay attack prevention]
- [Source: `_bmad-output/planning-artifacts/architecture.md` — FR112: Nonce cache with timestamp validation]
- [Source: `apps/api/src/guards/roles.guard.ts` — Guard + Reflector pattern]
- [Source: `apps/api/src/decorators/roles.decorator.ts` — SetMetadata decorator pattern]
- [Source: `apps/api/src/common/tracer/tracer.service.ts` — TracerService.logAuditEvent pattern]
- [Source: Story 11-1 — RedisModule with RedisService (dependency)]
- [Source: Story 11-4 — SecurityModule creation (dependency)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
