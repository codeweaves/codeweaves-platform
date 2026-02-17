# Logger & Tracer Service Implementation Plan

## Context

The backend has almost no logging. Email failures are silently swallowed, important events (org creation, invite creation, user first login) leave no trace, there are no correlation IDs to trace requests, and no global exception filter. We need a structured audit logging system modeled after the `@tracers/` reference from the office project, where each entity gets a dedicated logger service that writes structured audit events to a database table.

**Key requirement:** Every audit log must capture **who** performed the action — the authenticated user's internal DB `id` (UUID from `users` table). This is extracted from `request.user.id` which is populated by the `UserSyncGuard` after JWT authentication. The `userId` flows automatically via `AsyncLocalStorage` so entity logger services don't need to pass it manually.

## Architecture Overview

```
apps/api/src/
  common/
    tracer/
      tracer.service.ts           # Core: writes audit events to DB, mergeJsonResponse()
      tracer.module.ts            # Global module exporting TracerService
      correlation.storage.ts      # AsyncLocalStorage for request context (correlationId, userId)
    logger/
      organization.logger.ts      # Entity logger: orgs
      invitation.logger.ts        # Entity logger: invitations
      user.logger.ts              # Entity logger: users
      auth0.logger.ts             # Entity logger: auth0 operations
      email.logger.ts             # Entity logger: email sends
      logger.module.ts            # Aggregates all entity logger modules
  middleware/
    correlation-id.middleware.ts   # Sets correlationId + userId in AsyncLocalStorage
  interceptors/
    logging.interceptor.ts        # Logs HTTP request/response with duration
  filters/
    all-exceptions.filter.ts      # Global catch-all exception filter
```

## Phase 1: Database — Prisma `AuditLog` model

**File:** `apps/api/prisma/schema.prisma`

