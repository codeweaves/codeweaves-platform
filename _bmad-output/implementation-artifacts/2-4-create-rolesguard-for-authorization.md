# Story 2.4: Create RolesGuard for Authorization

Status: backlog

## Story

As a **backend developer**,
I want role-based access control on endpoints,
So that users can only perform permitted actions.

## Acceptance Criteria

1. **Given** users have assigned roles (SUPER_ADMIN, ADMIN, CLIENT)
   **When** accessing a protected endpoint with `@Roles()` decorator
   **Then** RolesGuard checks user's role against required roles

2. **Given** a user without the required role
   **When** accessing a role-protected endpoint
   **Then** they receive 403 Forbidden

3. **Given** an endpoint without `@Roles()` decorator
   **When** any authenticated user accesses it
   **Then** access is granted (no role check)

4. **Given** RolesGuard is applied
   **When** it runs after JwtAuthGuard
   **Then** the user object with role is available on the request

## Tasks / Subtasks

- [ ] Task 1: Verify existing RolesGuard implementation
  - [ ] RolesGuard already exists at `apps/api/src/guards/roles.guard.ts` (implemented in Epic 1)
  - [ ] `@Roles()` decorator already exists at `apps/api/src/decorators/roles.decorator.ts`
  - [ ] Verify guard reads roles from `reflector.getAllAndOverride`
  - [ ] Verify guard checks `request.user.role` against required roles

- [ ] Task 2: Extend RolesGuard for hierarchical role checks (if needed)
  - [ ] Evaluate if SUPER_ADMIN should implicitly have all ADMIN permissions
  - [ ] If yes, implement role hierarchy: SUPER_ADMIN > ADMIN > CLIENT
  - [ ] Document decision

- [ ] Task 3: Create comprehensive RBAC permission matrix test
  - [ ] Test SUPER_ADMIN can access SUPER_ADMIN-only endpoints
  - [ ] Test ADMIN cannot access SUPER_ADMIN-only endpoints
  - [ ] Test CLIENT cannot access ADMIN-only endpoints
  - [ ] Test multi-role `@Roles(Role.SUPER_ADMIN, Role.ADMIN)` works
  - [ ] Test endpoint without `@Roles()` allows all authenticated users
  - [ ] Test unauthenticated user gets 401 (not 403)

- [ ] Task 4: Apply RolesGuard to existing controllers
  - [ ] Verify InvitationsController has appropriate role restrictions
  - [ ] Verify UsersController has appropriate role restrictions
  - [ ] Add `@Roles()` where missing based on RBAC matrix

## Dev Notes

### Current State

RolesGuard and `@Roles()` decorator were already implemented in Epic 1. This story verifies they work correctly for the RBAC matrix defined in the architecture and extends if needed.

### RBAC Permission Matrix

| Endpoint | SUPER_ADMIN | ADMIN | CLIENT |
|----------|:-----------:|:-----:|:------:|
| POST /organizations | yes | no | no |
| GET /organizations | yes | no | no |
| POST /invitations | yes | yes | no |
| GET /invitations | yes | yes | no |
| GET /auth/users/me | yes | yes | yes |
| PATCH /auth/users/me | yes | yes | yes |

### Existing Files

- Guard: `apps/api/src/guards/roles.guard.ts`
- Decorator: `apps/api/src/decorators/roles.decorator.ts`
- Tests: `apps/api/test/guards/roles.guard.spec.ts`

### Architecture Compliance

- **FR11-FR16:** Role-based access per RBAC matrix
- **NFR20-23:** Security requirements

### Dependencies

- Story 2.1, 2.2 (Organization endpoints to protect)
- Existing: JwtAuthGuard, RolesGuard from Epic 1
