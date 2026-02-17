# Story 11.7: Audit Logging Integration into Services

Status: done

## Story

As a **system**,
I want all state-changing operations (create, update, delete) automatically logged via entity logger services,
So that no important change goes unrecorded and every audit entry captures who did it, what changed, and the correlation ID.

## Acceptance Criteria

1. **Given** an organization is created **When** `OrganizationsService.create()` succeeds **Then** `ORGANIZATION_CREATED` audit event is written with response data
2. **Given** an organization creation fails **When** an exception is thrown **Then** `ORGANIZATION_CREATION_EXCEPTION` audit event is written with error details and request data
3. **Given** an invitation is created **When** `InvitationsService.create()` succeeds **Then** `INVITATION_CREATED` audit event is written
4. **Given** an invitation operation fails **When** an exception occurs **Then** the corresponding `*_EXCEPTION` event is written
5. **Given** a user syncs/creates from Auth0 **When** `UsersService.syncOrCreateUser()` runs **Then** `USER_FIRST_LOGIN` or `USER_CREATED_FROM_INVITATION` event is written
6. **Given** an Auth0 management API call is made **When** user is created/deleted in Auth0 **Then** `AUTH0_USER_CREATED` / `AUTH0_USER_DELETION_FAILED` etc. events are written
7. **Given** an email is sent via Resend **When** send succeeds or fails **Then** `EMAIL_SENT` / `EMAIL_SEND_FAILED` / `EMAIL_SEND_EXCEPTION` events are written
8. **Given** any audit event is written **When** checking the audit_logs table **Then** it contains the userId of the authenticated user who triggered the action (auto-populated via AsyncLocalStorage)
9. **Given** audit logging is non-blocking **When** the audit write fails **Then** the business operation still succeeds

## Tasks / Subtasks

