# Story 12.14: Dashboard System Status Indicator

Status: ready-for-dev

## Story

As a **dashboard user**, I want to see a system status indicator in the sidebar, so that I know immediately if backend issues are affecting my experience.

## Acceptance Criteria

1. **Given** the user is on the dashboard, **When** the page loads, **Then** a small status indicator dot appears in the sidebar footer (above the user profile area).
2. **Given** the system is healthy, **When** `/health/ready` returns HTTP 200 with `status: "ok"`, **Then** the indicator shows a green dot with tooltip "All systems operational".
3. **Given** a system issue, **When** `/health/ready` returns HTTP 503 with `status: "degraded"`, **Then** the indicator shows a yellow/amber dot with tooltip "System experiencing issues".
4. **Given** the system is down, **When** `/health/ready` is unreachable (network error or non-JSON response), **Then** the indicator shows a red dot with tooltip "System issues detected".
5. **Given** the indicator is displayed, **When** clicked, **Then** a Popover shows detailed check results (e.g., database: ok, redis: ok/fail).
6. **Given** polling is active, **When** the dashboard is open, **Then** health status is re-fetched every 30 seconds automatically.
7. **Given** the health check, **When** it runs, **Then** it calls `/health/ready` at the API base URL root (NOT under `/api/codeweaves/v1/`), requiring no authentication.
8. **Given** NO frontend unit tests per project rules, **Then** no frontend tests are written; testing is manual only.

## Tasks / Subtasks

- [ ] **Task 1: Create `SystemStatusIndicator` client component** (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] Create `apps/web/components/system-status-indicator.tsx` as a `'use client'` component
  - [ ] Use `@tanstack/react-query` `useQuery` with `refetchInterval: 30000` to poll `{API_BASE_URL}/health/ready`
  - [ ] Fetch directly using `fetch()` (not the authenticated `apiUrl()` helper) since `/health/ready` is a public root-level endpoint
  - [ ] Map response to three states: `operational` (200 + status "ok"), `degraded` (503 + status "degraded"), `error` (fetch failure / unexpected response)
  - [ ] Render a colored dot (8px circle): green for operational, yellow/amber for degraded, red for error
  - [ ] Wrap the dot in a Shadcn `Tooltip` for hover text
  - [ ] Wrap the dot in a Shadcn `Popover` for click-to-expand detail view
  - [ ] In the Popover content, list each check from the response `checks` object with its status (e.g., "Database: OK", "Redis: Failed")

- [ ] **Task 2: Integrate indicator into the sidebar footer** (AC: #1)
  - [ ] Edit `apps/web/components/layout/sidebar.tsx`
  - [ ] Import `SystemStatusIndicator` component
  - [ ] Place the indicator inside `<SidebarFooter>` above the `<NavUser />` component
  - [ ] Ensure the indicator is styled to be unobtrusive and fits the collapsed sidebar state (icon-only mode via `group-data-[collapsible=icon]`)

- [ ] **Task 3: Manual testing** (AC: #1-#8)
  - [ ] Verify green dot when API is healthy
  - [ ] Verify yellow dot when API returns degraded (e.g., stop Redis locally)
  - [ ] Verify red dot when API is completely down (stop the API server)
  - [ ] Verify tooltip text on hover for each state
  - [ ] Verify popover shows individual check details on click
  - [ ] Verify polling updates every 30 seconds (watch network tab)
  - [ ] Verify the indicator looks correct in collapsed sidebar mode

## Dev Notes

### Architecture Compliance

This story implements the frontend portion of the health monitoring feature (architecture.md FR160). It depends on Stories 12-3 and 12-4 which create the `/health` and `/health/ready` backend endpoints. The `/health/ready` endpoint returns:

```json
{
  "status": "ok" | "degraded",
  "timestamp": "ISO string",
  "checks": {
    "database": { "status": "ok" | "fail", ... },
    "redis": { "status": "ok" | "fail", ... }
  }
}
```

HTTP 200 for "ok", HTTP 503 for "degraded".

### Existing Patterns to Follow

- **React Query is already in the project** — used extensively in `apps/web/hooks/` (e.g., `use-health-check.ts`, `use-agents.ts`, `use-analytics.ts`). The query provider is at `apps/web/providers/query-provider.tsx`. Use `useQuery` with `refetchInterval` for polling, matching the existing pattern.
- **Existing `useHealthCheck` hook** at `apps/web/hooks/use-health-check.ts` calls `/public/health` via `apiUrl()`. Do NOT reuse this hook because: (a) it hits the prefixed path, not the root `/health/ready`; (b) it does not poll at 30s intervals. Create a new hook or inline the query in the component.
- **API base URL** — Import `API_BASE_URL` from `@/config/api` and construct the URL as `${API_BASE_URL}/health/ready` (no prefix).
- **Shadcn Tooltip** — Already installed at `apps/web/components/ui/tooltip.tsx`.
- **Shadcn Popover** — Already installed at `apps/web/components/ui/popover.tsx`.
- **Sidebar structure** — `apps/web/components/layout/sidebar.tsx` exports `AppSidebar` which uses Shadcn sidebar primitives (`SidebarFooter`, `SidebarMenu`, etc.). The footer currently contains only `<NavUser />`. The status indicator should be placed above it in the footer.

### What This Story Does NOT Include

- **Backend health endpoints** — Those are implemented in Stories 12-3 and 12-4
- **Detailed system metrics or dashboards** — This is a simple indicator, not a full status page
- **Alerting or notifications** — The indicator is passive; it does not trigger alerts
- **Historical uptime tracking** — Only current status is shown
- **Backend tests** — No backend changes in this story

### Project Structure Notes

New files:
```
apps/web/components/system-status-indicator.tsx   # Client component with polling + display
```

Modified files:
```
apps/web/components/layout/sidebar.tsx            # Add SystemStatusIndicator to SidebarFooter
```

### Testing Approach

Per project rules, NO frontend unit tests. Manual testing only:
- Start the full stack locally, confirm green dot appears
- Stop Redis to trigger degraded state, confirm yellow dot
- Stop the API server entirely, confirm red dot
- Click the indicator to verify popover shows check details
- Observe network tab to confirm 30-second polling interval

### References

- `apps/web/components/layout/sidebar.tsx` — Sidebar with `SidebarFooter` where the indicator will be placed
- `apps/web/hooks/use-health-check.ts` — Existing health check hook (different endpoint, for reference only)
- `apps/web/config/api.ts` — `API_BASE_URL` export for constructing the root-level health URL
- `apps/web/components/ui/tooltip.tsx` — Shadcn Tooltip (already installed)
- `apps/web/components/ui/popover.tsx` — Shadcn Popover (already installed)
- `apps/web/providers/query-provider.tsx` — React Query provider (already configured)
- `_bmad-output/implementation-artifacts/12-3-health-check-endpoint-liveness.md` — Story 12-3 (liveness endpoint)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
