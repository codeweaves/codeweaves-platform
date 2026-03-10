# Story 12.1: Sentry SDK Integration

Status: done

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

- [x] **Task 1: Install Sentry dependencies** (AC: #1)
  - [x] `cd apps/api && bun add @sentry/nestjs @sentry/profiling-node`

- [x] **Task 2: Create SentryModule (global)** (AC: #1, #3)
  - [x] Create `apps/api/src/common/sentry/sentry.module.ts`
  - [x] Mark as `@Global()` following CryptoModule/TracerModule pattern
  - [x] Provide and export `SentryService`
  - [x] Register in `AppModule` imports

- [x] **Task 3: Create SentryService** (AC: #1, #3, #4)
  - [x] Create `apps/api/src/common/sentry/sentry.service.ts`
  - [x] Inject `ConfigService` to read `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `npm_package_version`
  - [x] Implement `isEnabled(): boolean` — returns true only if `SENTRY_DSN` is non-empty
  - [x] Implement `captureException(exception: unknown, context?: Record<string, unknown>): void` — no-op if disabled
  - [x] Implement `captureMessage(message: string, level?: SeverityLevel): void` — no-op if disabled
  - [x] Log "Sentry disabled — SENTRY_DSN not configured" at startup if DSN is missing

- [x] **Task 4: Update main.ts for early Sentry init** (AC: #1, #3)
  - [x] In `apps/api/src/main.ts`, call `Sentry.init()` BEFORE `NestFactory.create(AppModule)`
  - [x] Read `SENTRY_DSN` from `process.env` directly (ConfigService not yet available at this point)
  - [x] Pass `environment`, `release`, `dsn` to `Sentry.init()`
  - [x] Guard with `if (process.env.SENTRY_DSN)` so it's a no-op when missing

- [x] **Task 5: Update AllExceptionsFilter** (AC: #5)
  - [x] Modify `apps/api/src/filters/all-exceptions.filter.ts`
  - [x] Inject `SentryService` (make filter `@Injectable()` with constructor injection)
  - [x] Inside `catch()`, after the existing 500+ error logging block, call `this.sentryService.captureException(exception, { correlationId, method, url })`
  - [x] Only capture for `status >= 500` (not client errors)

- [x] **Task 6: Source map upload configuration** (AC: #2)
  - [x] Add `@sentry/nestjs` plugin configuration or document the `sentry-cli` upload step for CI
  - [x] Ensure `sourcemaps` option is set in `Sentry.init()` for production

- [x] **Task 7: Add env vars to .env.example** (AC: #1, #3)
  - [x] Add/uncomment `SENTRY_DSN` in `.env.example` (already exists as commented-out)
  - [x] Add `SENTRY_ENVIRONMENT=development` to `.env.example`

- [x] **Task 8: Unit tests** (AC: #6)
  - [x] Create `apps/api/test/common/sentry/sentry.service.spec.ts`
  - [x] Test: when DSN is configured, `isEnabled()` returns true
  - [x] Test: when DSN is empty/missing, `isEnabled()` returns false
  - [x] Test: `captureException()` calls `Sentry.captureException()` when enabled
  - [x] Test: `captureException()` is a no-op when disabled
  - [x] Test: AllExceptionsFilter calls `sentryService.captureException()` for 5xx errors
  - [x] Test: AllExceptionsFilter does NOT call `sentryService.captureException()` for 4xx errors
  - [x] Mock `@sentry/nestjs` module entirely — do NOT make real Sentry API calls

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
Claude Opus 4.6

### Debug Log References
- Lint warning fixed: removed unused `TestingModule` import in sentry.service.spec.ts

### Completion Notes List
- Installed `@sentry/nestjs@10.42.0` and `@sentry/profiling-node@10.42.0`
- Created `SentryModule` (@Global) and `SentryService` following CryptoModule/TracerModule pattern
- `SentryService` wraps Sentry SDK with `isEnabled()`, `captureException()`, `captureMessage()` — all no-op when DSN missing
- Early `Sentry.init()` in `main.ts` before `NestFactory.create()` reading `process.env.SENTRY_DSN` directly
- Source maps configured with `filesToDeleteAfterUpload` for production; upload via sentry-cli in CI
- `AllExceptionsFilter` updated to `@Injectable()` with `SentryService` DI — captures 5xx errors only
- Updated existing filter tests to use mock SentryService constructor injection
- 18 new/updated tests: 8 SentryService tests + 10 AllExceptionsFilter tests (4 new Sentry-specific)
- All 849 tests pass, lint clean, types clean, build clean

### Change Log
- 2026-03-10: Implemented Sentry SDK integration (all 8 tasks complete)
- 2026-03-10: Code review fixes — H1: replaced global Sentry.setContext with withScope for concurrency safety; M2: added SENTRY_RELEASE env var fallback; M3: added captureMessage default level test

### File List
- apps/api/src/common/sentry/sentry.module.ts (new)
- apps/api/src/common/sentry/sentry.service.ts (new)
- apps/api/src/main.ts (modified)
- apps/api/src/filters/all-exceptions.filter.ts (modified)
- apps/api/src/modules/app.module.ts (modified)
- apps/api/test/common/sentry/sentry.service.spec.ts (new)
- apps/api/test/filters/all-exceptions.filter.spec.ts (modified)
- apps/api/package.json (modified — new dependencies)
- bun.lock (modified — lockfile update)
- .env.example (modified)
