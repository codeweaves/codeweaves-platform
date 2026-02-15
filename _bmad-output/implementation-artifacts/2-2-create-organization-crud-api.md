# Story 2.2: Create Organization CRUD API

Status: backlog

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

- [ ] Task 1: Create OrganizationsService (`apps/api/src/services/organizations.service.ts`)
  - [ ] `create(data: CreateOrganizationInput): Promise<Organization>` — create with slug generation
  - [ ] `findAll(): Promise<Organization[]>` — list all with `_count` for users and agents
  - [ ] `findById(id: string): Promise<Organization>` — single org with details
  - [ ] `update(id: string, data: UpdateOrganizationInput): Promise<Organization>` — update name/slug
  - [ ] Handle slug collision on create and update
  - [ ] Throw NotFoundException for missing orgs

- [ ] Task 2: Create OrganizationsController (`apps/api/src/controllers/organizations/organizations.controller.ts`)
  - [ ] `@Controller('organizations')` with global API prefix
  - [ ] `@UseGuards(JwtAuthGuard, RolesGuard)` on controller level
  - [ ] `@Roles(Role.SUPER_ADMIN)` on controller level
  - [ ] POST `/` — create organization
  - [ ] GET `/` — list all organizations
  - [ ] GET `/:id` — get single organization
  - [ ] PATCH `/:id` — update organization
  - [ ] Use `ZodValidationPipe` for input validation

- [ ] Task 3: Create OrganizationsModule (`apps/api/src/modules/organizations.module.ts`)
  - [ ] Import PrismaModule
  - [ ] Provide OrganizationsService
  - [ ] Register OrganizationsController
  - [ ] Register in AppModule

- [ ] Task 4: Write unit tests for OrganizationsService
  - [ ] Test create with slug generation
  - [ ] Test create with slug collision handling
  - [ ] Test findAll returns organizations with counts
  - [ ] Test findById success and 404
  - [ ] Test update success, 404, and slug conflict

- [ ] Task 5: Write unit tests for OrganizationsController
  - [ ] Test all endpoints return correct responses
  - [ ] Test role authorization (SUPER_ADMIN only)
  - [ ] Test validation pipe rejects invalid input

## Dev Notes

### API Endpoints

```
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
