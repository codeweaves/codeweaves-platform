# Story 11.13: GDPR Data Deletion

Status: ready-for-dev

## Story

As a **user**,
I want to delete all my personal data,
So that I can exercise my GDPR right to erasure.

## Acceptance Criteria

1. **Given** an authenticated user **When** DELETE /api/codeweaves/v1/users/me is called **Then** account deletion is initiated with a 30-day grace period
2. **Given** deletion is requested **When** initiated **Then** user's isActive flag is set to false immediately (soft delete)
3. **Given** the grace period **When** the user logs in within 30 days **Then** they see a "Your account is scheduled for deletion" banner with a cancel option
4. **Given** cancellation **When** POST /api/codeweaves/v1/users/me/cancel-deletion is called **Then** isActive is restored to true and deletionScheduledAt is cleared
5. **Given** grace period expires (30 days) **When** a scheduled job runs **Then** all user data is permanently deleted: user record, chat messages (anonymized), audit logs (anonymized with userId=null), and Auth0 account
6. **Given** permanent deletion **When** complete **Then** an anonymized audit entry records "User data deleted" without PII
7. **Given** the user is the last admin of an organization **When** deletion is requested **Then** it is rejected with an error explaining they must transfer ownership first
8. **Given** tests exist **Then** unit tests cover soft delete, cancellation, permanent deletion logic, ownership check

## Tasks / Subtasks

