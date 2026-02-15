# Story 2.7: Implement Organization Dashboard View

Status: backlog

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
   **Then** each row shows: organization name, slug, created date, user count, agent count

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

- [ ] Task 1: Create Organizations page (`apps/web/app/dashboard/organizations/page.tsx`)
  - [ ] Server component with client-side data fetching via TanStack Query
  - [ ] Role-based access check (redirect if CLIENT)
  - [ ] Page title "Organizations"

- [ ] Task 2: Create OrganizationsList component
  - [ ] Use shadcn Table component (add via `bunx shadcn@latest add table`)
  - [ ] Columns: Name, Slug, Created, Users, Agents
  - [ ] Clickable rows navigate to org detail
  - [ ] Loading skeleton state
  - [ ] Empty state with CTA

- [ ] Task 3: Create Organization API hooks
  - [ ] `hooks/use-organizations.ts` — `useOrganizations()` with TanStack Query
  - [ ] `queryKey: ['organizations']`
  - [ ] Calls `GET /organizations` via `useApiClient`

- [ ] Task 4: Create "Create Organization" dialog
  - [ ] Use shadcn Dialog component (add via `bunx shadcn@latest add dialog`)
  - [ ] Form fields: Name (required)
  - [ ] Slug auto-generated preview
  - [ ] Submit calls `POST /organizations`
  - [ ] Success: close dialog, invalidate organizations query, show toast
  - [ ] Error: show error message in dialog

- [ ] Task 5: Add sidebar navigation entry
  - [ ] Add "Organizations" item to sidebar nav (visible only for ADMIN/SUPER_ADMIN)
  - [ ] Icon: `Building2` from lucide-react
  - [ ] Position: after Dashboard, before Agents

- [ ] Task 6: Create Organization detail page placeholder
  - [ ] `apps/web/app/dashboard/organizations/[id]/page.tsx`
  - [ ] Basic layout showing org name, slug, dates
  - [ ] Placeholder for members list and agent list (future stories)

## Dev Notes

### Page Structure

```
/dashboard/organizations
├── Organization List Table
│   ├── Name (link to detail)
│   ├── Slug
│   ├── Created Date
│   ├── Users Count
│   └── Agents Count
├── Create Organization Button (Super Admin only)
└── Empty State (if no orgs)
```

### shadcn Components Needed

```bash
bunx shadcn@latest add table
bunx shadcn@latest add dialog
```

### Role-Based Sidebar

```typescript
// Only show for ADMIN and SUPER_ADMIN
const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: 'all' },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: [Role.ADMIN, Role.SUPER_ADMIN] },
  { name: 'Agents', href: '/dashboard/agents', icon: Bot, roles: 'all' },
  // ...
];
```

### Architecture Compliance

- **FR14:** Super Admin can view list of all organizations with metadata
- Performance: TanStack Query caching, no unnecessary re-renders
- shadcn components only (per CLAUDE.md rules)

### Dependencies

- Story 2.2 (Organization CRUD API — backend endpoints)
- Story 2.8 (Organization Context Provider — for role checks)
- Existing: TanStack Query, shadcn UI, sidebar from current branch
