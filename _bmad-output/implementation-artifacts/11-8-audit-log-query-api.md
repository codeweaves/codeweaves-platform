# Story 11.8: Audit Log Query API

Status: ready-for-dev

## Story

As an **admin**, I want to query audit logs via API, so that I can investigate changes and incidents programmatically.

## Acceptance Criteria

1. **Given** admin privileges (ADMIN or SUPER_ADMIN), **When** GET `/api/codeweaves/v1/audit-logs` is called, **Then** paginated audit log entries are returned.
2. **Given** query parameters, **When** filtering by `userId`, `event`, `contextId`, `dateFrom`, `dateTo`, **Then** only matching entries are returned.
3. **Given** pagination params (`page`, `pageSize`), **When** querying, **Then** results are paginated with default 50 per page and max 100.
4. **Given** results, **When** returned, **Then** they are sorted by `createdAt` descending (newest first).
5. **Given** a CLIENT user, **When** querying, **Then** only audit logs where `contextId` matches their `organizationId` are visible (tenant isolation).
6. **Given** a SUPER_ADMIN, **When** querying with optional `contextId` filter, **Then** they can view any org's logs or all logs.
7. **Given** GET `/api/codeweaves/v1/audit-logs/:id`, **When** called, **Then** full audit log detail is returned including the `data` JSON blob.
8. **Given** tests exist, **Then** unit tests cover filtering, pagination, tenant isolation, and role-based access.

## Tasks / Subtasks

