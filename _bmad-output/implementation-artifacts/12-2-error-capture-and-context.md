# Story 12.2: Error Capture and Context

Status: done

## Story

As a **developer**,
I want errors captured with full user and request context,
so that issues can be diagnosed quickly without needing to reproduce them locally.

## Acceptance Criteria

1. **Given** an error is sent to Sentry (via 12-1), **When** captured, **Then** user context (userId, auth0Id, organizationId, role) is attached to the Sentry event.
2. **Given** an error occurs during a request, **When** captured, **Then** request context (URL, method, correlationId) is attached to the Sentry event.
3. **Given** Sentry is capturing events, **When** an error includes breadcrumbs, **Then** recent events (last 5 log entries, last HTTP call) leading to the error are included.
4. **Given** sensitive data in requests, **When** Sentry captures context, **Then** passwords, tokens, secrets, and Authorization headers are scrubbed before sending.
5. **Given** Sentry user context, **When** set, **Then** it uses the correlationId from AsyncLocalStorage and user info from `request.user`.
6. **Given** tests exist, **Then** unit tests verify context enrichment, data scrubbing patterns, and breadcrumb attachment.

## Tasks / Subtasks

- [x] **Task 1: Create SentryInterceptor** (AC: #1, #2, #5)
  - [x] Create `apps/api/src/common/sentry/sentry.interceptor.ts`
  - [x] Implement as `NestInterceptor` with `@Injectable()`
  - [x] Inject `SentryService` (from Story 12-1)
  - [x] In `intercept()`, extract `request.user` (populated by UserSyncGuard) and `getRequestContext()` for correlationId
  - [x] Call `Sentry.setUser({ id: user.id, auth0Id: user.auth0Id, organizationId: user.organizationId })` if user exists
  - [x] Call `Sentry.setContext('request', { url: request.originalUrl, method: request.method, correlationId })`
  - [x] Call `Sentry.setTag('correlationId', correlationId)` for easy filtering in Sentry dashboard
  - [x] Wrap with `if (this.sentryService.isEnabled())` guard so it's a no-op when Sentry is disabled

- [x] **Task 2: Register SentryInterceptor as APP_INTERCEPTOR** (AC: #1, #2)
  - [x] In `apps/api/src/modules/app.module.ts`, add `{ provide: APP_INTERCEPTOR, useClass: SentryInterceptor }` AFTER the existing LoggingInterceptor entry
  - [x] Import `SentryInterceptor` from `../common/sentry/sentry.interceptor`

- [x] **Task 3: Configure data scrubbing in SentryService init** (AC: #4)
  - [x] In `apps/api/src/main.ts` Sentry.init() call (from 12-1), add `beforeSend` callback
  - [x] Strip `Authorization` header from `event.request.headers`
  - [x] Redact any field matching patterns: `password`, `secret`, `token`, `apiKey`, `api_key`, `credential`
  - [x] Recursively scrub `event.request.data` and `event.extra` objects
  - [x] Replace matched values with `[REDACTED]`

- [x] **Task 4: Add breadcrumb integration** (AC: #3)
  - [x] Sentry automatically captures console breadcrumbs via its `Console` integration (enabled by default)
  - [x] In `SentryInterceptor`, add a custom breadcrumb on request start: `Sentry.addBreadcrumb({ category: 'http', message: \`${method} ${url}\`, level: 'info' })`
  - [x] Ensure Sentry's `maxBreadcrumbs` is set to a reasonable value (e.g., 25) in `Sentry.init()`

- [x] **Task 5: Unit tests** (AC: #6)
  - [x] Create `apps/api/test/common/sentry/sentry.interceptor.spec.ts`
  - [x] Test: interceptor calls `Sentry.setUser()` with correct fields when `request.user` exists
  - [x] Test: interceptor calls `Sentry.setContext('request', ...)` with URL, method, correlationId
  - [x] Test: interceptor calls `Sentry.setTag('correlationId', ...)`
  - [x] Test: interceptor does NOT call Sentry methods when `sentryService.isEnabled()` returns false
  - [x] Test: interceptor handles missing `request.user` gracefully (public routes)
  - [x] Test: `beforeSend` callback strips `Authorization` header
  - [x] Test: `beforeSend` callback redacts password/secret/token fields
  - [x] Mock `@sentry/nestjs` module entirely

## Dev Notes

### Architecture Compliance

**Interceptor execution order matters** — NestJS interceptors run AFTER guards. The `JwtAuthGuard` and `UserSyncGuard` populate `request.user` with `{ id, auth0Id, organizationId, role, ... }`. The `LoggingInterceptor` already enriches AsyncLocalStorage with `userId` and `auth0Id`. The `SentryInterceptor` should run after `LoggingInterceptor` (registered after it in AppModule providers) so all context is available.

**AsyncLocalStorage is the source of truth for correlationId** — The `CorrelationIdMiddleware` sets up the store, and `getRequestContext()` from `apps/api/src/common/tracer/correlation.storage.ts` retrieves it. The `RequestContext` interface has `correlationId`, `userId`, `auth0Id`, `method`, `url`.

**Sentry scope is request-scoped via its own isolation** — `@sentry/nestjs` automatically creates isolation scopes per request when using its NestJS integration. Calling `Sentry.setUser()` and `Sentry.setContext()` inside an interceptor applies to the current request's scope only.

### Existing Patterns to Follow

**LoggingInterceptor pattern** — Located at `apps/api/src/interceptors/logging.interceptor.ts`. Shows how to extract `request.user`, call `getRequestContext()`, and use `next.handle().pipe(tap(...))`. The SentryInterceptor follows the same pattern but enriches Sentry scope instead of logging.

**AllExceptionsFilter already calls SentryService** — Story 12-1 updates the filter to call `sentryService.captureException()` for 5xx errors. This story enriches the CONTEXT that goes along with those captures.

**Global module registration** — The interceptor is registered via `APP_INTERCEPTOR` in AppModule, same as LoggingInterceptor.

### What This Story Does NOT Include

- **Frontend Sentry context** — `@sentry/nextjs` for `apps/web` is a separate concern
- **APM/performance transaction context** — That's Story 12-7 (tracing)
- **Custom Sentry fingerprinting** — Grouping rules are configured in the Sentry dashboard
- **PII compliance review** — Data scrubbing covers obvious secrets; full PII audit is separate

### Project Structure Notes

New files to create:
```
apps/api/src/common/sentry/
└── sentry.interceptor.ts        # NestJS interceptor enriching Sentry scope

apps/api/test/common/sentry/
└── sentry.interceptor.spec.ts   # Unit tests with mocked Sentry SDK
```

Modified files:
```
apps/api/src/modules/app.module.ts   # Register SentryInterceptor as APP_INTERCEPTOR
apps/api/src/main.ts                 # Add beforeSend scrubbing + maxBreadcrumbs to Sentry.init()
```

### Testing Approach

Mock `@sentry/nestjs` entirely — do NOT make real Sentry API calls:
```typescript
jest.mock('@sentry/nestjs', () => ({
  setUser: jest.fn(),
  setContext: jest.fn(),
  setTag: jest.fn(),
  addBreadcrumb: jest.fn(),
  getCurrentScope: jest.fn(),
}));
```

Mock `SentryService` with `isEnabled()` returning true/false to test both paths. Mock `getRequestContext()` from `correlation.storage.ts` to return a known correlationId. Use `@nestjs/testing` `Test.createTestingModule()` and create a mock `ExecutionContext` with `switchToHttp().getRequest()` returning a request object with user context.

For `beforeSend` tests, extract the callback function and test it directly with crafted event objects containing sensitive fields.

### References

- [Source: apps/api/src/common/tracer/correlation.storage.ts — RequestContext interface and getRequestContext()]
- [Source: apps/api/src/interceptors/logging.interceptor.ts — Interceptor pattern with request.user and AsyncLocalStorage]
- [Source: apps/api/src/filters/all-exceptions.filter.ts — AllExceptionsFilter with Sentry capture (from 12-1)]
- [Source: apps/api/src/modules/app.module.ts — APP_INTERCEPTOR registration order]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR51-63 Observability, Security Layer 6: Data Protection]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed type error: `beforeSend` expects `ErrorEvent` not `Event` — extracted scrubber to separate file with correct signature

### Completion Notes List
- Task 1: Created `SentryInterceptor` following `LoggingInterceptor` pattern — enriches Sentry scope with user context, request context, correlationId tag, and HTTP breadcrumb; no-op when disabled
- Task 2: Registered `SentryInterceptor` as `APP_INTERCEPTOR` after `LoggingInterceptor` in `AppModule`
- Task 3: Extracted `scrubSentryEvent` into `sentry.scrubber.ts` for testability — strips Authorization header, recursively redacts password/secret/token/apiKey/api_key/credential fields in request data and extra context
- Task 4: Added `Sentry.addBreadcrumb()` in interceptor + `maxBreadcrumbs: 25` in `Sentry.init()`
- Task 5: 18 new tests across 2 spec files (8 interceptor + 10 scrubber), all passing. Full suite: 948 tests, 0 failures
- Code Review Fixes: [H1] Added `role` to `Sentry.setUser()` per AC#1; [M1] Scrubber now recurses into arrays; [M2] Added `query_string` scrubbing; [L1] Unified scrub logic via `scrubValue` helper; [L2] Added test for store with undefined correlationId. 5 new tests added (total: 953)

### File List
- `apps/api/src/common/sentry/sentry.interceptor.ts` (new)
- `apps/api/src/common/sentry/sentry.scrubber.ts` (new)
- `apps/api/src/modules/app.module.ts` (modified — added SentryInterceptor registration)
- `apps/api/src/main.ts` (modified — added beforeSend, maxBreadcrumbs, scrubber import)
- `apps/api/test/common/sentry/sentry.interceptor.spec.ts` (new)
- `apps/api/test/common/sentry/sentry.scrubber.spec.ts` (new)

### Change Log
- 2026-03-11: Implemented Story 12-2 — Error Capture and Context (all 5 tasks complete)
- 2026-03-11: Code review — fixed 5 issues (1H, 2M, 2L), added 5 tests, all gates green
