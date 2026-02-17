# Story 12.6: Structured Logging (TracerService)

Status: done

## Story

As a **developer**,
I want a core TracerService that writes structured audit events to the database and stdout,
So that all important operations are logged with correlation IDs, user context, and structured data.

## Acceptance Criteria

1. **Given** an audit event occurs **When** `logAuditEvent()` is called **Then** a record is written to the `audit_logs` table with correlationId, userId, auth0Id, contextId, event, and data
2. **Given** AsyncLocalStorage has request context **When** `logAuditEvent()` is called **Then** correlationId, userId, and auth0Id are automatically read from the store (no manual passing)
3. **Given** the audit write fails **When** database is unavailable **Then** error is caught internally and logged to NestJS Logger — business logic is NEVER interrupted
4. **Given** multiple data objects **When** `mergeJsonResponse()` is called **Then** they are shallow-merged into a single object following the pattern: `{ response: {...}, request: {...}, error: {...}, previous: {...}, updated: {...} }`
5. **Given** the TracerModule is global **When** any service in the app needs it **Then** TracerService is injectable without importing TracerModule in every feature module
6. **Given** an audit event is written **When** checking stdout **Then** the event is also logged via NestJS Logger with correlationId for console visibility
7. **Given** 5 entity logger services are needed **When** implementing them **Then** each follows the office @tracers/ pattern: `@Injectable()`, injects `TracerService`, has typed methods per operation (success/failed/exception)

## Tasks / Subtasks