- [ ] Task 1: Add deletionScheduledAt field to User model (AC: #1, #2)
  - [ ] Add `deletionScheduledAt DateTime?` field to User model in `apps/api/prisma/schema.prisma`
  - [ ] Run `bunx prisma migrate dev --name add-user-deletion-scheduled-at`
  - [ ] Run `bunx prisma generate` to regenerate client
  - [ ] Verify the field is available on the User type in PrismaClient
- [ ] Task 2: Implement GdprService — requestDeletion method (AC: #1, #2, #7)
  - [ ] Add `requestDeletion(userId: string)` to `apps/api/src/services/gdpr.service.ts`
  - [ ] Check if user is the last admin of any organization — query Organization for orgs where user is the only member with role=ADMIN
  - [ ] If last admin, throw BadRequestException with clear error message
  - [ ] Set `isActive = false` and `deletionScheduledAt = now + 30 days` on the User record
  - [ ] Log event via TracerService with event `GDPR_DELETION_REQUESTED`
- [ ] Task 3: Implement GdprService — cancelDeletion method (AC: #4)
  - [ ] Add `cancelDeletion(userId: string)` to GdprService
  - [ ] Verify user has a pending deletion (deletionScheduledAt is not null)
  - [ ] Set `isActive = true` and `deletionScheduledAt = null`
  - [ ] Log event via TracerService with event `GDPR_DELETION_CANCELLED`
- [ ] Task 4: Implement GdprService — executePermanentDeletion method (AC: #5, #6)
  - [ ] Add `executePermanentDeletion(userId: string)` to GdprService
  - [ ] Anonymize ChatMessages: set sender to "Deleted User" where sender matches the user
  - [ ] Anonymize AuditLog entries: set userId and auth0Id to null where userId matches
  - [ ] Delete User record from database
  - [ ] Call Auth0 Management API to delete the Auth0 user account
  - [ ] Create anonymized audit entry: `GDPR_DATA_DELETED` with no PII (only a note that data was purged)
- [ ] Task 5: Update GdprController — DELETE /users/me and POST /users/me/cancel-deletion (AC: #1, #4)
  - [ ] Add DELETE `/users/me` endpoint to `apps/api/src/modules/gdpr/gdpr.controller.ts`
  - [ ] Add POST `/users/me/cancel-deletion` endpoint
  - [ ] Both endpoints use `@CurrentUser()` decorator
  - [ ] DELETE returns 200 with `{ message, deletionScheduledAt }` response
  - [ ] POST cancel-deletion returns 200 with `{ message }` response
- [ ] Task 6: Create scheduled job for permanent deletion (AC: #5)
  - [ ] Create a cron job using NestJS `@Cron()` decorator (from `@nestjs/schedule`)
  - [ ] Schedule to run daily (e.g., `0 2 * * *` — 2 AM UTC)
  - [ ] Query users where `deletionScheduledAt < now` and `isActive = false`
  - [ ] Call `executePermanentDeletion()` for each qualifying user
  - [ ] Add ScheduleModule to GdprModule imports if not already registered
- [ ] Task 7: Create unit tests (AC: #8)
  - [ ] Create `apps/api/test/services/gdpr/gdpr-deletion.service.spec.ts`
  - [ ] Test requestDeletion: sets isActive=false and deletionScheduledAt
  - [ ] Test requestDeletion: rejects when user is last admin of an org
  - [ ] Test cancelDeletion: restores isActive=true and clears deletionScheduledAt
  - [ ] Test cancelDeletion: throws if no pending deletion
  - [ ] Test executePermanentDeletion: anonymizes chat messages
  - [ ] Test executePermanentDeletion: anonymizes audit log entries
  - [ ] Test executePermanentDeletion: deletes user record
  - [ ] Test executePermanentDeletion: calls Auth0 Management API to delete user
  - [ ] Test executePermanentDeletion: creates anonymized audit entry

## Dev Notes

### Architecture Compliance

- The 30-day grace period is standard GDPR practice and allows users to recover from accidental deletion requests.
- Soft delete (isActive=false) immediately prevents login but preserves data for the grace period.
- Permanent deletion runs as a daily cron job using NestJS @Cron() decorator from `@nestjs/schedule`.
- Auth0 user deletion uses the existing Auth0 Management API client.

### Existing Patterns to Follow

- Controller/Service separation in the existing GdprModule (created in story 11.12)
- TracerService usage for audit logging with SCREAMING_SNAKE_CASE event names
- Auth guards: `@UseGuards(JwtAuthGuard, UserSyncGuard)` on controller endpoints
- Prisma transaction usage for multi-table operations (wrap permanent deletion in `prisma.$transaction()`)
- Auth0 Management API client pattern from existing code (e.g., invitation flow)

### What This Story Does NOT Include

- Frontend deletion UI (banner, cancel button) — that would be a separate frontend story
- Email notification to user about pending deletion
- Admin-initiated deletion of other users
- Organization deletion (only user data is deleted)
- Backup/archive of deleted data

### Project Structure Notes

- Schema change: `apps/api/prisma/schema.prisma` — add `deletionScheduledAt` to User model
- Migration: `apps/api/prisma/migrations/<timestamp>_add_user_deletion_scheduled_at/`
- Service updates: `apps/api/src/services/gdpr.service.ts` (extends from story 11.12)
- Controller updates: `apps/api/src/modules/gdpr/gdpr.controller.ts` (extends from story 11.12)
- Tests: `apps/api/test/services/gdpr/gdpr-deletion.service.spec.ts`

### Chat Message Anonymization Strategy

Chat messages from the user should be anonymized (sender set to "Deleted User") rather than hard-deleted, to preserve conversation context for other participants and agents. This maintains chat history integrity while removing PII.

### Permanent Deletion Order

Execute in this order within a Prisma transaction:
1. Anonymize ChatMessages (set sender to "Deleted User")
2. Anonymize AuditLog entries (set userId and auth0Id to null)
3. Delete User record from database
4. Call Auth0 Management API to delete Auth0 account (outside transaction — external API)
5. Create anonymized audit entry recording the deletion

### Ownership Check Logic

```
SELECT COUNT(*) FROM users
WHERE organizationId = :orgId
AND role = 'ADMIN'
AND isActive = true
AND id != :userId
```

If count is 0 for any org the user admins, reject the deletion request.

### Testing Approach

- Unit tests with mocked PrismaService for all database operations
- Mock Auth0 Management API client for deletion calls
- Mock TracerService to verify audit log creation
- Test edge cases: last admin check, no pending deletion for cancel
- No frontend tests (per project convention)

### References

- architecture.md — NFR27: GDPR data deletion, right to erasure within 30 days
- NestJS Schedule documentation for @Cron() decorator
- Auth0 Management API — Delete User endpoint
- Story 11.12 (GDPR Data Export) — prerequisite, creates GdprModule

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
