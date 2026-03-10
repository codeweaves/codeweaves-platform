# Story 11.11: RolesGuard Enhancement with RBAC Permission Matrix

Status: ready-for-dev

## Story
As a **system**, I want role-based access control enhanced on all endpoints using the RBAC permission matrix, so that users only access resources and actions they are permitted based on fine-grained Resource x Action mappings.

## Acceptance Criteria
1. **Given** an endpoint has the `@RequirePermission(Resource, Action)` decorator, **When** a request is made, **Then** the user's role is checked against the `PERMISSION_MATRIX` from Story 11-10 and access is granted or denied accordingly.
2. **Given** a user with insufficient permissions, **When** the permission check runs, **Then** a `403 Forbidden` response is returned with a message indicating the required permission (e.g., `"Forbidden: requires [agents:create] permission"`).
3. **Given** a user with the `SUPER_ADMIN` role, **When** any permission is checked via `@RequirePermission`, **Then** access is always granted (SUPER_ADMIN bypasses the matrix).
4. **Given** the existing `@Roles()` decorator is used on an endpoint, **When** a request is made, **Then** it continues to work exactly as before (backward compatible, no changes to existing behavior).
5. **Given** neither `@RequirePermission` nor `@Roles()` is applied to an authenticated endpoint, **When** a request reaches the guard, **Then** default behavior allows access (no restriction beyond authentication).
6. **Given** tests exist, **Then** unit tests cover: permission granted, permission denied, SUPER_ADMIN bypass, backward compatibility with `@Roles()`, no-decorator default, and missing user/role edge cases.

## Tasks / Subtasks
- [ ] Create `apps/api/src/decorators/require-permission.decorator.ts` — defines `@RequirePermission(resource: Resource, action: Action)` using `SetMetadata` with a `PERMISSION_KEY` constant (AC: #1)
- [ ] Update `apps/api/src/guards/roles.guard.ts` — enhance `canActivate` to check BOTH `@Roles()` metadata (via `ROLES_KEY`) AND `@RequirePermission()` metadata (via `PERMISSION_KEY`) (AC: #1, #4, #5)
- [ ] Implement guard logic priority: (1) Check `@RequirePermission` — if present, lookup `PERMISSION_MATRIX[resource][action].includes(user.role)`, with SUPER_ADMIN always passing; (2) If no `@RequirePermission`, fall back to `@Roles()` check (existing behavior); (3) If neither decorator present, allow access (AC: #1, #3, #4, #5)
- [ ] Throw `ForbiddenException` with descriptive message when permission denied via `@RequirePermission` (AC: #2)
- [ ] Apply `@RequirePermission` to a subset of key endpoints across controllers (agents, organizations, users) as examples — do NOT migrate all `@Roles()` usages (AC: #1, #4)
- [ ] Create `apps/api/test/guards/roles-guard-enhanced.spec.ts` — new test file for `@RequirePermission` behavior (AC: #6)
- [ ] Update `apps/api/test/guards/roles.guard.spec.ts` — ensure existing tests still pass with the enhanced guard (AC: #6)

## Dev Notes

### Architecture Compliance
- This story enhances the existing `RolesGuard` registered as `APP_GUARD` in `AppModule` (after `JwtAuthGuard` and `UserSyncGuard`). Do NOT create a separate guard.
- The guard order in `AppModule` is: `JwtAuthGuard` -> `UserSyncGuard` -> `RolesGuard`. By the time `RolesGuard` runs, `request.user` is populated with `id`, `auth0Id`, `email`, `role`, `organizationId`, and `organization`.
- The `PERMISSION_MATRIX` constant is created in Story 11-10 and maps `Resource` x `Action` -> `Role[]`. Import it from wherever 11-10 places it (likely `apps/api/src/constants/` or `apps/api/src/common/rbac/`).

### Existing Patterns to Follow
- The existing `@Roles()` decorator in `apps/api/src/decorators/roles.decorator.ts` uses `SetMetadata(ROLES_KEY, roles)` — follow the same pattern for `@RequirePermission`.
- The existing `RolesGuard` in `apps/api/src/guards/roles.guard.ts` uses `reflector.getAllAndOverride()` to read metadata from both handler and class level — maintain the same approach for `PERMISSION_KEY`.
- Current `@Roles()` usage across controllers (e.g., `@Roles(Role.SUPER_ADMIN)` on `OrganizationsController`, `@Roles(Role.ADMIN, Role.SUPER_ADMIN)` on `AgentsController` create/update/delete) must continue to work unchanged.
- The existing `roles.guard.spec.ts` at `apps/api/test/guards/roles.guard.spec.ts` has comprehensive tests for the current behavior — these must all pass after the enhancement.

### What This Story Does NOT Include
- Does NOT create the `PERMISSION_MATRIX` — that is Story 11-10 (prerequisite).
- Does NOT migrate all existing `@Roles()` decorators to `@RequirePermission()` — only applies `@RequirePermission` to a few example endpoints.
- Does NOT add organization-level or tenant-scoped permission checks — this is purely role-based.
- Does NOT modify `JwtAuthGuard` or `UserSyncGuard`.

### Project Structure Notes
```
apps/api/src/
  decorators/
    roles.decorator.ts              # Existing — keep unchanged
    require-permission.decorator.ts # NEW — @RequirePermission(resource, action)
  guards/
    roles.guard.ts                  # MODIFY — enhance canActivate logic
  constants/ or common/rbac/
    permission-matrix.ts            # From Story 11-10 — import PERMISSION_MATRIX
apps/api/test/
  guards/
    roles.guard.spec.ts             # EXISTING — ensure backward compat
    roles-guard-enhanced.spec.ts    # NEW — @RequirePermission tests
```

### Testing Approach
- **Backend only** — unit tests in `apps/api/test/guards/`.
- New `roles-guard-enhanced.spec.ts` should test:
  - Permission granted when user role is in `PERMISSION_MATRIX[resource][action]`
  - Permission denied (403) when user role is NOT in `PERMISSION_MATRIX[resource][action]`
  - SUPER_ADMIN bypass — always allowed regardless of matrix entry
  - Backward compatibility — `@Roles()` still works as before
  - No decorator — access allowed by default
  - Edge cases: missing user, null role, invalid resource/action
- Existing `roles.guard.spec.ts` tests must continue to pass unchanged.
- Mock `PERMISSION_MATRIX` in tests to avoid dependency on actual matrix values.

### References
- `apps/api/src/guards/roles.guard.ts` — current guard implementation
- `apps/api/src/decorators/roles.decorator.ts` — current `@Roles()` decorator
- `apps/api/src/modules/app.module.ts` — guard registration order
- `apps/api/test/guards/roles.guard.spec.ts` — existing guard tests (184 lines)
- architecture.md — Security Layer 3: Authorization
- ADR-006 — Application-level access control
- Story 11-10 — RBAC Permission Matrix (prerequisite)

## Dev Agent Record
### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