- [x] Task 1: Create TracerService core (AC: #1, #2, #3, #4, #6)
  - [x] Create `apps/api/src/common/tracer/tracer.service.ts`
  - [x] Inject `PrismaService`
  - [x] Implement `logAuditEvent(contextId: string, event: string, data: Record<string, unknown>): Promise<void>`
  - [x] Read correlationId/userId/auth0Id from `getRequestContext()`
  - [x] Write to `prisma.auditLog.create()` — wrap in try/catch, never throw
  - [x] Also log to NestJS Logger for stdout
  - [x] Implement `mergeJsonResponse(...objects: Record<string, unknown>[]): Record<string, unknown>`
- [x] Task 2: Create TracerModule (AC: #5)
  - [x] Update `apps/api/src/common/tracer/tracer.module.ts` (created in 12.5 as empty shell)
  - [x] Mark as `@Global()`
  - [x] Import PrismaModule, provide and export TracerService
- [x] Task 3: Create entity logger services (AC: #7)
  - [x] Create `apps/api/src/common/logger/organization.logger.ts` — events: ORGANIZATION_CREATED, ORGANIZATION_CREATION_FAILED, ORGANIZATION_CREATION_EXCEPTION, ORGANIZATION_UPDATED, ORGANIZATION_UPDATE_EXCEPTION
  - [x] Create `apps/api/src/common/logger/invitation.logger.ts` — events: INVITATION_CREATED, INVITATION_CREATION_FAILED, INVITATION_CREATION_EXCEPTION, INVITATION_RESENT, INVITATION_RESENT_EXCEPTION, INVITATION_CANCELLED, INVITATION_CANCELLED_EXCEPTION
  - [x] Create `apps/api/src/common/logger/user.logger.ts` — events: USER_CREATED_FROM_AUTH0, USER_CREATED_FROM_INVITATION, USER_CREATION_EXCEPTION, USER_PROFILE_UPDATED, USER_FIRST_LOGIN, MEMBER_ASSIGNED_TO_ORGANIZATION, MEMBER_REMOVED_FROM_ORGANIZATION
  - [x] Create `apps/api/src/common/logger/auth0.logger.ts` — events: AUTH0_USER_CREATED, AUTH0_USER_CREATION_FAILED, AUTH0_USER_DELETED, AUTH0_USER_DELETION_FAILED, AUTH0_PASSWORD_TICKET_CREATED, AUTH0_PASSWORD_TICKET_FAILED
  - [x] Create `apps/api/src/common/logger/email.logger.ts` — events: EMAIL_SENT, EMAIL_SEND_FAILED, EMAIL_SEND_EXCEPTION
- [x] Task 4: Create LoggerModule (AC: #7)
  - [x] Create `apps/api/src/common/logger/logger.module.ts`
  - [x] Import TracerModule
  - [x] Provide and export all 5 entity logger services
  - [x] Import LoggerModule in AppModule
- [x] Task 5: Write unit tests (AC: #1, #2, #3, #4)
  - [x] Create `apps/api/test/common/tracer/tracer.service.spec.ts`
  - [x] Test: writes audit event to database with correct fields
  - [x] Test: reads correlationId/userId from AsyncLocalStorage
  - [x] Test: catches database errors without throwing
  - [x] Test: mergeJsonResponse merges objects correctly
  - [x] Test: entity logger services call tracerService.logAuditEvent with correct event names

## Dev Notes

### TracerService Pattern

```typescript
// apps/api/src/common/tracer/tracer.service.ts
@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logAuditEvent(contextId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const context = getRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          correlationId: context?.correlationId,
          userId: context?.userId,
          auth0Id: context?.auth0Id,
          contextId,
          event,
          data,
        },
      });
      this.logger.log(`[${context?.correlationId?.slice(0, 8) ?? 'no-ctx'}] ${event} → ${contextId}`);
    } catch (error) {
      this.logger.error(`Failed to write audit event ${event}: ${error}`);
    }
  }

  mergeJsonResponse(...objects: Record<string, unknown>[]): Record<string, unknown> {
    return Object.assign({}, ...objects);
  }
}
```

### Entity Logger Pattern (from office @tracers/)

```typescript
// Example: apps/api/src/common/logger/organization.logger.ts
@Injectable()
export class OrganizationLoggerService {
  constructor(private readonly tracer: TracerService) {}

  async logOrganizationCreated(orgId: string, data: Record<string, unknown>) {
    await this.tracer.logAuditEvent(orgId, 'ORGANIZATION_CREATED',
      this.tracer.mergeJsonResponse({ response: data }));
  }

  async logOrganizationCreationException(orgId: string, error: unknown, request: Record<string, unknown>) {
    await this.tracer.logAuditEvent(orgId, 'ORGANIZATION_CREATION_EXCEPTION',
      this.tracer.mergeJsonResponse({ error: { message: String(error) } }, { request }));
  }
}
```

### Existing Codebase Patterns

- PrismaService is at `apps/api/src/modules/prisma.module.ts` — PrismaModule imports it
- All modules use `@Module({ imports: [PrismaModule], ... })` pattern
- No existing `common/` directory — creating `apps/api/src/common/tracer/` and `apps/api/src/common/logger/`
- Tests follow Jest pattern with `Test.createTestingModule()` and `mockDeep<PrismaClient>()`

### CRITICAL: Non-Blocking Audit Writes

Audit logging MUST NEVER block or crash business logic. Every `logAuditEvent` call wraps the DB write in try/catch. If the audit_logs table is down, the operation still succeeds — only the audit record is lost (logged to stderr instead).

### Dependencies

- **Depends on Story 11.6**: AuditLog Prisma model must exist first
- **Depends on Story 12.5**: `getRequestContext()` and `requestContextStorage` must exist first

### Project Structure Notes

- New files: `apps/api/src/common/tracer/tracer.service.ts`, `apps/api/src/common/logger/*.ts`
- Test files: `apps/api/test/common/tracer/tracer.service.spec.ts`
- LoggerModule imported in AppModule alongside TracerModule

### References

- [Source: docs/plans/logger-tracer-plan.md#Phase 2b, Phase 3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Section 17.2]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.6]
- [Source: /tracers/ - office reference pattern for entity loggers]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- TracerService: logAuditEvent writes to DB with correlationId/userId/auth0Id from AsyncLocalStorage, try/catch error resilience, NestJS Logger stdout
- TracerModule updated from empty shell → provides/exports TracerService, @Global
- 5 entity loggers: Organization (5 events), Invitation (11 events), User (8 events), Auth0 (7 events), Email (3 events)
- LoggerModule aggregates all 5 entity loggers
- 17 unit tests passing (7 TracerService + 10 entity logger representative tests)

### File List
- `apps/api/src/common/tracer/tracer.service.ts` (CREATED)
- `apps/api/src/common/tracer/tracer.module.ts` (MODIFIED)
- `apps/api/src/common/logger/organization.logger.ts` (CREATED)
- `apps/api/src/common/logger/invitation.logger.ts` (CREATED)
- `apps/api/src/common/logger/user.logger.ts` (CREATED)
- `apps/api/src/common/logger/auth0.logger.ts` (CREATED)
- `apps/api/src/common/logger/email.logger.ts` (CREATED)
- `apps/api/src/common/logger/logger.module.ts` (CREATED)
- `apps/api/test/common/tracer/tracer.service.spec.ts` (CREATED)
