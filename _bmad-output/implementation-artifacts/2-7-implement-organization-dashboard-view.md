# Story 2.7: Implement Organization Dashboard View

Status: done

## Story

As an **Admin or Super Admin**,
I want to see all organizations in the dashboard,
So that I can monitor the platform.

## Acceptance Criteria

1. **Given** I am logged in as Admin or Super Admin
   **When** I navigate to the Organizations page (`/dashboard/organizations`)
   **Then** a list of organizations is displayed in a table

2. **Given** the organizations list is displayed
   **When** I view the table
   **Then** each row shows: organization name, slug, created date, user count
   > Note: Agent count deferred — Agent model does not exist yet. Will be added when Agent CRUD is implemented.

3. **Given** I am logged in as Client
   **When** I navigate to `/dashboard/organizations`
   **Then** I am redirected away (page not accessible to Client users)

4. **Given** the organizations list
   **When** I click on an organization row
   **Then** I navigate to the organization detail view (`/dashboard/organizations/:id`)

5. **Given** I am a Super Admin
   **When** I am on the Organizations page
   **Then** I see a "Create Organization" button
   **And** clicking it opens a dialog to create a new organization

6. **Given** no organizations exist
   **When** I view the Organizations page
   **Then** I see an empty state with a prompt to create the first organization

## Tasks / Subtasks

- [x] Task 1: Create Organizations page (`apps/web/app/(protected)/dashboard/organizations/page.tsx`)
  - [x] Client component with TanStack Query data fetching
  - [x] Role-based access check (redirect if CLIENT)
  - [x] Page title "Organizations"

- [x] Task 2: Create OrganizationsDataTable component
  - [x] Use shadcn Table component + @tanstack/react-table
  - [x] Columns: Name (sortable), Slug, Created (sortable), Users (sortable)
  - [x] Server-side pagination, search, and sorting via URL params
  - [x] Clickable rows navigate to org detail
  - [x] Loading skeleton state
  - [x] Empty state with CTA

- [x] Task 3: Create Organization API hooks (`hooks/use-organizations.ts`)
  - [x] `useOrganizations(params)` — TanStack Query with pagination/search/sort
  - [x] `useOrganization(id)` — single org fetch
  - [x] `useCreateOrganization()` — mutation with cache invalidation
  - [x] Calls `GET /organizations` and `POST /organizations` via `useApiClient`

- [x] Task 4: Create "Create Organization" dialog
  - [x] Use shadcn Dialog component
  - [x] Form fields: Name (required, min 3 chars)
  - [x] Slug auto-generated preview
  - [x] Submit calls `POST /organizations`
  - [x] Success: close dialog, invalidate organizations query, show toast
  - [x] Error: show error message in dialog

- [x] Task 5: Add sidebar navigation entry
  - [x] Add "Organizations" item to sidebar nav (visible only for ADMIN/SUPER_ADMIN)
  - [x] Icon: `Building2` from lucide-react
  - [x] Position: after Dashboard, before Agents
  - [x] Role-based filtering on all nav items via `useProfile().profile?.role`

- [x] Task 6: Create Organization detail page placeholder
  - [x] `apps/web/app/(protected)/dashboard/organizations/[id]/page.tsx`
  - [x] Basic layout showing org name, slug, dates, user count
  - [x] Error state for API failures (distinct from not-found)
  - [x] Placeholder cards for Members and Agents (future stories)

- [x] Task 7: Backend — Allow ADMIN access to read endpoints
  - [x] Method-level `@Roles(Role.SUPER_ADMIN, Role.ADMIN)` on `findAll` and `findById`
  - [x] Added pagination, search, sort to `GET /organizations`
  - [x] `organizationListQuerySchema` in shared validation package
  - [x] Unit tests for controller and service updated

- [x] Task 8: Install shadcn components and dependencies
  - [x] table, dialog, sonner, label components
  - [x] @tanstack/react-table for data table
  - [x] Toaster added to root layout

## Dev Agent Record

### File List

**Modified:**
- `packages/validation/src/index.ts` — Added `organizationListQuerySchema`
- `apps/api/src/models/organization.dto.ts` — Re-exported new schema
- `apps/api/src/controllers/organizations/organizations.controller.ts` — ADMIN access, pagination query
- `apps/api/src/services/organizations.service.ts` — Paginated findAll with search/sort
- `apps/api/test/controllers/organizations/organizations.controller.spec.ts` — Updated tests
- `apps/api/test/services/organizations/organizations.service.spec.ts` — Updated tests
- `apps/api/test/tenant-isolation/tenant-isolation.spec.ts` — Fixed mock for paginated response
- `apps/web/app/layout.tsx` — Added Toaster
- `apps/web/components/layout/sidebar.tsx` — Role-based nav filtering
- `apps/web/package.json` — Added @tanstack/react-table, sonner deps
- `apps/web/app/globals.css` — Removed dark mode CSS variables
- `apps/web/components/ui/input.tsx` — Removed dark: class prefixes

**New:**
- `apps/web/hooks/use-organizations.ts`
- `apps/web/components/features/organizations/organizations-data-table.tsx`
- `apps/web/components/features/organizations/create-organization-dialog.tsx`
- `apps/web/app/(protected)/dashboard/organizations/page.tsx`
- `apps/web/app/(protected)/dashboard/organizations/[id]/page.tsx`
- `apps/web/components/ui/table.tsx`
- `apps/web/components/ui/dialog.tsx`
- `apps/web/components/ui/sonner.tsx`
- `apps/web/components/ui/label.tsx`

### Change Log

| Date       | Change | Author |
|------------|--------|--------|
| 2026-02-16 | Initial implementation of all tasks | Dev Agent |
| 2026-02-16 | Code review fixes: error state on detail page, URL param sync for data table, removed dark theme, removed unused badge.tsx, fixed redundant detail card | Review |

## Dev Notes

### Page Structure

```
/dashboard/organizations
├── Organization Data Table (server-side pagination/sort/search)
│   ├── Name (sortable)
│   ├── Slug
│   ├── Created Date (sortable)
│   └── Users Count (sortable)
├── Search with URL param sync
├── Create Organization Button (Super Admin only)
└── Empty State (if no orgs)
```

### shadcn Components Used

- table, dialog, sonner, label, skeleton, card, button, input

### Architecture Compliance

- **FR14:** Super Admin can view list of all organizations with metadata
- Performance: TanStack Query caching, URL-synced state (no unnecessary re-renders)
- shadcn components only (per CLAUDE.md rules)
- Dark mode removed — light-only theme

### Dependencies

- Story 2.2 (Organization CRUD API — backend endpoints)
- Story 2.8 (Organization Context Provider — for role checks)
- Existing: TanStack Query, shadcn UI, sidebar from current branch
