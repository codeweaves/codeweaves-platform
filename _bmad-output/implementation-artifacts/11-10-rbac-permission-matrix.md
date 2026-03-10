# Story 11.10: RBAC Permission Matrix

Status: done

## Story

As a **system**,
I want a clear permission matrix mapping resources, actions, and roles,
so that role-based access is consistently enforced across the platform.

## Acceptance Criteria

1. **Given** three roles (`SUPER_ADMIN`, `ADMIN`, `CLIENT`), **When** permissions are defined, **Then** a comprehensive matrix maps every resource x action x role combination.
2. **Given** the matrix exists, **When** a developer needs to apply authorization, **Then** they can look up exact permissions per endpoint.
3. **Given** the matrix, **When** tested, **Then** unit tests verify the matrix is complete (every resource/action has role assignments) and consistent (no contradictions).
4. **Given** the matrix is defined in code, **When** imported by `RolesGuard` (Story 11-11), **Then** it can programmatically check permissions.

## Tasks / Subtasks

- [x] **Task 1: Create RBAC types** (AC: #1, #4)
  - [x] Create `apps/api/src/common/rbac/rbac.types.ts`
  - [x] Define `Resource` enum: `User`, `Organization`, `Agent`, `AgentTheme`, `AgentSecret`, `ChatSession`, `ChatMessage`, `Analytics`, `AuditLog`, `Invitation`, `File`
  - [x] Define `Action` enum: `Create`, `Read`, `ReadAll`, `Update`, `Delete`, `Export`
  - [x] Define `PermissionEntry` type: `{ resource: Resource; action: Action; roles: Role[] }`
  - [x] Define `PermissionKey` type: `` `${Resource}:${Action}` ``

- [x] **Task 2: Create permission matrix constant** (AC: #1, #2)
  - [x] Create `apps/api/src/common/rbac/permissions.ts`
  - [x] Define `PERMISSION_MATRIX: Record<PermissionKey, Role[]>` constant
  - [x] Matrix rules:
    - **SUPER_ADMIN**: all permissions on all resources (platform-wide)
    - **ADMIN**: all permissions on all resources (org-scoped — enforcement is in TenantGuard, not here)
    - **CLIENT**:
      - `User:Read` (own), `User:Update` (own)
      - `Organization:Read` (own)
      - `Agent:Read`, `Agent:ReadAll` (own org agents)
      - `AgentTheme:Read` (own org)
      - `ChatSession:Read`, `ChatSession:ReadAll` (own)
      - `ChatMessage:Read` (own)
      - `Analytics:Read` (own org)
      - `AuditLog:Read` (own)
  - [x] Export helper function `hasPermission(role: Role, resource: Resource, action: Action): boolean`
  - [x] Export helper function `getPermissionsForRole(role: Role): PermissionKey[]`

- [x] **Task 3: Create RbacModule** (AC: #4)
  - [x] Create `apps/api/src/common/rbac/rbac.module.ts`
  - [x] Mark as `@Global()` following CryptoModule pattern
  - [x] Provide and export an `RbacService` that wraps the permission matrix lookup
  - [x] `RbacService.checkPermission(role: Role, resource: Resource, action: Action): boolean`
  - [x] Register in `AppModule` imports

- [x] **Task 4: Create barrel export** (AC: #4)
  - [x] Create `apps/api/src/common/rbac/index.ts`
  - [x] Export `Resource`, `Action`, `PermissionKey`, `PERMISSION_MATRIX`, `hasPermission`, `getPermissionsForRole`
  - [x] Export `RbacModule` and `RbacService`

- [x] **Task 5: Unit tests** (AC: #3)
  - [x] Create `apps/api/test/common/rbac/permissions.spec.ts`
  - [x] Test: matrix completeness — every `Resource x Action` combination has an entry
  - [x] Test: SUPER_ADMIN has all permissions
  - [x] Test: ADMIN has all permissions
  - [x] Test: CLIENT has only the explicitly listed permissions
  - [x] Test: CLIENT does NOT have `Delete` on any resource
  - [x] Test: CLIENT does NOT have `Create` on Agent, Organization, etc.
  - [x] Test: `hasPermission()` returns correct boolean for known role/resource/action
  - [x] Test: `getPermissionsForRole()` returns correct list for each role
  - [x] Create `apps/api/test/common/rbac/rbac.service.spec.ts`
  - [x] Test: `RbacService.checkPermission()` delegates to matrix correctly

## Dev Notes

### Architecture Compliance

**The matrix is compile-time configuration, not a database table.** This is intentional per ADR-006 (application-level access control). Roles are defined in Prisma enum (`SUPER_ADMIN`, `ADMIN`, `CLIENT`), and the matrix is a typed constant that maps `Resource:Action` to allowed roles. This keeps authorization logic fast (no DB queries) and version-controlled.

**Org-scoping is NOT the matrix's job.** The matrix answers "can this role perform this action on this resource type?" The question "can this user access THIS specific resource?" is handled by `TenantGuard` (org-level filtering) and ownership checks in services. The matrix is purely role-based.

### Existing Patterns to Follow

**Current RolesGuard** — Located at `apps/api/src/guards/roles.guard.ts`. Currently does a simple `requiredRoles.includes(user.role)` check using the `@Roles()` decorator. Story 11-11 will enhance this guard to use the permission matrix via a new `@RequirePermission(Resource, Action)` decorator. This story just provides the data structure.

**Prisma Role enum** — Defined in `apps/api/prisma/schema.prisma`:
```prisma
enum Role {
  SUPER_ADMIN
  ADMIN
  CLIENT
}
```

**Global module pattern** — Follow `CryptoModule`:
```typescript
@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
```

**Existing Prisma models (resources):**
- `Organization`, `User`, `UserInvitation`, `Agent`, `AgentSecret`, `AgentTheme`
- `ChatSession`, `ChatMessage`, `File`, `AuditLog`

### What This Story Does NOT Include

- **RolesGuard enhancement** — That's Story 11-11 (will consume this matrix and add `@RequirePermission()` decorator)
- **Endpoint-level permission application** — That's Story 11-11+ (applying decorators to controllers)
- **Dynamic permissions** — No runtime permission changes; the matrix is static
- **Resource ownership checks** — Handled by TenantGuard and service-level logic, not the matrix
- **UI permission checks** — Frontend role-based rendering is a separate concern

### Project Structure Notes

New files to create:
```
apps/api/src/common/rbac/
├── rbac.module.ts       # Global module, exports RbacService
├── rbac.service.ts      # Wraps permission matrix lookups
├── rbac.types.ts        # Resource, Action, PermissionEntry types
├── permissions.ts       # PERMISSION_MATRIX constant + helper functions
└── index.ts             # Barrel exports

apps/api/test/common/rbac/
├── permissions.spec.ts  # Matrix completeness and correctness tests
└── rbac.service.spec.ts # Service unit tests
```

Modified files:
```
apps/api/src/modules/app.module.ts  # Import RbacModule
```

### Testing Approach

Tests should be exhaustive for the matrix since it's a security-critical data structure:

```typescript
// Test matrix completeness
const allResources = Object.values(Resource);
const allActions = Object.values(Action);
for (const resource of allResources) {
  for (const action of allActions) {
    const key = `${resource}:${action}` as PermissionKey;
    expect(PERMISSION_MATRIX[key]).toBeDefined();
  }
}
```

Use `@nestjs/testing` `Test.createTestingModule()` for `RbacService` tests. No mocking needed beyond the module setup since the service wraps a pure constant lookup.

### References

- [Source: apps/api/prisma/schema.prisma — Role enum: SUPER_ADMIN, ADMIN, CLIENT]
- [Source: apps/api/src/guards/roles.guard.ts — Current simple role check implementation]
- [Source: apps/api/src/decorators/roles.decorator.ts — @Roles() decorator]
- [Source: _bmad-output/planning-artifacts/architecture.md — Security Layer 3: Authorization]
- [Source: _bmad-output/planning-artifacts/architecture.md — FR118: Org-based filtering]
- [Source: _bmad-output/planning-artifacts/architecture.md — ADR-006: Application-level access control]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed `isolatedModules` TS error in barrel export — used `export type` for PermissionKey and PermissionEntry

### Completion Notes List
- Task 1: Created Resource (11 values) and Action (6 values) enums, PermissionKey template literal type, PermissionEntry interface
- Task 2: Created PERMISSION_MATRIX with 66 entries (11 resources x 6 actions). SUPER_ADMIN and ADMIN get all permissions. CLIENT gets 11 specific read/update permissions. Exported `hasPermission()` and `getPermissionsForRole()` helpers.
- Task 3: Created @Global() RbacModule with RbacService wrapping matrix lookups. Registered in AppModule.
- Task 4: Created barrel export with proper `export type` for type-only re-exports (isolatedModules compliance).
- Task 5: 38 unit tests covering matrix completeness, role-specific permissions, CLIENT restrictions (no Delete/Create/Export), helper functions, and RbacService delegation.
- All 888 tests pass. Lint, type-check, build all green.
- Code review fixes: Object.freeze() on PERMISSION_MATRIX and role arrays, import type for Role in rbac.types.ts, pre-computed ROLE_PERMISSIONS_MAP for O(1) lookups, tests import from barrel export.

### File List
- apps/api/src/common/rbac/rbac.types.ts (new)
- apps/api/src/common/rbac/permissions.ts (new)
- apps/api/src/common/rbac/rbac.service.ts (new)
- apps/api/src/common/rbac/rbac.module.ts (new)
- apps/api/src/common/rbac/index.ts (new)
- apps/api/src/modules/app.module.ts (modified — added RbacModule import)
- apps/api/test/common/rbac/permissions.spec.ts (new)
- apps/api/test/common/rbac/rbac.service.spec.ts (new)
