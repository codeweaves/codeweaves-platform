# Story 2.3: Implement Tenant Isolation Filter

Status: review

## Story

As a **system**,
I want all data queries filtered by organizationId,
So that tenants cannot access each other's data.

## Acceptance Criteria

1. **Given** ADR-006 specifies application-level filtering
   **When** any service method queries tenant-scoped data
   **Then** organizationId filter is applied based on the requesting user's role

2. **Given** a Client user makes a request
   **When** querying any tenant-scoped resource
   **Then** only their organization's data is returned
   **And** attempting to access another org's data returns 404

3. **Given** a Super Admin makes a request
   **When** querying tenant-scoped resources
   **Then** data from all organizations is returned (no org filter)

4. **Given** an Admin user makes a request
   **When** querying tenant-scoped resources
   **Then** data from all organizations is returned (read access across orgs)

5. **Given** a service method
   **When** it does NOT apply organizationId filtering for tenant-scoped data
   **Then** it is flagged during code review as a security issue

## Tasks / Subtasks

- [x] Task 1: Create TenantContext utility (`apps/api/src/utils/tenant-filter.ts`)
  - [x] `buildTenantFilter(user: TenantFilterUser): TenantFilter` — returns filter based on role
  - [x] CLIENT role: returns `{ organizationId: user.organizationId, deletedAt: null }`
  - [x] ADMIN role: returns `{ deletedAt: null }` (no org filter, sees all)
  - [x] SUPER_ADMIN role: returns `{ deletedAt: null }` (no org filter, sees all)
  - [x] Throws ForbiddenException if CLIENT user has no organizationId
  - [x] All filters include `deletedAt: null` to exclude soft-deleted records

- [x] Task 2: Add tenant-filtered service method and harden existing queries
  - [x] Added `UsersService.findAllForTenant(user)` using buildTenantFilter pattern
  - [x] Updated `UsersService.findByOrganization()` to exclude soft-deleted users (`deletedAt: null`)
  - [x] Updated `UsersService.findByAuth0Id()` to exclude soft-deleted users (findFirst with `deletedAt: null`)
  - [x] Updated `UsersService.syncOrCreateUser()` to reject soft-deleted users with UnauthorizedException
  - [x] Added `deletedAt DateTime?` field to User model with migration

- [x] Task 3: Create TenantGuard (`apps/api/src/guards/tenant.guard.ts`)
  - [x] Validates that CLIENT users have a valid organizationId on their JWT
  - [x] Returns 403 if CLIENT user has no organizationId
  - [x] ADMIN and SUPER_ADMIN pass through
  - Note: TenantGuard is created as a reusable pattern; not yet applied to controllers (will be applied as tenant-scoped resources are built in future stories)

- [x] Task 4: Document tenant isolation pattern
  - [x] JSDoc comments on buildTenantFilter and TenantGuard explain the pattern
  - [x] Dev Notes below show the required usage pattern

- [x] Task 5: Write unit tests
  - [x] Test buildTenantFilter returns correct filter for each role (8 tests)
  - [x] Test CLIENT user gets org filter + deletedAt applied
  - [x] Test ADMIN user gets deletedAt-only filter
  - [x] Test SUPER_ADMIN user gets deletedAt-only filter
  - [x] Test CLIENT user without organizationId throws ForbiddenException
  - [x] Test TenantGuard allows/denies correctly (8 tests)
  - [x] Test findAllForTenant service method (4 tests)
  - [x] Test findByAuth0Id excludes soft-deleted users
  - [x] Test findByOrganization excludes soft-deleted users
  - [x] Test syncOrCreateUser rejects soft-deleted users

## Dev Agent Record

### File List

**Created:**
- `apps/api/src/utils/tenant-filter.ts` — buildTenantFilter utility + TenantFilterUser/TenantFilter types
- `apps/api/src/guards/tenant.guard.ts` — TenantGuard (CanActivate) for CLIENT org validation
- `apps/api/test/utils/tenant-filter.spec.ts` — 8 unit tests for buildTenantFilter
- `apps/api/test/guards/tenant.guard.spec.ts` — 8 unit tests for TenantGuard
- `apps/api/prisma/migrations/20260215172824_add_user_deleted_at/` — Prisma migration

**Modified:**
- `apps/api/prisma/schema.prisma` — Added `deletedAt DateTime?` to User model
- `apps/api/src/guards/index.ts` — Added TenantGuard barrel export
- `apps/api/src/services/users.service.ts` — Added findAllForTenant(), hardened findByAuth0Id/findByOrganization/syncOrCreateUser with soft-delete checks
- `apps/api/test/services/users/users.service.spec.ts` — Added findAllForTenant tests, updated findByAuth0Id/findByOrganization tests, added soft-delete test

### Change Log
- 2026-02-15: Initial implementation of tenant filter, guard, and tests
- 2026-02-15: Code review fixes — added deletedAt to User model, hardened existing queries against soft-deleted users

## Dev Notes

### Tenant Filter Pattern

The `buildTenantFilter()` function always includes `deletedAt: null` in returned filters, so spreading it into Prisma where clauses automatically excludes soft-deleted records:

```typescript
// Every service method that touches tenant-scoped data:
async findAll(user: TenantFilterUser): Promise<Resource[]> {
  const tenantFilter = buildTenantFilter(user);
  return this.prisma.resource.findMany({
    where: { ...tenantFilter },
  });
}
```

### TenantFilterUser Interface

```typescript
// Minimal interface — only needs role + organizationId
interface TenantFilterUser {
  role: Role;
  organizationId: string | null;
}
```

### Architecture Compliance

- **ADR-006:** Application-level data access (no RLS)
- **FR15:** Organization-based data isolation using application-level filtering
- **NFR20-23:** Security requirements for tenant isolation

### Dependencies

- Story 2.1 (Organization model)
- Existing: RequestUser interface, RolesGuard from Epic 1

### References

- Architecture docs: ADR-006 details
- Existing guards: `apps/api/src/guards/`
