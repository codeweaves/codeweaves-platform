# Story 2.6: Create Organization Membership Validation

Status: done

## Story

As a **system**,
I want user-organization membership validated on every request,
So that users can only access their assigned organization's data.

## Acceptance Criteria

1. **Given** a user belongs to an organization
   **When** they make API requests
   **Then** their organizationId is extracted from the synced user record (via UserSyncInterceptor)

2. **Given** a Client user
   **When** they make requests for resources in another organization
   **Then** the request is blocked and returns 404

3. **Given** an Admin user
   **When** they make read requests
   **Then** they can see all organizations' data (read-only cross-org access)

4. **Given** a Client user without an organizationId
   **When** they make requests to tenant-scoped endpoints
   **Then** they receive 403 Forbidden with "No organization assigned" message

5. **Given** a Super Admin
   **When** they assign a user to an organization
   **Then** the user's organizationId is updated
   **And** subsequent requests use the new organizationId

## Tasks / Subtasks

- [x] Task 1: Verify UserSyncInterceptor sets organizationId on request
  - [x] Existing interceptor at `apps/api/src/interceptors/user-sync.interceptor.ts`
  - [x] Verify `request.user.organizationId` is set after sync
  - [x] Verify null organizationId is preserved for SUPER_ADMIN users

- [x] Task 2: Create endpoint to assign user to organization (Super Admin only)
  - [x] `PATCH /api/codeweaves/v1/organizations/:orgId/members/:userId` — assign user to org
  - [x] Validate user exists and is not already in another org
  - [x] Only SUPER_ADMIN can perform this action
  - [x] Return updated user

- [x] Task 3: Create endpoint to list organization members
  - [x] `GET /api/codeweaves/v1/organizations/:orgId/members` — list members
  - [x] SUPER_ADMIN: can list any org's members
  - [x] ADMIN: can list any org's members
  - [x] CLIENT: can only list their own org's members

- [x] Task 4: Create endpoint to remove user from organization
  - [x] `DELETE /api/codeweaves/v1/organizations/:orgId/members/:userId` — remove from org
  - [x] Sets organizationId to null (does not delete user)
  - [x] Only SUPER_ADMIN can perform this action

- [x] Task 5: Write unit tests
  - [x] Test user assignment to organization
  - [x] Test preventing assignment to org when already in another org
  - [x] Test member listing with role-based filtering
  - [x] Test member removal
  - [x] Test CLIENT user cannot access other org's members
  - [x] Test validation rejects invalid org/user IDs

## Dev Notes

### API Endpoints

```
GET    /api/codeweaves/v1/organizations/:orgId/members           — List org members
PATCH  /api/codeweaves/v1/organizations/:orgId/members/:userId   — Assign user to org
DELETE /api/codeweaves/v1/organizations/:orgId/members/:userId   — Remove user from org
```

### Member Response Shape

```typescript
{
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}
```

### Existing Infrastructure

The UserSyncInterceptor already attaches user data (including organizationId) to every authenticated request. This story builds on that to add explicit membership management endpoints.

### Architecture Compliance

- **FR12:** Admin can view and manage agents across all organizations
- **FR13:** Client can view and manage only their own organization's agents
- **ADR-006:** Application-level tenant filtering

### Dependencies

- Story 2.1 (Organization model)
- Story 2.2 (Organization CRUD)
- Story 2.3 (Tenant Isolation Filter)
- Existing: UserSyncInterceptor from Epic 1
