# Story 12.1: Sentry SDK Integration

Status: ready-for-dev

## Story

As a **system**,
I want Sentry integrated for error tracking,
so that unhandled errors are captured and analyzed automatically with readable stack traces.

## Acceptance Criteria

1. **Given** Sentry credentials are configured (`SENTRY_DSN` env var), **When** the app initializes, **Then** `@sentry/nestjs` SDK is loaded in the backend with environment tag and release version.
2. **Given** Sentry is configured, **When** in production, **Then** source maps are uploaded for readable stack traces.
3. **Given** `SENTRY_DSN` is empty or missing, **When** the app starts, **Then** Sentry is gracefully disabled (no errors, no blocking).
4. **Given** Sentry SDK is loaded, **When** an unhandled exception occurs, **Then** it is automatically captured and sent to Sentry.
5. **Given** the existing `AllExceptionsFilter`, **When** integrating Sentry, **Then** the filter is updated to call `Sentry.captureException()` for 5xx errors before returning the response.
6. **Given** unit tests exist, **Then** tests verify Sentry initialization, capture calls, and graceful disable behavior with mocked SDK.

## Tasks / Subtasks

- [ ] **Task 1: Install Sentry dependencies** (AC: #1)
  - [ ] `cd apps/api && bun add @sentry/nestjs @sentry/profiling-node`

- [ ] **Task 2: Create SentryModule (global)** (AC: #1, #3)
  - [ ] Create `apps/api/src/common/sentry/sentry.module.ts`
  - [ ] Mark as `@Global()` following CryptoModule/TracerModule pattern
  - [ ] Provide and export `SentryService`
  - [ ] Register in `AppModule` imports

- [ ] **Task 3: Create SentryService** (AC: #1, #3, #4)
  - [ ] Create `apps/api/src/common/sentry/sentry.service.ts`
  - [ ] Inject `ConfigService` to read `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `npm_package_version`
  - [ ] Implement `isEnabled(): boolean` — returns true only if `SENTRY_DSN` is non-empty
  - [ ] Implement `captureException(exception: unknown, context?: Record<string, unknown>): void` — no-op if disabled
  - [ ] Implement `captureMessage(message: string, level?: SeverityLevel): void` — no-op if disabled
  - [ ] Log "Sentry disabled — SENTRY_DSN not configured" at startup if DSN is missing

- [ ] **Task 4: Update main.ts for early Sentry init** (AC: #1, #3)
  - [ ] In `apps/api/src/main.ts`, call `Sentry.init()` BEFORE `NestFactory.create(AppModule)`
  - [ ] Read `SENTRY_DSN` from `process.env` directly (ConfigService not yet available at this point)
  - [ ] Pass `environment`, `release`, `dsn` to `Sentry.init()`
  - [ ] Guard with `if (process.env.SENTRY_DSN)` so it's a no-op when missing

- [ ] **Task 5: Update AllExceptionsFilter** (AC: #5)
  - [ ] Modify `apps/api/src/filters/all-exceptions.filter.ts`
  - [ ] Inject `SentryService` (make filter `@Injectable()` with constructor injection)
  - [ ] Inside `catch()`, after the existing 500+ error logging block, call `this.sentryService.captureException(exception, { correlationId, method, url })`
  - [ ] Only capture for `status >= 500` (not client errors)

- [ ] **Task 6: Source map upload configuration** (AC: #2)
  - [ ] Add `@sentry/nestjs` plugin configuration or document the `sentry-cli` upload step for CI
  - [ ] Ensure `sourcemaps` option is set in `Sentry.init()` for production

- [ ] **Task 7: Add env vars to .env.example** (AC: #1, #3)
  - [ ] Add/uncomment `SENTRY_DSN` in `.env.example` (already exists as commented-out)
  - [ ] Add `SENTRY_ENVIRONMENT=development` to `.env.example`

- [ ] **Task 8: Unit tests** (AC: #6)
  - [ ] Create `apps/api/test/common/sentry/sentry.service.spec.ts`
  - [ ] Test: when DSN is configured, `isEnabled()` returns true
  - [ ] Test: when DSN is empty/missing, `isEnabled()` returns false
  - [ ] Test: `captureException()` calls `Sentry.captureException()` when enabled
  - [ ] Test: `captureException()` is a no-op when disabled
  - [ ] Test: AllExceptionsFilter calls `sentryService.captureException()` for 5xx errors
  - [ ] Test: AllExceptionsFilter does NOT call `sentryService.captureException()` for 4xx errors
  - [ ] Mock `@sentry/nestjs` module entirely — do NOT make real Sentry API calls

## Dev Notes

### Architecture Compliance

**Sentry DSN already in env config** — `.env.example` has `# SENTRY_DSN=https://your-dsn@sentry.io/project-id` as a commented-out variable. This story activates it.

**Early init is critical** — `@sentry/nestjs` must be initialized before NestJS creates the application so it can hook into Node.js error handlers. This means `Sentry.init()` goes in `main.ts` before `NestFactory.create()`, reading `process.env.SENTRY_DSN` directly (not via ConfigService, which isn't available yet). The `SentryService` wrapper is for application-level capture calls.

**AllExceptionsFilter is globally registered** — It's registered as `APP_FILTER` in `AppModule`, so injecting `SentryService` via constructor works (NestJS instantiates it with DI). The filter currently logs 5xx errors via `NestJS Logger`; we add `Sentry.captureException()` alongside that.

### Existing Patterns to Follow

**Global module pattern** — Follow `CryptoModule`:
```typescript
// apps/api/src/common/crypto/crypto.module.ts
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

**ConfigService usage** — Read env vars via `@nestjs/config`:
```typescript
constructor(private configService: ConfigService) {
  this.dsn = this.configService.get<string>('SENTRY_DSN');
}
```

**AllExceptionsFilter current structure** — Located at `apps/api/src/filters/all-exceptions.filter.ts`. Already has correlation ID context via `getRequestContext()`. The Sentry capture call should go inside the `if (status >= 500)` block, right after the existing `this.logger.error()` call.

### What This Story Does NOT Include

- **Frontend Sentry** — `@sentry/nextjs` for `apps/web` is a separate story
- **User/request context enrichment** — That's Story 12-2 (adding user ID, org ID, correlation ID to Sentry scope)
- **APM/performance monitoring** — That's Story 12-7 (Sentry tracing and profiling)
- **Alerts/notification rules** — Configured in Sentry dashboard, not in code
- **Release health tracking** — Separate concern, may be added later

### Project Structure Notes

New files to create:
```
apps/api/src/common/sentry/
├── sentry.module.ts          # Global module, exports SentryService
└── sentry.service.ts         # Wraps @sentry/nestjs init + capture methods

apps/api/test/common/sentry/
└── sentry.service.spec.ts    # Unit tests with mocked Sentry SDK
```

Modified files:
```
apps/api/src/main.ts                          # Add Sentry.init() before NestFactory.create
apps/api/src/filters/all-exceptions.filter.ts # Add SentryService injection + captureException
apps/api/src/modules/app.module.ts            # Import SentryModule
.env.example                                  # Uncomment/add SENTRY_DSN, add SENTRY_ENVIRONMENT
```

### Testing Approach

Mock `@sentry/nestjs` entirely — do NOT make real Sentry API calls:
```typescript
jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setContext: jest.fn(),
}));
```

Follow existing test patterns from `apps/api/test/common/tracer/tracer.service.spec.ts` for global service testing. Use `@nestjs/testing` `Test.createTestingModule()` with mocked ConfigService providing/omitting `SENTRY_DSN`.

### References

- [Source: .env.example — `# SENTRY_DSN=https://your-dsn@sentry.io/project-id`]
- [Source: apps/api/src/filters/all-exceptions.filter.ts — AllExceptionsFilter with 5xx logging]
- [Source: apps/api/src/main.ts — Bootstrap function where Sentry.init() must go]
- [Source: apps/api/src/common/crypto/crypto.module.ts — Global module pattern]
- [Source: apps/api/src/modules/app.module.ts — Module registration and APP_FILTER binding]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR51-63 Observability, Epic 12 scope]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
