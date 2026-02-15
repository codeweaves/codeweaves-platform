# Story 2.3: Implement Tenant Isolation Filter

Status: backlog

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

- [ ] Task 1: Create TenantContext utility (`apps/api/src/utils/tenant-filter.ts`)
  - [ ] `buildTenantFilter(user: RequestUser): { organizationId?: string }` — returns filter based on role
  - [ ] CLIENT role: always returns `{ organizationId: user.organizationId }`
  - [ ] ADMIN role: returns `{}` (no filter, sees all)
  - [ ] SUPER_ADMIN role: returns `{}` (no filter, sees all)
  - [ ] Throws if CLIENT user has no organizationId

- [ ] Task 2: Update existing services to use tenant filter
  - [ ] Update `UsersService.findByOrganization()` to accept user context
  - [ ] Prepare pattern for future services (Agents, Analytics, etc.)

- [ ] Task 3: Create TenantGuard (`apps/api/src/guards/tenant.guard.ts`)
  - [ ] Validates that CLIENT users have a valid organizationId on their JWT
  - [ ] Returns 403 if CLIENT user has no organizationId
  - [ ] ADMIN and SUPER_ADMIN pass through

- [ ] Task 4: Document tenant isolation pattern
  - [ ] Add code comments showing the required pattern
  - [ ] Every findAll/findOne/create/update/delete for tenant-scoped resources MUST use `buildTenantFilter`

- [ ] Task 5: Write unit tests
  - [ ] Test buildTenantFilter returns correct filter for each role
  - [ ] Test CLIENT user gets org filter applied
  - [ ] Test ADMIN user gets no filter
  - [ ] Test SUPER_ADMIN user gets no filter
  - [ ] Test CLIENT user without organizationId throws error
  - [ ] Test TenantGuard allows/denies correctly

## Dev Notes

### Tenant Filter Pattern

```typescript
// Every service method that touches tenant-scoped data:
async findAll(user: RequestUser): Promise<Resource[]> {
  const tenantFilter = buildTenantFilter(user);
  return this.prisma.resource.findMany({
    where: {
      ...tenantFilter,
      deletedAt: null,
    },
  });
}

async findOne(id: string, user: RequestUser): Promise<Resource> {
  const tenantFilter = buildTenantFilter(user);
  const resource = await this.prisma.resource.findFirst({
    where: { id, ...tenantFilter },
  });
  if (!resource) throw new NotFoundException();
  return resource;
}
```

### RequestUser Interface

```typescript
// Already exists in apps/api/src/interfaces/
interface RequestUser {
  id: string;
  auth0Id: string;
  email: string;
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