- [x] Task 1: Integrate OrganizationLoggerService (AC: #1, #2, #8, #9)
  - [x] In `apps/api/src/services/organizations.service.ts`: inject `OrganizationLoggerService`
  - [x] In `create()`: call `logOrganizationCreated` on success, `logOrganizationCreationException` in catch
  - [x] In `update()` (if exists): call `logOrganizationUpdated` on success
  - [x] Import LoggerModule in OrganizationsModule
- [x] Task 2: Integrate InvitationLoggerService (AC: #3, #4, #8, #9)
  - [x] In `apps/api/src/services/invitations.service.ts`: inject `InvitationLoggerService`
  - [x] In `create()`: call `logInvitationCreated` / `logInvitationCreationException`
  - [x] In `resend()`: call `logInvitationResent` / `logInvitationResentException`
  - [x] In `cancel()`: call `logInvitationCancelled` / `logInvitationCancelledException`
  - [x] Import LoggerModule in InvitationsModule
- [x] Task 3: Integrate UserLoggerService (AC: #5, #8, #9)
  - [x] In `apps/api/src/services/users.service.ts`: inject `UserLoggerService`
  - [x] In `syncOrCreateUser()`: call `logUserFirstLogin` on existing user login, `logUserCreatedFromInvitation` on new user creation
  - [x] In `updateProfile()` (if exists): call `logUserProfileUpdated`
  - [x] Import LoggerModule in UsersModule
- [x] Task 4: Integrate Auth0LoggerService (AC: #6, #8, #9)
  - [x] In `apps/api/src/services/auth0-management.service.ts`: inject `Auth0LoggerService`
  - [x] In `createUser()`: call `logAuth0UserCreated` / `logAuth0UserCreationFailed`
  - [x] In `deleteUser()`: call `logAuth0UserDeleted` / `logAuth0UserDeletionFailed`
  - [x] In `createPasswordChangeTicket()`: call `logAuth0PasswordTicketCreated` / `logAuth0PasswordTicketFailed`
  - [x] Import LoggerModule in Auth0ManagementModule
- [x] Task 5: Integrate EmailLoggerService (AC: #7, #8, #9)
  - [x] In `apps/api/src/services/email.service.ts`: inject `EmailLoggerService`
  - [x] In `sendInvitationEmail()`: call `logEmailSent` on success, `logEmailFailed` on API error, `logEmailException` on exception
  - [x] Import LoggerModule in EmailModule
- [x] Task 6: Update existing unit tests (AC: #1-#9)
  - [x] Update `apps/api/test/services/organizations.service.spec.ts` — mock OrganizationLoggerService
  - [x] Update `apps/api/test/services/invitations.service.spec.ts` — mock InvitationLoggerService
  - [x] Update `apps/api/test/services/users.service.spec.ts` — mock UserLoggerService
  - [x] Update `apps/api/test/services/auth0-management.service.spec.ts` — mock Auth0LoggerService
  - [x] Update `apps/api/test/services/email.service.spec.ts` — mock EmailLoggerService
  - [x] Verify logger methods are called with correct event names and data

## Dev Notes

### Integration Pattern

For every service method that performs a state change, follow this pattern:

```typescript
// Example: organizations.service.ts
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgLogger: OrganizationLoggerService, // ADD THIS
  ) {}

  async create(dto: CreateOrganizationDto, userId: string) {
    try {
      const org = await this.prisma.organization.create({ data: { ... } });
      await this.orgLogger.logOrganizationCreated(org.id, { response: org, request: dto });
      return org;
    } catch (error) {
      await this.orgLogger.logOrganizationCreationException(
        dto.name ?? 'unknown',
        error,
        { request: dto },
      );
      throw error; // Re-throw — audit logging doesn't swallow errors
    }
  }
}
```

### Services to Modify (6 files)

| Service File | Logger to Inject | Module to Update |
|---|---|---|
| `services/organizations.service.ts` | OrganizationLoggerService | OrganizationsModule |
| `services/organization-members.service.ts` | UserLoggerService | OrganizationsModule |
| `services/users.service.ts` | UserLoggerService | UsersModule |
| `services/invitations.service.ts` | InvitationLoggerService | InvitationsModule |
| `services/email.service.ts` | EmailLoggerService | EmailModule |
| `services/auth0-management.service.ts` | Auth0LoggerService | Auth0ManagementModule |

### Module Import Pattern

Each feature module that uses a logger must import `LoggerModule`:

```typescript
// Example: organizations.module.ts
@Module({
  imports: [PrismaModule, LoggerModule], // ADD LoggerModule
  providers: [OrganizationsService, OrganizationMembersService],
  ...
})
```

Since TracerModule is `@Global()`, it doesn't need explicit import. But LoggerModule is NOT global — it must be imported in each feature module that uses entity loggers.

### CRITICAL: Await but Don't Block

All logger calls use `await` but are wrapped in the logger service's internal try/catch (from TracerService). This means:
- If DB is healthy: audit event is written before continuing
- If DB is down: error is caught internally, business operation continues
- The `await` ensures events are written in order but doesn't block on failure

### CRITICAL: Don't Break Existing Tests

When adding logger injection to services, ALL existing unit tests will need the logger mocked:

```typescript
// In test setup
const module = await Test.createTestingModule({
  providers: [
    OrganizationsService,
    { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
    { provide: OrganizationLoggerService, useValue: { // ADD THIS
      logOrganizationCreated: jest.fn(),
      logOrganizationCreationException: jest.fn(),
      logOrganizationUpdated: jest.fn(),
      logOrganizationUpdateException: jest.fn(),
    }},
  ],
}).compile();
```

### Existing Service Constructor Patterns

Current services inject `PrismaService` and sometimes `ConfigService`:
- `OrganizationsService(prisma: PrismaService)`
- `InvitationsService(prisma: PrismaService, emailService: EmailService, auth0Service: Auth0ManagementService, configService: ConfigService)`
- `UsersService(prisma: PrismaService)`
- `EmailService(configService: ConfigService)`
- `Auth0ManagementService(configService: ConfigService)`

Add the entity logger as the LAST constructor parameter to minimize diff noise.

### Dependencies

- **Depends on Story 11.6**: AuditLog Prisma model
- **Depends on Story 12.5**: AsyncLocalStorage with correlationId
- **Depends on Story 12.6**: TracerService, entity logger services, LoggerModule
- **Depends on Story 12.13**: LoggingInterceptor that enriches userId/auth0Id in context

**This story should be implemented LAST** in the sequence.

### References

- [Source: docs/plans/logger-tracer-plan.md#Phase 6]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 11.7]
- [Source: apps/api/src/services/*.ts - all service files]
- [Source: apps/api/src/modules/*.ts - all module files]
- [Source: apps/api/test/services/*.spec.ts - existing test patterns]
- [Source: /tracers/ - office reference for entity logger integration pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Jest `resetMocks: true` clears mock implementations between tests; must set `.mockImplementation()` inside `beforeEach`, not at declaration scope
- tenant-isolation.spec.ts also needed logger mocks (7th test file, easy to miss)

### Completion Notes List
- All 6 services wired with entity loggers (OrganizationLoggerService, InvitationLoggerService, UserLoggerService, Auth0LoggerService, EmailLoggerService)
- All 5 feature modules updated to import LoggerModule
- All 7 test files updated with mock logger providers (including tenant-isolation.spec.ts)
- organization-members.service.ts also integrated with UserLoggerService for member assign/remove operations
- 29 test suites, 401 tests all passing

### File List
- `apps/api/src/modules/organizations.module.ts` — added LoggerModule import
- `apps/api/src/modules/invitations.module.ts` — added LoggerModule import
- `apps/api/src/modules/users.module.ts` — added LoggerModule import
- `apps/api/src/modules/email.module.ts` — added LoggerModule import
- `apps/api/src/modules/auth0-management.module.ts` — added LoggerModule import
- `apps/api/src/services/organizations.service.ts` — injected OrganizationLoggerService
- `apps/api/src/services/organization-members.service.ts` — injected UserLoggerService
- `apps/api/src/services/invitations.service.ts` — injected InvitationLoggerService
- `apps/api/src/services/users.service.ts` — injected UserLoggerService
- `apps/api/src/services/email.service.ts` — injected EmailLoggerService
- `apps/api/src/services/auth0-management.service.ts` — injected Auth0LoggerService
- `apps/api/test/services/organizations/organizations.service.spec.ts` — mocked OrganizationLoggerService
- `apps/api/test/services/organization-members/organization-members.service.spec.ts` — mocked UserLoggerService
- `apps/api/test/services/invitations/invitations.service.spec.ts` — mocked InvitationLoggerService
- `apps/api/test/services/users/users.service.spec.ts` — mocked UserLoggerService
- `apps/api/test/services/email/email.service.spec.ts` — mocked EmailLoggerService
- `apps/api/test/services/auth0-management/auth0-management.service.spec.ts` — mocked Auth0LoggerService
- `apps/api/test/tenant-isolation/tenant-isolation.spec.ts` — mocked logger providers