- [ ] Task 1: Create Zod validation schema for audit log query params in `packages/validation/src/audit-logs.ts` (AC: #2, #3)
  - [ ] Define `auditLogQuerySchema` with: `page` (default 1), `pageSize` (default 50, max 100), `userId` (optional uuid), `event` (optional string), `contextId` (optional string), `dateFrom` (optional coerced date), `dateTo` (optional coerced date), `search` (optional string)
  - [ ] Export schema and inferred type from `packages/validation/src/index.ts`
  - [ ] Create re-export DTO at `apps/api/src/models/audit-logs.dto.ts`
- [ ] Task 2: Create `apps/api/src/services/audit-logs.service.ts` (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] Inject `PrismaService`
  - [ ] Implement `findAll(query, user: CurrentUserData)` — build Prisma `where` clause with filters, enforce tenant isolation for CLIENT users via `contextId = user.organizationId`, use `skip/take` for pagination, order by `createdAt desc`
  - [ ] Implement `findOne(id: string, user: CurrentUserData)` — fetch single record, enforce tenant isolation for CLIENT users, return full `data` JSON
  - [ ] Return `{ data: AuditLog[], meta: { page, pageSize, total, totalPages } }` from `findAll`
- [ ] Task 3: Create `apps/api/src/modules/audit-logs.module.ts` (AC: #1)
  - [ ] Import `PrismaModule`
  - [ ] Register `AuditLogsService` as provider
  - [ ] Register `AuditLogsController` as controller
  - [ ] Export `AuditLogsService`
- [ ] Task 4: Create `apps/api/src/controllers/audit-logs/audit-logs.controller.ts` (AC: #1, #7)
  - [ ] Define `@Controller('audit-logs')` with `@ApiTags('Audit Logs')` and `@ApiBearerAuth()`
  - [ ] Apply `@UseGuards(RolesGuard)` and `@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)` at class level
  - [ ] GET `/` (list) — use `@Query(new ZodValidationPipe(auditLogQuerySchema))` and `@CurrentUser()`
  - [ ] GET `/:id` (detail) — use `@Param('id')` and `@CurrentUser()`
  - [ ] Add Swagger `@ApiQuery` decorators for all query params and `@ApiResponse` decorators
- [ ] Task 5: Register `AuditLogsModule` in `apps/api/src/modules/app.module.ts` (AC: #1)
- [ ] Task 6: Create `apps/api/test/controllers/audit-logs/audit-logs.controller.spec.ts` (AC: #8)
  - [ ] Test controller is defined
  - [ ] Test role metadata on controller class
  - [ ] Test `findAll` delegates to service with correct params
  - [ ] Test `findOne` delegates to service with correct params
  - [ ] Test Zod validation: missing params, invalid UUIDs, pagination defaults, date coercion
- [ ] Task 7: Create `apps/api/test/services/audit-logs/audit-logs.service.spec.ts` (AC: #8)
  - [ ] Test `findAll` builds correct Prisma where clause for each filter
  - [ ] Test pagination: correct skip/take calculation, default pageSize 50
  - [ ] Test tenant isolation: CLIENT user auto-filtered by `contextId = organizationId`
  - [ ] Test SUPER_ADMIN can query all or filter by `contextId`
  - [ ] Test `findOne` returns full record with data JSON
  - [ ] Test `findOne` enforces tenant isolation for CLIENT
  - [ ] Test `findOne` throws NotFoundException for missing records

## Dev Notes

### Architecture Compliance

- Follows the same controller/service/module split used by `AnalyticsModule`
- Uses `ZodValidationPipe` with schemas from `@repo/validation` (same pattern as `analyticsQuerySchema`)
- Uses `@CurrentUser()` decorator to get authenticated user data
- Uses `@Roles()` + `RolesGuard` for authorization (same pattern as `AnalyticsController`)
- All authenticated roles can access; CLIENT is auto-filtered by organization

### Existing Patterns to Follow

- **Module pattern**: `apps/api/src/modules/analytics.module.ts` — PrismaModule import, single service + controller
- **Controller pattern**: `apps/api/src/controllers/analytics/analytics.controller.ts` — Swagger decorators, ZodValidationPipe on Query, CurrentUser decorator
- **Service pattern**: `apps/api/src/services/analytics.service.ts` — PrismaService injection, tenant isolation via role check on `user.role === Role.CLIENT`
- **Validation pattern**: `packages/validation/src/analytics.ts` — Zod schemas with `z.coerce` for query params, exported types
- **DTO re-export pattern**: `apps/api/src/models/analytics.dto.ts` — re-exports from `@repo/validation`
- **Test pattern**: `apps/api/test/controllers/analytics/analytics.controller.spec.ts` — mock service, override RolesGuard, test delegation + validation

### AuditLog Prisma Model (from Story 11-6)

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

### Key Column Mapping

The AuditLog model uses different column names than what was originally specified in the epic description. Map accordingly:
- `action` in AC maps to `event` column (SCREAMING_SNAKE_CASE strings like `ORGANIZATION_CREATED`)
- `resource` / `resourceId` in AC maps to `contextId` column (stores orgId, invitationId, etc.)
- `organizationId` is not a separate column — tenant isolation uses `contextId` (which stores orgId for org-scoped events)
- `beforeData` / `afterData` are stored inside the `data` JSON blob as `data.previous` and `data.updated`
- `ipAddress` / `userAgent` are not columns on the model — they may be inside `data` JSON if captured by the interceptor

### Tenant Isolation Logic

```typescript
// In service.findAll()
const where: Prisma.AuditLogWhereInput = {};

// CLIENT users: auto-filter to their org
if (user.role === Role.CLIENT) {
  if (!user.organizationId) throw new ForbiddenException('...');
  where.contextId = user.organizationId;
}

// SUPER_ADMIN/ADMIN: optional contextId filter
if (user.role !== Role.CLIENT && query.contextId) {
  where.contextId = query.contextId;
}

// ADMIN: auto-filter to their org (same as CLIENT)
if (user.role === Role.ADMIN && user.organizationId) {
  where.contextId = user.organizationId;
}
```

### What This Story Does NOT Include

- Write operations (audit log creation is handled by TracerService from Story 11-7)
- Frontend dashboard view (that is Story 11-9)
- Export/download functionality (that is part of Story 11-9)
- Any schema migration (AuditLog model already exists from Story 11-6)

### Project Structure Notes

- Controller: `apps/api/src/controllers/audit-logs/audit-logs.controller.ts`
- Service: `apps/api/src/services/audit-logs.service.ts`
- Module: `apps/api/src/modules/audit-logs.module.ts`
- DTO: `apps/api/src/models/audit-logs.dto.ts`
- Validation: `packages/validation/src/audit-logs.ts`
- Controller test: `apps/api/test/controllers/audit-logs/audit-logs.controller.spec.ts`
- Service test: `apps/api/test/services/audit-logs/audit-logs.service.spec.ts`
- AppModule: `apps/api/src/modules/app.module.ts` (add AuditLogsModule to imports)

### Testing Approach

- **Controller tests**: Mock `AuditLogsService`, override `RolesGuard`, test delegation and Zod validation pipe
- **Service tests**: Mock `PrismaService` with `mockDeep<PrismaClient>()`, test Prisma query construction, pagination math, tenant isolation
- Follow existing test patterns from `apps/api/test/controllers/analytics/analytics.controller.spec.ts` and `apps/api/test/services/analytics/analytics.service.spec.ts`
- NO frontend tests (per project rules)

### References

- FR126-FR128: Role-based audit log access
- FR129: Timestamp and persistence
- `apps/api/src/controllers/analytics/analytics.controller.ts` — controller pattern reference
- `apps/api/src/services/analytics.service.ts` — service pattern reference (tenant isolation)
- `packages/validation/src/analytics.ts` — Zod schema pattern reference
- `apps/api/src/modules/analytics.module.ts` — module pattern reference
- `apps/api/src/decorators/current-user.decorator.ts` — CurrentUserData interface
- `_bmad-output/implementation-artifacts/11-6-audit-log-database-model.md` — AuditLog model details
- `_bmad-output/implementation-artifacts/11-7-audit-logging-interceptor.md` — TracerService writes

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
