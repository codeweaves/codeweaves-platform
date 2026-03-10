# Story 12.7: Performance Monitoring (APM)

Status: ready-for-dev

## Story

As a **developer**,
I want application performance monitoring integrated via Sentry APM,
So that I can identify slow endpoints and bottlenecks in production.

## Acceptance Criteria

1. **Given** Sentry APM is configured (via 12-1),
   **When** requests are processed,
   **Then** transaction traces are automatically recorded.

2. **Given** a transaction trace,
   **When** recorded,
   **Then** it includes: endpoint name, HTTP method, status code, and duration.

3. **Given** database queries,
   **When** executed during a request,
   **Then** they are captured as child spans (Prisma integration).

4. **Given** external HTTP calls (n8n webhooks),
   **When** made,
   **Then** they are captured as child spans.

5. **Given** performance data,
   **When** analyzed in Sentry,
   **Then** P50, P95, P99 latencies are calculable per endpoint.

6. **Given** a configurable sample rate,
   **When** set via `SENTRY_TRACES_SAMPLE_RATE` env var,
   **Then** only that fraction of transactions are sent (default 0.1 = 10% in prod, 1.0 in dev).

7. **Given** tests exist,
   **Then** unit tests verify tracing configuration and sample rate behavior.

## Tasks / Subtasks

- [ ] Task 1: Update SentryService init to enable tracing (AC: 1, 2, 6)
  - [ ] Update `apps/api/src/common/sentry/sentry.service.ts` to read `SENTRY_TRACES_SAMPLE_RATE` from ConfigService
  - [ ] Set `tracesSampleRate` in `Sentry.init()` from the env var
  - [ ] Default to `0.1` in production and `1.0` in development
  - [ ] Ensure `@sentry/nestjs` automatic NestJS controller instrumentation is active (transactions per route)

- [ ] Task 2: Add Prisma integration for database span tracing (AC: 3)
  - [ ] Enable the Sentry Prisma tracing integration via `@sentry/nestjs` Prisma integration
  - [ ] Verify that database queries appear as child spans under request transactions
  - [ ] Ensure Prisma client is configured to emit tracing events if required by the integration

- [ ] Task 3: Add HTTP client tracing for outbound calls (AC: 4)
  - [ ] Enable Sentry's HTTP integration for outbound fetch/axios calls
  - [ ] Verify that n8n webhook calls are traced as child spans
  - [ ] Ensure outbound request spans include URL, method, and status code

- [ ] Task 4: Add `SENTRY_TRACES_SAMPLE_RATE` to environment configuration (AC: 6)
  - [ ] Add `SENTRY_TRACES_SAMPLE_RATE=0.1` to `.env.example`
  - [ ] Document the env var and its default behavior in the existing Sentry config section

- [ ] Task 5: Write unit tests for tracing configuration (AC: 7)
  - [ ] Create `apps/api/test/common/sentry/sentry-apm.spec.ts`
  - [ ] Test that `tracesSampleRate` is read from env var
  - [ ] Test default sample rate when env var is not set
  - [ ] Test that Prisma integration is included in Sentry integrations list
  - [ ] Test that HTTP integration is included in Sentry integrations list

## Dev Notes

### Architecture Compliance

- Follows NFR51-63 Observability requirements from `architecture.md`.
- P50/P95/P99 latency tracking is a Sentry-side aggregation feature; this story ensures the data is sent.
- Sample rate configuration allows cost control in production while maintaining full visibility in development.

### Existing Patterns to Follow

- `apps/api/src/common/sentry/sentry.service.ts` — extend the existing SentryService created in story 12-1.
- ConfigService pattern for reading env vars (already used across the codebase).
- AsyncLocalStorage correlation ID from existing LoggingInterceptor will automatically be associated with Sentry transactions via the request context.

### What This Story Does NOT Include

- Custom manual spans for individual business logic functions — rely on automatic instrumentation.
- Sentry Dashboard alert configuration (covered in stories 12-8 and 12-9).
- Frontend performance monitoring (this is backend APM only).
- Profiling (Sentry profiling is a separate feature and not in scope).

### Project Structure Notes

- `apps/api/src/common/sentry/sentry.service.ts` — primary file to update.
- `apps/api/test/common/sentry/sentry-apm.spec.ts` — new test file.
- `.env.example` — add new env var.

### Testing Approach

- Unit tests mock `Sentry.init()` and verify that the correct configuration (tracesSampleRate, integrations) is passed.
- No integration tests needed — Sentry's own SDK handles the actual tracing; we only test our configuration logic.
- Tests should verify behavior for both production and development environment defaults.

### References

- `docs/architecture.md` — NFR51-63 Observability, P50/P95/P99 latency tracking.
- Story 12-1 — SentryModule + SentryService (global) wrapping `@sentry/nestjs`.
- `@sentry/nestjs` docs for Prisma integration and HTTP tracing.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
