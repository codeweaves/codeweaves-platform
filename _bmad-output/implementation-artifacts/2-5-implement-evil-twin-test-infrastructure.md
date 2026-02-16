# Story 2.5: Implement "Evil Twin" Test Infrastructure

Status: complete

## Story

As a **developer**,
I want tenant isolation tests using an "Evil Twin" pattern,
So that I can verify no cross-tenant data leakage exists.

## Acceptance Criteria

1. **Given** test infrastructure exists
   **When** running tenant isolation tests
   **Then** two test organizations are created (Org A "Acme Corp", Org B "Evil Corp")

2. **Given** test data is seeded for both organizations
   **When** User from Org A queries resources
   **Then** only Org A's resources are returned
   **And** Org B's resources are NOT visible

3. **Given** User from Org B
   **When** attempting to access Org A resources by ID
   **Then** they receive 404 Not Found (not 403, to prevent information leakage)

4. **Given** every tenant-scoped resource type
   **When** tested with the Evil Twin pattern
   **Then** all cross-tenant access attempts fail
   **And** tests fail if ANY cross-tenant access succeeds

5. **Given** a Super Admin user
   **When** querying resources
   **Then** resources from both Org A and Org B are visible

## Tasks / Subtasks

- [x] Task 1: Create test helper utilities (`apps/api/test/helpers/tenant-test.helper.ts`)
  - [x] `createTestOrg(name: string): Organization` — create test org
  - [x] `createTestUser(org: Organization, role: Role): RequestUser` — create mock user context
  - [x] `seedTestData(org: Organization): TestData` — seed resources for an org

- [x] Task 2: Create Evil Twin base test suite (`apps/api/test/tenant-isolation/`)
  - [x] `tenant-isolation.spec.ts` — main test file
  - [x] Setup: Create Org A, Org B, users for each
  - [x] Teardown: Clean up test data (via jest.clearAllMocks in beforeEach)

- [x] Task 3: Test Organization isolation
  - [x] Org A user cannot list Org B's details
  - [x] Org A user cannot update Org B
  - [x] CLIENT user cannot access any org endpoints (SUPER_ADMIN only at controller level)

- [x] Task 4: Test User isolation
  - [x] Org A admin cannot list Org B's users
  - [x] `findByOrganization` respects org boundary

- [x] Task 5: Test Invitation isolation
  - [x] Org A admin cannot see Org B's invitations
  - [x] Org A admin cannot cancel Org B's invitations
  - [x] Invitation create enforces user's organizationId

- [x] Task 6: Create reusable assertion helpers
  - [x] `expectTenantIsolated(fn: () => Promise<any>)` — asserts NotFoundException
  - [x] `expectCrossTenantBlocked(orgAUser, orgBResourceId, serviceFn)` — generic helper

- [x] Task 7: Add Evil Twin tests to CI pipeline
  - [x] Ensure tests run as part of `bun run test:cov` (26 tests included in 306 total)
  - [x] Tests grouped under `test/tenant-isolation/` for easy filtering

## Dev Notes

### Evil Twin Pattern

```typescript
describe('Tenant Isolation - Evil Twin', () => {
  let orgA: Organization;
  let orgB: Organization;
  let userA: RequestUser; // CLIENT in Org A
  let userB: RequestUser; // CLIENT in Org B
  let adminUser: RequestUser; // SUPER_ADMIN

  beforeAll(async () => {
    orgA = await createTestOrg('Acme Corp');
    orgB = await createTestOrg('Evil Corp');
    userA = createTestUser(orgA, Role.CLIENT);
    userB = createTestUser(orgB, Role.CLIENT);
    adminUser = createTestUser(null, Role.SUPER_ADMIN);
  });

  describe('Organization resources', () => {
    it('Org A user cannot access Org B resources', async () => {
      const result = await service.findOne(orgBResourceId, userA);
      expect(result).toBeNull(); // or throws NotFoundException
    });

    it('Super Admin can access both orgs', async () => {
      const all = await service.findAll(adminUser);
      expect(all).toContainEqual(expect.objectContaining({ organizationId: orgA.id }));
      expect(all).toContainEqual(expect.objectContaining({ organizationId: orgB.id }));
    });
  });
});
```

### Test Priority

This is **P0 — CRITICAL**. Tenant isolation failures are security vulnerabilities. These tests MUST pass before any release.

### Architecture Compliance

- **ADR-006:** Validates application-level isolation works correctly
- **NFR20-23:** Security test coverage for tenant isolation
- **Test Priority: P0** as specified in epics

### Dependencies

- Story 2.3 (Tenant Isolation Filter — the thing being tested)
- Story 2.2 (Organization CRUD — test data creation)
- Existing: Jest test infrastructure from Epic 0

### References

- Test directory: `apps/api/test/`
- Jest config: `apps/api/jest.config.cjs`
