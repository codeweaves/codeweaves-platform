# Story 11.9: Audit Log Dashboard View

Status: ready-for-dev

## Story

As an **admin**, I want to view audit logs in the dashboard, so that I can review system activity and investigate changes without making direct API calls.

## Acceptance Criteria

1. **Given** navigation to the Audit Logs page, **When** the page loads, **Then** recent audit entries are displayed in a DataTable.
2. **Given** the DataTable, **When** displayed, **Then** columns show: timestamp (`createdAt`), user (userId/auth0Id), event, contextId.
3. **Given** filter controls, **When** filtering by event type or searching by contextId/userId, **Then** the table updates with filtered results.
4. **Given** a date range picker, **When** dates are selected, **Then** only entries within the range are shown.
5. **Given** clicking an entry row, **When** the detail view opens, **Then** the full `data` JSON is shown in a formatted view (including `previous`/`updated`/`request`/`response` sub-objects).
6. **Given** an export button, **When** clicked, **Then** audit logs matching current filters are exported as CSV.
7. **Given** a CLIENT user, **When** viewing, **Then** only their organization's logs appear (enforced by API tenant isolation).
8. **Given** tests exist, **Then** NO frontend tests are written (manual testing only per project rules).

## Tasks / Subtasks

- [ ] Task 1: Add "Audit Logs" to sidebar navigation (AC: #1)
  - [ ] In `apps/web/components/layout/sidebar.tsx`, add nav item: `{ name: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText, roles: ['SUPER_ADMIN', 'ADMIN'] }`
  - [ ] Import `ScrollText` from `lucide-react`
  - [ ] Place after Analytics and before Team in the navigation array
- [ ] Task 2: Create audit logs page route (AC: #1)
  - [ ] Create `apps/web/app/(protected)/dashboard/audit-logs/page.tsx` — server component wrapper with Suspense
  - [ ] Follow same pattern as `apps/web/app/(protected)/dashboard/analytics/page.tsx`
- [ ] Task 3: Create audit logs client component (AC: #1, #2, #3, #4, #6)
  - [ ] Create `apps/web/components/features/audit-logs/audit-logs-page-client.tsx`
  - [ ] Use existing DataTable component from `apps/web/components/ui/data-table/` with `onFetch` callback
  - [ ] Define columns: timestamp (formatted `createdAt`), user (userId or auth0Id display), event (badge-styled), contextId
  - [ ] Configure DataTable with `searchConfig` for contextId/userId search
  - [ ] Configure DataTable with `filters` for event type dropdown (populate with known event types)
  - [ ] Add date range filter above the table (reuse `DateRangeFilter` pattern from analytics)
  - [ ] Set `initialPageSize: 50`, `pageSizeOptions: [10, 50, 100]`
- [ ] Task 4: Create API hook for audit logs (AC: #1)
  - [ ] Create `apps/web/hooks/use-audit-logs.ts`
  - [ ] Implement `useAuditLogs(params)` — fetch from `GET /api/codeweaves/v1/audit-logs` with query params
  - [ ] Implement `useAuditLogDetail(id)` — fetch from `GET /api/codeweaves/v1/audit-logs/:id`
  - [ ] Use `useAuth()` hook for bearer token, follow pattern from existing hooks (e.g., `use-analytics.ts`)
- [ ] Task 5: Create detail view modal/sheet (AC: #5)
  - [ ] Create `apps/web/components/features/audit-logs/audit-log-detail-sheet.tsx`
  - [ ] Use Shadcn `Sheet` component (or `Dialog`) to display full audit log detail
  - [ ] Show metadata: id, correlationId, userId, auth0Id, contextId, event, createdAt
  - [ ] Show `data` JSON with formatted display — render `data.previous`, `data.updated`, `data.request`, `data.response`, `data.error` sections in collapsible panels
  - [ ] Use `<pre>` with `JSON.stringify(data, null, 2)` for JSON display, or a simple key-value tree
  - [ ] Trigger sheet open on row click
- [ ] Task 6: Add CSV export functionality (AC: #6)
  - [ ] Add export button to the DataTable via `exportConfig` prop
  - [ ] Implement client-side CSV generation from current table data, or fetch all matching records from API
  - [ ] Follow pattern from `apps/web/components/features/analytics/analytics-export-button.tsx` if applicable
- [ ] Task 7: Performance optimization (AC: #1, #7)
  - [ ] Ensure API calls use debounced search (DataTable handles this internally)
  - [ ] Avoid fetching full `data` JSON blob in list view — list endpoint should return lightweight entries
  - [ ] Only fetch full `data` on detail view (GET /:id)
  - [ ] Consider SWR/React Query caching for repeated queries

## Dev Notes

### Architecture Compliance

- Page follows Next.js App Router convention under `(protected)/dashboard/` group
- Uses existing DataTable component with `onFetch` callback API (server-side pagination)
- API calls use bearer token from Auth0 via `useAuth()` hook
- Tenant isolation enforced by API (Story 11-8), frontend does not filter

### Existing Patterns to Follow

- **Page route**: `apps/web/app/(protected)/dashboard/analytics/page.tsx` — Suspense wrapper with client component
- **Client component**: `apps/web/components/features/analytics/analytics-page-client.tsx` — date range filter, API hooks, DataTable integration
- **Date range filter**: `apps/web/components/features/analytics/date-range-filter.tsx` — reusable date picker with presets
- **DataTable usage**: `apps/web/components/features/agents/agents-data-table.tsx` — onFetch callback, column definitions, filter configs
- **Sidebar navigation**: `apps/web/components/layout/sidebar.tsx` — NavItem array with role-based visibility
- **API hooks**: `apps/web/hooks/use-analytics.ts` — fetch with auth token, params serialization

### Sidebar Navigation Config

Add to the `navigation` array in `apps/web/components/layout/sidebar.tsx`:

```typescript
import { ScrollText } from 'lucide-react';

// Add after Analytics, before Team:
{ name: 'Audit Logs', href: '/dashboard/audit-logs', icon: ScrollText, roles: ['SUPER_ADMIN', 'ADMIN'] },
```

Current navigation order: Dashboard, Organizations, Agents, Theme Editor, Analytics, **Audit Logs** (new), Team, Settings.

### AuditLog Data Structure Reference

The `data` JSON blob from Story 11-6/11-7 follows this structure:
```json
{
  "request": { ... },    // Input data that triggered the action
  "response": { ... },   // Result of the action
  "previous": { ... },   // State before change (for updates)
  "updated": { ... },    // State after change (for updates)
  "error": { ... }       // Error details (for exception events)
}
```

### DataTable Column Definitions

```typescript
const columns: ColumnDef<AuditLogEntry>[] = [
  { accessorKey: 'createdAt', header: 'Timestamp', cell: ({ row }) => formatDate(row.original.createdAt) },
  { accessorKey: 'userId', header: 'User' },
  { accessorKey: 'event', header: 'Event', cell: ({ row }) => <Badge variant="outline">{row.original.event}</Badge> },
  { accessorKey: 'contextId', header: 'Context ID' },
];
```

### What This Story Does NOT Include

- Backend API implementation (that is Story 11-8, must be completed first)
- Audit log write/create functionality (handled by TracerService from Story 11-7)
- Full diff library integration (simple formatted JSON display is sufficient)
- CLIENT role access to this page (sidebar restricts to ADMIN/SUPER_ADMIN; CLIENT users could access via direct URL but API enforces tenant isolation)

### Project Structure Notes

- Page: `apps/web/app/(protected)/dashboard/audit-logs/page.tsx`
- Client component: `apps/web/components/features/audit-logs/audit-logs-page-client.tsx`
- Detail sheet: `apps/web/components/features/audit-logs/audit-log-detail-sheet.tsx`
- API hook: `apps/web/hooks/use-audit-logs.ts`
- Sidebar: `apps/web/components/layout/sidebar.tsx` (MODIFY — add nav item)
- DataTable: `apps/web/components/ui/data-table/` (EXISTING — use as-is)

### Testing Approach

- **NO frontend unit tests** — manual testing only per project rules
- Manual test checklist:
  - Page loads with DataTable showing audit entries
  - Pagination works (page navigation, page size changes)
  - Event filter dropdown filters correctly
  - Search by contextId/userId works with debounce
  - Date range filter restricts results
  - Row click opens detail sheet with full JSON
  - CSV export downloads matching entries
  - CLIENT user sees only their org's logs (requires API to be running)
  - ADMIN/SUPER_ADMIN see all logs

### Dependencies

- **Depends on Story 11-8**: Audit Log Query API must be implemented first (provides the GET endpoints)
- **Depends on Story 11-6**: AuditLog Prisma model (already done)
- **Depends on Story 11-7**: Audit logging interceptor (already done — produces data to display)

### References

- FR126-FR128: Role-based audit log viewing
- `apps/web/app/(protected)/dashboard/analytics/page.tsx` — page route pattern
- `apps/web/components/features/analytics/analytics-page-client.tsx` — client component pattern
- `apps/web/components/features/analytics/date-range-filter.tsx` — date range filter component
- `apps/web/components/features/analytics/analytics-export-button.tsx` — export pattern
- `apps/web/components/ui/data-table/types.ts` — DataTable props and types
- `apps/web/components/layout/sidebar.tsx` — navigation configuration
- `_bmad-output/implementation-artifacts/11-8-audit-log-query-api.md` — API dependency

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
