# Story 2.8: Create Organization Context Provider

Status: backlog

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

3. **Given** an Admin user
   **When** they switch organization context (e.g., viewing different org)
   **Then** the context updates and dependent components re-render

4. **Given** loading state
   **When** organization data is being fetched
   **Then** `useOrganization()` returns `{ isLoading: true, organization: null }`

5. **Given** an error fetching organization
   **When** the API call fails
   **Then** error state is exposed and a retry mechanism is available

## Tasks / Subtasks

- [ ] Task 1: Create useOrganization hook (`apps/web/hooks/use-organization.ts`)
  - [ ] Fetch from profile data (already available via `useProfile()`)
  - [ ] Extract organization from profile response
  - [ ] Return `{ organization, isLoading, error }`
  - [ ] Handle null organization (SUPER_ADMIN without org)

- [ ] Task 2: Create OrganizationProvider component (`apps/web/providers/organization-provider.tsx`)
  - [ ] Wraps dashboard layout (inside Auth0Provider, after profile is loaded)
  - [ ] Provides organization context via React Context
  - [ ] Handles org switching for Admin users (optional, if needed)

- [ ] Task 3: Create useCurrentRole hook (`apps/web/hooks/use-current-role.ts`)
  - [ ] Returns the authenticated user's role from profile
  - [ ] Helper: `isSuperAdmin()`, `isAdmin()`, `isClient()`
  - [ ] Simplifies role checks across components

- [ ] Task 4: Create RoleGate component (`apps/web/components/auth/role-gate.tsx`)
  - [ ] `<RoleGate roles={[Role.SUPER_ADMIN, Role.ADMIN]}>` — renders children only if user has matching role
  - [ ] Optional `fallback` prop for unauthorized view
  - [ ] Used to conditionally show sidebar items, buttons, pages

- [ ] Task 5: Update profile API response to include organization details
  - [ ] Verify backend `/auth/users/me` returns organization: `{ id, name, slug }` or null
  - [ ] Update `UserProfile` interface in `use-profile.ts` if needed

- [ ] Task 6: Write tests / verify integration
  - [ ] Test useOrganization returns correct data for each role
  - [ ] Test RoleGate shows/hides content based on role
  - [ ] Test loading and error states

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
// Only Super Admin sees the create button
<RoleGate roles={['SUPER_ADMIN']}>
  <Button>Create Organization</Button>
</RoleGate>

// Admin and Super Admin see the org list
<RoleGate roles={['SUPER_ADMIN', 'ADMIN']} fallback={<Redirect to="/dashboard" />}>
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