Add model:
```prisma
model AuditLog {
  id            String   @id @default(uuid())
  correlationId String?
  userId        String?          // Internal DB user UUID (from request.user.id) — WHO did this action
  auth0Id       String?          // Auth0 sub claim (from request.user.auth0Id) — for cross-reference
  contextId     String           // entity-specific ID (orgId, invitationId, etc.)
  event         String           // SCREAMING_SNAKE_CASE: ORGANIZATION_CREATED, INVITATION_CREATED, etc.
  data          Json             // merged JSON: { response, request, error, previous, updated }
  createdAt     DateTime @default(now())

  @@index([event])
  @@index([contextId])
  @@index([userId])
  @@index([auth0Id])
  @@index([correlationId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

Run migration: `bunx prisma migrate dev --name add-audit-logs`

## Phase 2: Core Tracer Infrastructure (3 files)

### 2a. `apps/api/src/common/tracer/correlation.storage.ts`
- Export `AsyncLocalStorage<RequestContext>` singleton
- `RequestContext`: `{ correlationId: string; userId?: string; auth0Id?: string; method?: string; url?: string }`
- `userId` = internal DB UUID from `request.user.id` (set by `UserSyncGuard`)
- `auth0Id` = Auth0's `sub` claim from `request.user.auth0Id` (available immediately from JWT)

### 2b. `apps/api/src/common/tracer/tracer.service.ts`
Core service (equivalent to office `TracerService`):
- Inject `PrismaService`
- `logAuditEvent(contextId: string, event: string, data: Record<string, unknown>): Promise<void>`
  - Reads `correlationId`, `userId`, and `auth0Id` from `AsyncLocalStorage`
  - Writes to `AuditLog` table via Prisma (includes `userId` + `auth0Id` — so every audit record shows WHO did it)
  - Also logs to NestJS Logger for stdout visibility
  - Non-blocking: catch errors internally, never throw (audit failures must not break business logic)
- `mergeJsonResponse(...objects: Record<string, unknown>[]): Record<string, unknown>`
  - Deep-merges multiple objects (same pattern as office: `{ response }, { request }, { error }, { previous }, { updated }`)

### 2c. `apps/api/src/common/tracer/tracer.module.ts`
- `@Global()` module
- Imports `PrismaModule`
- Provides and exports `TracerService`

## Phase 3: Entity Logger Services (5 files + 1 module)

Each follows the office pattern: `@Injectable()`, injects `TracerService`, typed methods for success/failed/exception per operation.

### 3a. `apps/api/src/common/logger/organization.logger.ts`
Events:
- `logOrganizationCreated(data)` → `ORGANIZATION_CREATED`
- `logOrganizationCreationFailed(data)` → `ORGANIZATION_CREATION_FAILED`
- `logOrganizationCreationException(data)` → `ORGANIZATION_CREATION_EXCEPTION`
- `logOrganizationUpdated(data)` → `ORGANIZATION_UPDATED`
- `logOrganizationUpdateException(data)` → `ORGANIZATION_UPDATE_EXCEPTION`

### 3b. `apps/api/src/common/logger/invitation.logger.ts`
Events:
- `logInvitationCreated(data)` → `INVITATION_CREATED`
- `logInvitationCreationFailed(data)` → `INVITATION_CREATION_FAILED`
- `logInvitationCreationException(data)` → `INVITATION_CREATION_EXCEPTION`
- `logInvitationResent(data)` → `INVITATION_RESENT`
- `logInvitationResentException(data)` → `INVITATION_RESENT_EXCEPTION`
- `logInvitationCancelled(data)` → `INVITATION_CANCELLED`
- `logInvitationCancelledException(data)` → `INVITATION_CANCELLED_EXCEPTION`
- `logInvitationReissued(data)` → `INVITATION_REISSUED`
- `logInvitationReissuedException(data)` → `INVITATION_REISSUED_EXCEPTION`
- `logInvitationValidated(data)` → `INVITATION_VALIDATED`
- `logInvitationExpired(data)` → `INVITATION_EXPIRED`

### 3c. `apps/api/src/common/logger/user.logger.ts`
Events:
- `logUserCreatedFromAuth0(data)` → `USER_CREATED_FROM_AUTH0`
- `logUserCreatedFromInvitation(data)` → `USER_CREATED_FROM_INVITATION`
- `logUserCreationException(data)` → `USER_CREATION_EXCEPTION`
- `logUserProfileUpdated(data)` → `USER_PROFILE_UPDATED`
- `logUserProfileUpdateException(data)` → `USER_PROFILE_UPDATE_EXCEPTION`
- `logUserFirstLogin(data)` → `USER_FIRST_LOGIN`
- `logMemberAssigned(data)` → `MEMBER_ASSIGNED_TO_ORGANIZATION`
- `logMemberRemoved(data)` → `MEMBER_REMOVED_FROM_ORGANIZATION`

### 3d. `apps/api/src/common/logger/auth0.logger.ts`
Events:
- `logAuth0UserCreated(data)` → `AUTH0_USER_CREATED`
- `logAuth0UserCreationFailed(data)` → `AUTH0_USER_CREATION_FAILED`
- `logAuth0UserDeleted(data)` → `AUTH0_USER_DELETED`
- `logAuth0UserDeletionFailed(data)` → `AUTH0_USER_DELETION_FAILED`
- `logAuth0PasswordTicketCreated(data)` → `AUTH0_PASSWORD_TICKET_CREATED`
- `logAuth0PasswordTicketFailed(data)` → `AUTH0_PASSWORD_TICKET_FAILED`
- `logAuth0TokenRefreshed()` → `AUTH0_TOKEN_REFRESHED`

### 3e. `apps/api/src/common/logger/email.logger.ts`
Events:
- `logEmailSent(data)` → `EMAIL_SENT`
- `logEmailFailed(data)` → `EMAIL_SEND_FAILED`
- `logEmailException(data)` → `EMAIL_SEND_EXCEPTION`

### 3f. `apps/api/src/common/logger/logger.module.ts`
- Imports `TracerModule`
- Provides and exports all 5 entity logger services
- Each entity module imports this single aggregated module

## Phase 4: HTTP Infrastructure (3 files)

### 4a. `apps/api/src/middleware/correlation-id.middleware.ts`
- Read `x-correlation-id` header or generate UUID
- Store in `AsyncLocalStorage` via `requestContextStorage.run()`
- Set `x-correlation-id` on response header
- Log incoming request: `→ GET /api/codeweaves/v1/organizations`

### 4b. `apps/api/src/interceptors/logging.interceptor.ts`
- Record start time
- Enrich `requestContextStorage` with `userId` from `request.user.id` (internal DB UUID) and `auth0Id` from `request.user.auth0Id`
  - These are populated by `UserSyncGuard` which runs before interceptors
  - For unauthenticated routes, both will be `undefined` — the audit log still captures the correlationId
- On response: log `← GET /api/codeweaves/v1/organizations 200 45ms`

### 4c. `apps/api/src/filters/all-exceptions.filter.ts`
- Catch all unhandled exceptions
- Log with correlationId, userId, method, url, statusCode, stack (for 5xx only)
- Return `{ statusCode, message, correlationId, timestamp }` in response body

## Phase 5: Wire Together (2 files modified)

### 5a. `apps/api/src/modules/app.module.ts`
- Import `TracerModule` and `LoggerModule`
- Implement `NestModule` → apply `CorrelationIdMiddleware` for all routes
- Register `LoggingInterceptor` as `APP_INTERCEPTOR`
- Register `AllExceptionsFilter` as `APP_FILTER`

### 5b. `apps/api/src/main.ts`
- Add `bufferLogs: true` to `NestFactory.create()`
- Replace `console.log` startup messages with NestJS `Logger`

## Phase 6: Integrate Loggers into Services (6 files modified)

### 6a. `apps/api/src/services/organizations.service.ts`
- Inject `OrganizationLoggerService`
- `create()`: call `logOrganizationCreated` on success, `logOrganizationCreationException` in catch
- `update()`: call `logOrganizationUpdated` on success, exception in catch

### 6b. `apps/api/src/services/organization-members.service.ts`
- Inject `UserLoggerService`
- `assignMember()`: call `logMemberAssigned`
- `removeMember()`: call `logMemberRemoved`

### 6c. `apps/api/src/services/users.service.ts`
- Inject `UserLoggerService`
- `createFromAuth0()`: call `logUserCreatedFromAuth0`
- `syncOrCreateUser()`: call `logUserFirstLogin` on first login
- `createFromInvitation()`: call `logUserCreatedFromInvitation`
- `updateProfile()`: call `logUserProfileUpdated`

### 6d. `apps/api/src/services/invitations.service.ts`
- Inject `InvitationLoggerService`
- `create()`: call `logInvitationCreated` / `logInvitationCreationException`
- `resend()`: call `logInvitationResent`
- `cancel()`: call `logInvitationCancelled`
- `reissue()`: call `logInvitationReissued`
- `validate()`: call `logInvitationValidated` / `logInvitationExpired`

### 6e. `apps/api/src/services/email.service.ts`
- Inject `EmailLoggerService`
- `send()`: call `logEmailSent` on success, `logEmailFailed` on API error, `logEmailException` on exception

### 6f. `apps/api/src/services/auth0-management.service.ts`
- Inject `Auth0LoggerService`
- `createUser()`: call `logAuth0UserCreated` / `logAuth0UserCreationFailed`
- `deleteUser()`: call `logAuth0UserDeleted` / `logAuth0UserDeletionFailed`
- `createPasswordChangeTicket()`: call `logAuth0PasswordTicketCreated` / `logAuth0PasswordTicketFailed`
- `getManagementToken()`: call `logAuth0TokenRefreshed`

## Phase 7: Unit Tests (4 new test files)

- `apps/api/test/common/tracer/tracer.service.spec.ts` — test audit event writing, mergeJsonResponse, error resilience
- `apps/api/test/middleware/correlation-id.middleware.spec.ts` — test UUID generation, header propagation
- `apps/api/test/interceptors/logging.interceptor.spec.ts` — test duration logging, userId enrichment
- `apps/api/test/filters/all-exceptions.filter.spec.ts` — test HTTP exception passthrough, 500 fallback, correlationId in response

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `prisma/schema.prisma` | Add `AuditLog` model |
| CREATE | `src/common/tracer/correlation.storage.ts` | AsyncLocalStorage singleton |
| CREATE | `src/common/tracer/tracer.service.ts` | Core: writes to audit_logs table |
| CREATE | `src/common/tracer/tracer.module.ts` | Global module |
| CREATE | `src/common/logger/organization.logger.ts` | Org entity logger |
| CREATE | `src/common/logger/invitation.logger.ts` | Invitation entity logger |
| CREATE | `src/common/logger/user.logger.ts` | User entity logger |
| CREATE | `src/common/logger/auth0.logger.ts` | Auth0 entity logger |
| CREATE | `src/common/logger/email.logger.ts` | Email entity logger |
| CREATE | `src/common/logger/logger.module.ts` | Aggregates all entity loggers |
| CREATE | `src/middleware/correlation-id.middleware.ts` | Correlation ID middleware |
| CREATE | `src/interceptors/logging.interceptor.ts` | HTTP response logging |
| CREATE | `src/filters/all-exceptions.filter.ts` | Global exception filter |
| MODIFY | `src/modules/app.module.ts` | Wire middleware/interceptor/filter |
| MODIFY | `src/main.ts` | Buffer logs, replace console.log |
| MODIFY | `src/services/organizations.service.ts` | Add logger calls |
| MODIFY | `src/services/organization-members.service.ts` | Add logger calls |
| MODIFY | `src/services/users.service.ts` | Add logger calls |
| MODIFY | `src/services/invitations.service.ts` | Add logger calls |
| MODIFY | `src/services/email.service.ts` | Add logger calls |
| MODIFY | `src/services/auth0-management.service.ts` | Add logger calls |
| CREATE | `test/common/tracer/tracer.service.spec.ts` | Tests |
| CREATE | `test/middleware/correlation-id.middleware.spec.ts` | Tests |
| CREATE | `test/interceptors/logging.interceptor.spec.ts` | Tests |
| CREATE | `test/filters/all-exceptions.filter.spec.ts` | Tests |

**Total: 14 new files, 8 modified files, 0 new dependencies**

## Verification

1. Run `bunx prisma migrate dev --name add-audit-logs`
2. Run `bun run check-types` — all packages pass
3. Run `bun run test` — all existing + new tests pass
4. Start backend, send an invitation from the UI
5. Check `audit_logs` table — should see `INVITATION_CREATED`, `AUTH0_USER_CREATED`, `EMAIL_SENT` events
6. Check response headers — `x-correlation-id` present
7. All events for that invitation share the same `correlationId`
