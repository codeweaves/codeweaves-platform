# Story 12.2: Error Capture and Context

Status: ready-for-dev

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

- [ ] **Task 1: Create SentryInterceptor** (AC: #1, #2, #5)
  - [ ] Create `apps/api/src/common/sentry/sentry.interceptor.ts`
  - [ ] Implement as `NestInterceptor` with `@Injectable()`
  - [ ] Inject `SentryService` (from Story 12-1)
  - [ ] In `intercept()`, extract `request.user` (populated by UserSyncGuard) and `getRequestContext()` for correlationId
  - [ ] Call `Sentry.setUser({ id: user.id, auth0Id: user.auth0Id, organizationId: user.organizationId })` if user exists
  - [ ] Call `Sentry.setContext('request', { url: request.originalUrl, method: request.method, correlationId })`
  - [ ] Call `Sentry.setTag('correlationId', correlationId)` for easy filtering in Sentry dashboard
  - [ ] Wrap with `if (this.sentryService.isEnabled())` guard so it's a no-op when Sentry is disabled

- [ ] **Task 2: Register SentryInterceptor as APP_INTERCEPTOR** (AC: #1, #2)
  - [ ] In `apps/api/src/modules/app.module.ts`, add `{ provide: APP_INTERCEPTOR, useClass: SentryInterceptor }` AFTER the existing LoggingInterceptor entry
  - [ ] Import `SentryInterceptor` from `../common/sentry/sentry.interceptor`

- [ ] **Task 3: Configure data scrubbing in SentryService init** (AC: #4)
  - [ ] In `apps/api/src/main.ts` Sentry.init() call (from 12-1), add `beforeSend` callback
  - [ ] Strip `Authorization` header from `event.request.headers`
  - [ ] Redact any field matching patterns: `password`, `secret`, `token`, `apiKey`, `api_key`, `credential`
  - [ ] Recursively scrub `event.request.data` and `event.extra` objects
  - [ ] Replace matched values with `[REDACTED]`

- [ ] **Task 4: Add breadcrumb integration** (AC: #3)
  - [ ] Sentry automatically captures console breadcrumbs via its `Console` integration (enabled by default)
  - [ ] In `SentryInterceptor`, add a custom breadcrumb on request start: `Sentry.addBreadcrumb({ category: 'http', message: \`${method} ${url}\`, level: 'info' })`
  - [ ] Ensure Sentry's `maxBreadcrumbs` is set to a reasonable value (e.g., 25) in `Sentry.init()`

- [ ] **Task 5: Unit tests** (AC: #6)
  - [ ] Create `apps/api/test/common/sentry/sentry.interceptor.spec.ts`
  - [ ] Test: interceptor calls `Sentry.setUser()` with correct fields when `request.user` exists
  - [ ] Test: interceptor calls `Sentry.setContext('request', ...)` with URL, method, correlationId
  - [ ] Test: interceptor calls `Sentry.setTag('correlationId', ...)`
  - [ ] Test: interceptor does NOT call Sentry methods when `sentryService.isEnabled()` returns false
  - [ ] Test: interceptor handles missing `request.user` gracefully (public routes)
  - [ ] Test: `beforeSend` callback strips `Authorization` header
  - [ ] Test: `beforeSend` callback redacts password/secret/token fields
  - [ ] Mock `@sentry/nestjs` module entirely

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

### Debug Log References

### Completion Notes List

### File List
