# Story 2.4: Create RolesGuard for Authorization

Status: done

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

- [x] Task 1: Verify existing RolesGuard implementation
  - [x] RolesGuard already exists at `apps/api/src/guards/roles.guard.ts` (implemented in Epic 1)
  - [x] `@Roles()` decorator already exists at `apps/api/src/decorators/roles.decorator.ts`
  - [x] Verified guard reads roles from `reflector.getAllAndOverride`
  - [x] Verified guard checks `request.user.role` against required roles

- [x] Task 2: Evaluate hierarchical role checks
  - [x] Decision: **No role hierarchy** — exact match only
  - [x] SUPER_ADMIN does NOT implicitly get ADMIN permissions; use `@Roles(Role.SUPER_ADMIN, Role.ADMIN)` for shared access
  - [x] Documented in Dev Notes below

- [x] Task 3: Create comprehensive RBAC permission matrix test
  - [x] Test SUPER_ADMIN can access SUPER_ADMIN-only endpoints (roles.guard.spec.ts)
  - [x] Test ADMIN cannot access SUPER_ADMIN-only endpoints
  - [x] Test CLIENT cannot access ADMIN-only endpoints
  - [x] Test multi-role `@Roles(Role.SUPER_ADMIN, Role.ADMIN)` works
  - [x] Test endpoint without `@Roles()` allows all authenticated users
  - [x] Test edge cases: undefined role, null user, invalid string role
  - [x] Added 12 RBAC matrix tests in `describe('RBAC Permission Matrix')` block

- [x] Task 4: Verify and update RolesGuard on existing controllers
  - [x] OrganizationsController: `@Roles(Role.SUPER_ADMIN)` at class level — correct
  - [x] InvitationsController: Updated `create` and `findAll` to `@Roles(Role.SUPER_ADMIN, Role.ADMIN)` per RBAC matrix
  - [x] InvitationsController: `findById`, `resend`, `cancel` remain `@Roles(Role.SUPER_ADMIN)` — correct
  - [x] UsersController: No `@Roles()` decorator (all authenticated users) — correct per RBAC matrix
  - [x] Added 7 role metadata verification tests to InvitationsController spec
  - [x] Added 2 role metadata verification tests to UsersController spec

## Dev Agent Record

### File List

**Modified:**
- `apps/api/src/controllers/invitations/invitations.controller.ts` — Updated `create` and `findAll` RBAC from SUPER_ADMIN-only to SUPER_ADMIN + ADMIN
- `apps/api/test/guards/roles.guard.spec.ts` — Added 12 RBAC permission matrix tests
- `apps/api/test/controllers/invitations/invitations.controller.spec.ts` — Added 7 role metadata verification tests
- `apps/api/test/controllers/auth/users.controller.spec.ts` — Added 2 role metadata verification tests

**Verified (no changes needed):**
- `apps/api/src/guards/roles.guard.ts` — Existing implementation is correct
- `apps/api/src/decorators/roles.decorator.ts` — Existing implementation is correct
- `apps/api/src/controllers/organizations/organizations.controller.ts` — SUPER_ADMIN-only at class level, correct
- `apps/api/src/controllers/auth/users.controller.ts` — No @Roles(), all authenticated users, correct

### Change Log
- 2026-02-15: Verified RolesGuard, added RBAC matrix tests, updated InvitationsController RBAC
- 2026-02-15: Code review fixes — added UsersController role metadata tests

## Dev Notes

### Role Hierarchy Decision

**No role hierarchy.** RBAC uses exact match only:
- Endpoints needing both SUPER_ADMIN and ADMIN: use `@Roles(Role.SUPER_ADMIN, Role.ADMIN)`
- Endpoints open to all authenticated: omit `@Roles()` decorator

### RBAC Permission Matrix (Verified)

| Endpoint | SUPER_ADMIN | ADMIN | CLIENT |
|----------|:-----------:|:-----:|:------:|
| POST /organizations | yes | no | no |
| GET /organizations | yes | no | no |
| GET /organizations/:id | yes | no | no |
| PATCH /organizations/:id | yes | no | no |
| POST /invitations | yes | yes | no |
| GET /invitations | yes | yes | no |
| GET /invitations/:id | yes | no | no |
| POST /invitations/:id/resend | yes | no | no |
| DELETE /invitations/:id | yes | no | no |
| GET /invitations/validate/:token | public | public | public |
| POST /invitations/reissue | public | public | public |
| GET /auth/users/me | yes | yes | yes |
| PATCH /auth/users/me | yes | yes | yes |

### Design Note: InvitationsService.findAll()

`GET /invitations` (accessible to SUPER_ADMIN and ADMIN) returns all invitations across all organizations. This is intentional — per the architecture (ADR-006), ADMIN users have cross-org read access. The `UserInvitation` model does not have a `deletedAt` field, so the buildTenantFilter pattern does not apply here.

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
