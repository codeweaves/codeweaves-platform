# Story 11.10: RBAC Permission Matrix

Status: ready-for-dev

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

- [ ] **Task 1: Create RBAC types** (AC: #1, #4)
  - [ ] Create `apps/api/src/common/rbac/rbac.types.ts`
  - [ ] Define `Resource` enum: `User`, `Organization`, `Agent`, `AgentTheme`, `AgentSecret`, `ChatSession`, `ChatMessage`, `Analytics`, `AuditLog`, `Invitation`, `File`
  - [ ] Define `Action` enum: `Create`, `Read`, `ReadAll`, `Update`, `Delete`, `Export`
  - [ ] Define `PermissionEntry` type: `{ resource: Resource; action: Action; roles: Role[] }`
  - [ ] Define `PermissionKey` type: `` `${Resource}:${Action}` ``

- [ ] **Task 2: Create permission matrix constant** (AC: #1, #2)
  - [ ] Create `apps/api/src/common/rbac/permissions.ts`
  - [ ] Define `PERMISSION_MATRIX: Record<PermissionKey, Role[]>` constant
  - [ ] Matrix rules:
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
  - [ ] Export helper function `hasPermission(role: Role, resource: Resource, action: Action): boolean`
  - [ ] Export helper function `getPermissionsForRole(role: Role): PermissionKey[]`

- [ ] **Task 3: Create RbacModule** (AC: #4)
  - [ ] Create `apps/api/src/common/rbac/rbac.module.ts`
  - [ ] Mark as `@Global()` following CryptoModule pattern
  - [ ] Provide and export an `RbacService` that wraps the permission matrix lookup
  - [ ] `RbacService.checkPermission(role: Role, resource: Resource, action: Action): boolean`
  - [ ] Register in `AppModule` imports

- [ ] **Task 4: Create barrel export** (AC: #4)
  - [ ] Create `apps/api/src/common/rbac/index.ts`
  - [ ] Export `Resource`, `Action`, `PermissionKey`, `PERMISSION_MATRIX`, `hasPermission`, `getPermissionsForRole`
  - [ ] Export `RbacModule` and `RbacService`

- [ ] **Task 5: Unit tests** (AC: #3)
  - [ ] Create `apps/api/test/common/rbac/permissions.spec.ts`
  - [ ] Test: matrix completeness — every `Resource x Action` combination has an entry
  - [ ] Test: SUPER_ADMIN has all permissions
  - [ ] Test: ADMIN has all permissions
  - [ ] Test: CLIENT has only the explicitly listed permissions
  - [ ] Test: CLIENT does NOT have `Delete` on any resource
  - [ ] Test: CLIENT does NOT have `Create` on Agent, Organization, etc.
  - [ ] Test: `hasPermission()` returns correct boolean for known role/resource/action
  - [ ] Test: `getPermissionsForRole()` returns correct list for each role
  - [ ] Create `apps/api/test/common/rbac/rbac.service.spec.ts`
  - [ ] Test: `RbacService.checkPermission()` delegates to matrix correctly

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

### Debug Log References

### Completion Notes List

### File List
