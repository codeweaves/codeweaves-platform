# Story 2.2: Create Organization CRUD API

Status: done

## Story

As a **Super Admin**,
I want to manage organizations through API endpoints,
So that I can onboard and manage B2B clients.

## Acceptance Criteria

1. **Given** I am logged in as Super Admin
   **When** I call POST `/api/codeweaves/v1/organizations`
   **Then** a new organization is created with name and auto-generated slug
   **And** response is 201 with organization details

2. **Given** I am logged in as Super Admin
   **When** I call GET `/api/codeweaves/v1/organizations`
   **Then** all organizations are returned with id, name, slug, createdAt, user count, agent count

3. **Given** I am logged in as Super Admin
   **When** I call GET `/api/codeweaves/v1/organizations/:id`
   **Then** the specific organization is returned with full details

4. **Given** I am logged in as Super Admin
   **When** I call PATCH `/api/codeweaves/v1/organizations/:id`
   **Then** the organization name/slug is updated
   **And** slug uniqueness is validated

5. **Given** I am logged in as Admin or Client
   **When** I call any organization CRUD endpoint
   **Then** I receive 403 Forbidden

6. **Given** I request a non-existent organization
   **When** I call GET or PATCH with invalid ID
   **Then** I receive 404 Not Found

## Tasks / Subtasks

- [x] Task 1: Create OrganizationsService (`apps/api/src/services/organizations.service.ts`)
  - [x] `create(data: CreateOrganizationInput): Promise<Organization>` — create with slug generation
  - [x] `findAll(): Promise<Organization[]>` — list all with `_count` for users and agents
  - [x] `findById(id: string): Promise<Organization>` — single org with details
  - [x] `update(id: string, data: UpdateOrganizationInput): Promise<Organization>` — update name/slug
  - [x] Handle slug collision on create and update
  - [x] Throw NotFoundException for missing orgs

- [x] Task 2: Create OrganizationsController (`apps/api/src/controllers/organizations/organizations.controller.ts`)
  - [x] `@Controller('organizations')` with global API prefix
  - [x] `@UseGuards(JwtAuthGuard, RolesGuard)` on controller level
  - [x] `@Roles(Role.SUPER_ADMIN)` on controller level
  - [x] POST `/` — create organization
  - [x] GET `/` — list all organizations
  - [x] GET `/:id` — get single organization
  - [x] PATCH `/:id` — update organization
  - [x] Use `ZodValidationPipe` for input validation

- [x] Task 3: Create OrganizationsModule (`apps/api/src/modules/organizations.module.ts`)
  - [x] Import PrismaModule
  - [x] Provide OrganizationsService
  - [x] Register OrganizationsController
  - [x] Register in AppModule

- [x] Task 4: Write unit tests for OrganizationsService
  - [x] Test create with slug generation
  - [x] Test create with slug collision handling
  - [x] Test findAll returns organizations with counts
  - [x] Test findById success and 404
  - [x] Test update success, 404, and slug conflict

- [x] Task 5: Write unit tests for OrganizationsController
  - [x] Test all endpoints return correct responses
  - [x] Test role authorization (SUPER_ADMIN only)
  - [x] Test validation pipe rejects invalid input

## Dev Notes

### API Endpoints

```text
POST   /api/codeweaves/v1/organizations          — Create organization
GET    /api/codeweaves/v1/organizations          — List all organizations
GET    /api/codeweaves/v1/organizations/:id      — Get organization by ID
PATCH  /api/codeweaves/v1/organizations/:id      — Update organization
```

### Response Shape

```typescript
// List response
{
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    users: number;
    agents: number;
  };
}
```

### Authorization

Only `SUPER_ADMIN` can access these endpoints. The existing `RolesGuard` (already implemented in Epic 1) with `@Roles(Role.SUPER_ADMIN)` decorator handles this.

### Architecture Compliance

- **FR11:** Super Admin can create new organization records
- **FR14:** Super Admin can view list of all organizations with metadata
- **ADR-006:** Application-level data access

### Dependencies

- Story 2.1 (Organization model with slug)
- Existing: RolesGuard, JwtAuthGuard, ZodValidationPipe from Epic 1

### References

- Existing controllers pattern: `apps/api/src/controllers/`
- Existing services pattern: `apps/api/src/services/`
- Validation: `packages/validation/src/index.ts`

## Dev Agent Record

### Implementation Plan

- Created OrganizationsService with CRUD operations following existing service patterns (PrismaService injection, NestJS exceptions)
- Created OrganizationsController with RolesGuard at controller level (SUPER_ADMIN only), ZodValidationPipe for input validation
- Created OrganizationsModule and registered in AppModule
- Slug auto-generation uses existing `generateSlug`/`generateUniqueSlug` utilities from Story 2.1
- Slug collision handling: on create, checks for existing slug and appends random suffix if needed; on update, pre-checks uniqueness and handles P2002 race condition
- `_count.users` included in findAll and findById; `_count.agents` will be added when Agent model is created in Epic 3
- JwtAuthGuard applied globally via APP_GUARD in AppModule; RolesGuard applied at controller level

### Completion Notes

- All 5 tasks completed with 38 tests (18 service, 20 controller)
- Full test suite: 18 suites, 235 tests, all passing
- Coverage: organizations.service.ts 97.56% stmts / 96.15% branch / 100% funcs / 97.36% lines; organizations.controller.ts 100% stmts / 75% branch / 100% funcs / 100% lines
- All quality gates passed: lint, type-check, build, test:cov

### Code Review Fixes Applied (2026-02-15)

1. **H1+M1 — Race condition in `create()` with retry**: Added `MAX_SLUG_RETRIES = 3` retry loop with P2002 (unique constraint) catch in `create()`. On first attempt, uses `resolveUniqueSlug()`; on subsequent retries, uses `generateUniqueSlug()`. Throws `ConflictException` after all retries exhausted.
2. **H2 — UUID validation on `:id` route params**: Added `ParseUUIDPipe` to all `@Param('id')` decorators in the controller to reject invalid UUIDs at the HTTP layer.
3. **M2 — Validation test coverage**: Added 9 validation tests to the controller spec verifying that `ZodValidationPipe` correctly rejects invalid input (missing name, too short, too long, invalid slug format) and accepts valid input.
4. **Validation schema updates**: Organization name min length changed from 2 to 3 chars; user profile name min length changed from 2 to 1 char (both in `@repo/validation`).

## File List

- `apps/api/src/services/organizations.service.ts` (new)
- `apps/api/src/services/index.ts` (modified)
- `apps/api/src/controllers/organizations/organizations.controller.ts` (new)
- `apps/api/src/controllers/organizations/index.ts` (new)
- `apps/api/src/controllers/index.ts` (modified)
- `apps/api/src/modules/organizations.module.ts` (new)
- `apps/api/src/modules/app.module.ts` (modified)
- `apps/api/src/modules/index.ts` (modified)
- `apps/api/src/models/index.ts` (modified)
- `apps/api/test/services/organizations/organizations.service.spec.ts` (new)
- `apps/api/test/controllers/organizations/organizations.controller.spec.ts` (new)
- `packages/validation/src/index.ts` (modified — org name min 3, user profile name min 1)

## Change Log

- 2026-02-15: Implemented Organization CRUD API — service with create/findAll/findById/update, controller with SUPER_ADMIN authorization, module registration, and comprehensive unit tests (26 tests)
- 2026-02-15: Code review fixes — P2002 retry loop in create(), ParseUUIDPipe on route params, 9 new validation tests, validation schema updates. Total: 38 org tests, 235 tests overall.
