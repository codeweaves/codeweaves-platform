# Story 11.6: Audit Log Database Model

Status: done

## Story

As a **system**,
I want a comprehensive audit log table,
So that all state-changing operations are traceable with who performed them, what changed, and when.

## Acceptance Criteria

1. **Given** the need for audit trail **When** AuditLog table is created **Then** it stores: id, correlationId, userId, auth0Id, contextId, event, data, createdAt
2. **Given** audit data is JSON **When** storing event details **Then** `data` column uses JSONB with structure: `{ response, request, error, previous, updated }`
3. **Given** performance requirements **When** querying audit logs **Then** indexes exist on: event, contextId, userId, auth0Id, correlationId, createdAt
4. **Given** tenant isolation requirements **When** querying audit logs **Then** userId links back to the user who performed the action (internal DB UUID from `request.user.id`)
5. **Given** cross-reference needs **When** storing audit entries **Then** auth0Id is also stored (from `request.user.auth0Id`) for external identity correlation
6. **Given** the Prisma migration workflow **When** migration runs **Then** `audit_logs` table is created without errors and Prisma Client is regenerated

## Tasks / Subtasks

- [x] Task 1: Add AuditLog model to Prisma schema (AC: #1, #2, #3)
  - [x] Add model to `apps/api/prisma/schema.prisma` after existing models
  - [x] Define all fields: id (uuid), correlationId, userId, auth0Id, contextId, event, data (Json), createdAt
  - [x] Add 6 indexes: event, contextId, userId, auth0Id, correlationId, createdAt
  - [x] Map to table name `audit_logs` using `@@map`
- [x] Task 2: Run Prisma migration (AC: #6)
  - [x] Run `bunx prisma migrate dev --name add-audit-logs`
  - [x] Run `bunx prisma generate` to regenerate client
  - [x] Verify AuditLog type is available in PrismaClient
- [x] Task 3: Write unit test verifying model exists (AC: #6)
  - [x] Create `apps/api/test/prisma/audit-log-model.spec.ts`
  - [x] Test that PrismaClient has `auditLog` model accessor
  - [x] Test that create/findMany operations work against test DB (or mock)

## Dev Notes

### Prisma Schema — Exact Model

```prisma
model AuditLog {
  id            String   @id @default(uuid())
  correlationId String?
  userId        String?
  auth0Id       String?
  contextId     String
  event         String
  data          Json
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

### Key Design Decisions

- `userId` = Internal DB UUID from `users.id` table — WHO performed the action. Populated from `request.user.id` (set by UserSyncGuard after JWT auth)
- `auth0Id` = Auth0's `sub` claim from `request.user.auth0Id` — for cross-referencing with Auth0 dashboard
- `contextId` = Entity-specific ID (e.g., orgId for org events, invitationId for invitation events)
- `event` = SCREAMING_SNAKE_CASE string: `ORGANIZATION_CREATED`, `INVITATION_CREATED`, etc.
- `data` = Merged JSON following office @tracers/ pattern: `{ response: {...}, request: {...}, error: {...}, previous: {...}, updated: {...} }`
- No foreign key to User table — audit logs must survive user deletion (GDPR compliance)
- No `organizationId` column — can be derived from contextId or data payload when needed

### Project Structure Notes

- Schema file: `apps/api/prisma/schema.prisma` — append after existing models (User, Organization, UserInvitation)
- Migration output: `apps/api/prisma/migrations/<timestamp>_add_audit_logs/`
- Existing models use `@id @default(uuid())` pattern — follow same convention
- Existing models use `@@map("table_name")` for snake_case table names — follow same convention

### References

- [Source: docs/plans/logger-tracer-plan.md#Phase 1]
- [Source: _bmad-output/planning-artifacts/architecture.md#Section 10.1 - Database Schema]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 11.6]
- [Source: apps/api/prisma/schema.prisma - existing model patterns]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- AuditLog model added to Prisma schema with all 8 fields and 6 indexes
- Migration `20260217070505_add_audit_logs` applied successfully
- Prisma client regenerated — `auditLog` accessor available
- 3 unit tests passing

### File List
- `apps/api/prisma/schema.prisma` (MODIFIED)
- `apps/api/prisma/migrations/20260217070505_add_audit_logs/migration.sql` (CREATED)
- `apps/api/test/prisma/audit-log-model.spec.ts` (CREATED)
