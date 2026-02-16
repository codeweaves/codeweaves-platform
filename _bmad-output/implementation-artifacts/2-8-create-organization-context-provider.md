# Story 2.8: Create Organization Context Provider

Status: done

## Story

As a **dashboard developer**,
I want organization context available throughout the app,
So that components can access current organization info and user role.

## Acceptance Criteria

1. **Given** a user is authenticated
   **When** the dashboard loads
   **Then** OrganizationProvider fetches the user's organization details

2. **Given** the organization data is loaded
   **When** any component calls `useOrganization()`
   **Then** it returns the current organization (id, name, slug) or null for SUPER_ADMIN

3. ~~**Given** an Admin user **When** they switch organization context **Then** the context updates~~ — **N/A**: Org switching is not part of the product design. SUPER_ADMIN/ADMIN will use per-list org filters on pages (agents, users) instead of a global context switch.

4. **Given** loading state
   **When** organization data is being fetched
   **Then** `useOrganization()` returns `{ isLoading: true, organization: null }`

5. **Given** an error fetching organization
   **When** the API call fails
   **Then** error state is exposed and a retry mechanism is available

## Tasks / Subtasks

- [x] Task 1: Create useOrganization hook (`apps/web/hooks/use-organization.ts`)
  - [x] Fetch from profile data (already available via `useProfile()`)
  - [x] Extract organization from profile response
  - [x] Return `{ organization, isLoading, error }`
  - [x] Handle null organization (SUPER_ADMIN without org)

- [x] Task 2: ~~Create OrganizationProvider component~~ — **Not needed**
  - Organization data is derived from the existing `useProfile()` query (cached via TanStack Query)
  - A `useOrganization()` hook (Task 1) reads from profile — no separate provider wrapper required
  - If org switching is needed later, a provider can be introduced at that time

- [x] Task 3: Create useCurrentRole hook (`apps/web/hooks/use-current-role.ts`)
  - [x] Returns the authenticated user's role from profile
  - [x] Helper: `isSuperAdmin()`, `isAdmin()`, `isClient()`
  - [x] Simplifies role checks across components

- [x] Task 4: Create RoleGate component (`apps/web/components/features/auth/role-gate.tsx`)
  - [x] `<RoleGate roles={['SUPER_ADMIN', 'ADMIN']}>` — renders children only if user has matching role
  - [x] Optional `fallback` prop for unauthorized view
  - [x] Used to conditionally show sidebar items, buttons, pages

- [x] Task 5: Update profile API response to include organization details
  - [x] Verify backend `/auth/users/me` returns organization: `{ id, name, slug }` or null
  - [x] Update `UserProfile` interface in `use-profile.ts` — added `slug` field

- [x] Task 6: Write tests / verify integration
  - [x] Manual verification — no frontend test infrastructure; hooks/component verified via type-check, lint, build
  - [x] All backend tests pass (355/355, 23 suites)

## Dev Agent Record

### Implementation Plan
- Hooks derive from existing `useProfile()` TanStack Query cache — no new API calls or providers needed
- `Role` type defined locally in `use-current-role.ts` to avoid adding `@repo/validation` as web dependency
- `RoleGate` placed in `components/features/auth/` alongside existing auth components
- Backend already returns `{ id, name, slug }` for organization — only frontend interface needed updating

### Completion Notes
- All 6 tasks complete
- Type-check, lint, build all pass
- Backend tests: 355/355 pass, no regressions
- No new dependencies added

## File List

- `apps/web/hooks/use-current-organization.ts` (new — renamed from use-organization.ts to avoid collision)
- `apps/web/hooks/use-current-role.ts` (new)
- `apps/web/hooks/use-profile.ts` (modified — added `slug`, `Role` type, `refetch`)
- `apps/web/components/features/auth/role-gate.tsx` (new)

## Change Log

- 2026-02-16: Implemented story 2-8 — created `useCurrentOrganization`, `useCurrentRole` hooks and `RoleGate` component
- 2026-02-16: Code review fixes — exposed `refetch`, typed `Role` properly, removed unsafe casts, renamed hook to avoid collision, updated AC3 as N/A

## Dev Notes

### Hook API

```typescript
// useOrganization
const { organization, isLoading, error } = useOrganization();
// organization: { id: string, name: string, slug: string } | null

// useCurrentRole
const { role, isSuperAdmin, isAdmin, isClient } = useCurrentRole();
```

### RoleGate Component

```tsx
import { Role } from '@repo/validation';

// Only Super Admin sees the create button
<RoleGate roles={[Role.SUPER_ADMIN]}>
  <Button>Create Organization</Button>
</RoleGate>

// Admin and Super Admin see the org list
<RoleGate roles={[Role.SUPER_ADMIN, Role.ADMIN]} fallback={<Redirect to="/dashboard" />}>
  <OrganizationsList />
</RoleGate>
```

### Provider Chain

```tsx
// apps/web/app/dashboard/layout.tsx (or similar)
<QueryProvider>
  <ApiGate>
    <Auth0ProviderWrapper>
      <DashboardShell>  {/* SidebarProvider is inside */}
        {children}
      </DashboardShell>
    </Auth0ProviderWrapper>
  </ApiGate>
</QueryProvider>
```

Organization context is derived from the profile query (already cached via TanStack Query), so no additional provider wrapper is needed — just hooks.

### Architecture Compliance

- **ADR-010:** Zustand + TanStack Query for state management
- Organization context uses TanStack Query (server state, not client state)
- Role utilities enable conditional rendering per RBAC matrix

### Dependencies

- Story 2.2 (Organization CRUD — backend)
- Existing: `useProfile()` hook, TanStack Query setup, Auth0 integration
