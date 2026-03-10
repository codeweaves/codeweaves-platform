# Story 12.11: Graceful Degradation - Database

Status: ready-for-dev

## Story

As a **system**,
I want graceful degradation during database issues,
So that partial functionality remains and users receive clear error messages.

## Acceptance Criteria

1. **Given** the database is experiencing issues
   **When** queries fail
   **Then** read operations return clear error messages (not stack traces)

2. **Given** a database connection error
   **When** it occurs
   **Then** the health check endpoint (`/health/ready`) marks database as unhealthy

3. **Given** database errors
   **When** they occur in non-critical paths (audit logging, analytics)
   **Then** the error is logged but the primary operation continues

4. **Given** database errors
   **When** they occur in critical paths (auth, chat session)
   **Then** a user-friendly error is returned

5. **Given** Prisma connection issues
   **When** detected
   **Then** automatic reconnection is attempted

6. **Given** tests exist
   **Then** unit tests verify error handling for critical and non-critical paths

## Tasks / Subtasks

- [ ] Task 1: Create database error handler utility (AC: 1, 4)
  - [ ] Create `apps/api/src/common/database/database-error.handler.ts`
  - [ ] Classify Prisma errors: connection errors, timeout errors, constraint violations, unknown
  - [ ] Map each error type to an appropriate HTTP status (503 for connection, 409 for constraints, 500 for unknown)
  - [ ] Return user-friendly error messages per classification (never expose raw Prisma error details)

- [ ] Task 2: Update AllExceptionsFilter for Prisma errors (AC: 1, 4)
  - [ ] Detect `PrismaClientKnownRequestError` and return appropriate HTTP response based on error code
  - [ ] Detect `PrismaClientInitializationError` and return 503 Service Unavailable
  - [ ] Detect `PrismaClientRustPanicError` and return 500 with generic message
  - [ ] Log full Prisma error context server-side (error code, meta, message)
  - [ ] Never expose Prisma error codes or internal details in the response body

- [ ] Task 3: Handle non-critical path failures gracefully (AC: 3)
  - [ ] Verify TracerService already has try/catch for non-blocking audit writes (confirm existing pattern)
  - [ ] Wrap analytics query failures: return empty data with a logged warning instead of crashing the request
  - [ ] Ensure any non-critical database write (e.g., usage tracking) does not fail the parent request

- [ ] Task 4: Verify Prisma reconnection behavior (AC: 5)
  - [ ] Confirm Prisma connection pooling is configured in `schema.prisma` or PrismaService
  - [ ] Verify Prisma auto-reconnects on transient connection failures (built-in behavior)
  - [ ] Document any additional connection pool settings (pool size, timeout) in dev notes

- [ ] Task 5: Integrate with health check endpoint (AC: 2)
  - [ ] Ensure `/health/ready` (from Story 12-4) reports database status based on Prisma connection state
  - [ ] If database is unreachable, `/health/ready` should return unhealthy status

- [ ] Task 6: Write unit tests (AC: 6)
  - [ ] Create `apps/api/test/common/database/database-error-handler.spec.ts`
  - [ ] Test classification of PrismaClientKnownRequestError (connection, constraint, timeout)
  - [ ] Test classification of PrismaClientInitializationError
  - [ ] Test that user-friendly messages are returned (no raw error details)
  - [ ] Test non-critical path: audit logging failure does not propagate
  - [ ] Test critical path: auth/chat errors return proper HTTP status codes

## Dev Notes

### Architecture Compliance

- Prisma has built-in connection pooling and automatic reconnection — the main work is ensuring errors are handled gracefully at every level
- The AllExceptionsFilter already catches all exceptions — enhance it to detect Prisma-specific error types
- Key principle: database issues should degrade gracefully, not cause cascading failures

### Existing Patterns to Follow

- `AllExceptionsFilter` — already catches unhandled exceptions; extend it for Prisma-specific errors
- `TracerService` — already has try/catch for non-blocking audit writes (verify, do not duplicate)
- `PrismaService` — injected globally, manages database connection lifecycle
- `/health/ready` endpoint (Story 12-4) — already checks database connectivity

### What This Story Does NOT Include

- Database failover or read replicas
- Query-level caching (Redis cache layer)
- Database migration rollback automation
- Admin alerting dashboard for database errors (covered by monitoring stories)

### Project Structure Notes

```
apps/api/src/common/database/
  database-error.handler.ts     # Prisma error classification and user-friendly mapping

apps/api/test/common/database/
  database-error-handler.spec.ts
```

### Testing Approach

- Unit tests for database error handler: mock Prisma error types, verify classification and response mapping
- Unit tests for AllExceptionsFilter: throw Prisma-specific errors, verify HTTP responses
- Verify non-critical paths by mocking database failures in TracerService and analytics service calls

### References

- `architecture.md` — NFR40-50 Reliability, graceful degradation patterns
- `apps/api/src/common/filters/` — AllExceptionsFilter location
- `apps/api/src/services/prisma/prisma.service.ts` — PrismaService
- Prisma error reference: PrismaClientKnownRequestError (P2000-P2034), PrismaClientInitializationError, PrismaClientRustPanicError

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
