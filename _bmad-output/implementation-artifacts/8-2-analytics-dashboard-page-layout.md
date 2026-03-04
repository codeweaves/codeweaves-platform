# Story 8.2: Analytics Dashboard Page Layout

Status: done

## Story

As an **agent owner**,
I want a dedicated analytics page in the dashboard,
So that I can view all my chat performance metrics.

## Acceptance Criteria

1. **Given** I navigate to the Analytics page (`/dashboard/analytics`), **When** the page loads, **Then** page displays KPI summary cards section at the top
2. Date range selector is visible below the page header (7/14/30 days + custom)
3. Agent filter dropdown allows scoping to a specific bot
4. Charts section shows below the filters (placeholder slots for stories 8-5, 8-6, 8-7)
5. Agent breakdown table is shown at the bottom (placeholder slot for story 8-8)
6. Loading skeletons are shown while data fetches
7. Super Admin/Admin users see an organization filter dropdown
8. Client users see only their org's data (no org filter shown)
9. Analytics route is already in the sidebar navigation (already exists as `BarChart3` icon)

## Tasks / Subtasks

- [x] Task 1: Replace placeholder analytics page (AC: 1-8)
  - [x] 1.1 Replace `apps/web/app/(protected)/dashboard/analytics/page.tsx` with full layout
  - [x] 1.2 Create `apps/web/components/features/analytics/analytics-page-client.tsx` (client component)
  - [x] 1.3 Implement page header with title "Analytics" and description
  - [x] 1.4 Add filters bar: date range selector + agent filter + org filter (admin only)
  - [x] 1.5 Add KPI cards section (placeholder grid, populated in story 8-3)
  - [x] 1.6 Add charts section with 2-column grid layout (placeholders for 8-5, 8-6, 8-7)
  - [x] 1.7 Add agent table section at bottom (placeholder for 8-8)
  - [x] 1.8 Implement loading skeleton states for each section

- [x] Task 2: Create analytics data hooks (AC: 1, 6)
  - [x] 2.1 Create `apps/web/hooks/use-analytics.ts` with:
    - `useAnalyticsSummary(params)` — fetches `/analytics/summary`
    - `useConversationsChart(params)` — fetches `/analytics/charts/conversations`
    - `useResponseTimesChart(params)` — fetches `/analytics/charts/response-times`
    - `useMessageVolumeChart(params)` — fetches `/analytics/charts/message-volume`
    - `useAgentAnalytics(params)` — fetches `/analytics/agents`
  - [x] 2.2 All hooks use React Query with `queryKey: ['analytics', subKey, params]`
  - [x] 2.3 All hooks respect `enabled` flag (only fetch when auth ready)

- [x] Task 3: Create analytics filter state (AC: 2-4, 7-8)
  - [x] 3.1 Create filter state management in the page client component using `useState`
  - [x] 3.2 Default date range: last 7 days
  - [x] 3.3 Agent filter: dropdown populated from existing `useAgents()` hook
  - [x] 3.4 Org filter: dropdown populated from organizations list (admin/super_admin only)
  - [x] 3.5 Sync filter state to URL search params for shareability

## Dev Notes

### Page Layout Structure

```tsx
// apps/web/app/(protected)/dashboard/analytics/page.tsx
export default function AnalyticsPage() {
  return <AnalyticsPageClient />;
}

// apps/web/components/features/analytics/analytics-page-client.tsx
'use client';
export function AnalyticsPageClient() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  // Filter state
  const [dateRange, setDateRange] = useState({ start: subDays(new Date(), 7), end: new Date() });
  const [agentId, setAgentId] = useState<string | undefined>();
  const [orgId, setOrgId] = useState<string | undefined>();

  // Query params for all analytics hooks
  const params = { startDate: dateRange.start, endDate: dateRange.end, agentId, orgId };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">View performance metrics across your agents.</p>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-4">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <AgentFilter value={agentId} onChange={setAgentId} />
        {isAdmin && <OrgFilter value={orgId} onChange={setOrgId} />}
      </div>

      {/* KPI Cards (Story 8-3) */}
      <section>
        <KpiSummaryCards params={params} />
      </section>

      {/* Charts Grid (Stories 8-5, 8-6, 8-7) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ConversationsChart params={params} />
        <ResponseTimesChart params={params} />
        <MessageVolumeHeatmap params={params} className="lg:col-span-2" />
      </div>

      {/* Agent Table (Story 8-8) */}
      <section>
        <AgentAnalyticsTable params={params} />
      </section>
    </div>
  );
}
```

### Existing Patterns to Follow

- Page pattern: `apps/web/app/(protected)/dashboard/agents/page.tsx` — client component with role checks
- Hooks pattern: `apps/web/hooks/use-agents.ts` — React Query + `useApiClient()`
- API client: `apps/web/lib/api-client.ts` — `api.get()` with Auth0 token injection
- Loading: Use `<Skeleton />` from `apps/web/components/ui/skeleton.tsx`
- Cards: Use `<Card>` from `apps/web/components/ui/card.tsx`

### Analytics Route

The sidebar already has the Analytics nav item at `apps/web/components/layout/sidebar.tsx`:
```tsx
{ name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: 'all' },
```

No sidebar changes needed.

### Project Structure Notes

- Replace: `apps/web/app/(protected)/dashboard/analytics/page.tsx`
- New: `apps/web/components/features/analytics/analytics-page-client.tsx`
- New: `apps/web/hooks/use-analytics.ts`
- Existing: sidebar.tsx already has Analytics route

### References

- [Source: apps/web/app/(protected)/dashboard/agents/page.tsx] — Page layout pattern
- [Source: apps/web/hooks/use-agents.ts] — React Query hook pattern
- [Source: apps/web/lib/api-client.ts] — API client usage
- [Source: apps/web/components/layout/sidebar.tsx] — Analytics nav item already exists
- [Source: apps/web/components/ui/card.tsx] — Card component
- [Source: apps/web/components/ui/skeleton.tsx] — Skeleton loading component

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed TS error: `split('T')[0]` returns `string | undefined` in strict mode — replaced with `.slice(0, 10)`

### Completion Notes List
- Task 1: Replaced placeholder analytics page with full layout. Server component wraps client component in Suspense (for useSearchParams). Client component renders header, filters bar, KPI cards grid (4-col), charts grid (2-col with full-width heatmap), and agent breakdown table card. Full-page skeleton shown during profile load; per-section skeletons shown during data fetches.
- Task 2: Created `use-analytics.ts` with 5 React Query hooks matching all API endpoints. Each hook uses `queryKey: ['analytics', subKey, params]` pattern and `enabled: isAuthenticated && !authLoading`. Shared `buildQueryString` helper for DRY param serialization.
- Task 3: Filter state managed via `useState` in client component. Date range defaults to 7 days. Agent filter populated from `useAgents()`, org filter from `useOrganizations()` (admin-only). All filters synced to URL search params via `useEffect` + `router.replace()` for shareability. Filters initialized from URL on mount.
- Code Review Fixes (6 issues resolved):
  - H1: Fixed AnalyticsSummary interface — matched nested `{ period, kpis: { totalConversations: { value, trend } } }` API shape
  - H2: Fixed all chart/agent hook response types to match API wrapper objects (`{ data: [...] }`, `{ buckets: [...] }`)
  - H3: Documented useOrganizations 403 for CLIENT users — React Query handles silently, data guarded by isAdmin check
  - M1: Fixed router.replace render loop — used `useRef` for stable router reference, removed `router` from useCallback deps
  - M2: Added error banner for failed analytics queries with AlertCircle icon
  - M3: Fixed UTC vs local timezone off-by-one — replaced `toISOString().slice(0,10)` with local date formatting, appended `T00:00:00` to date input parsing
- Deferred LOW issues (2):
  - L1: Custom date inputs use raw `<input type="date">` instead of Shadcn-styled component — story 8-4 (Date Range Filter Component) will replace these
  - L2: Agent filter dropdown hardcodes `limit: 100` — if an org has 101+ agents, not all shown. Add search-as-you-type if needed later

### File List
- `apps/web/app/(protected)/dashboard/analytics/page.tsx` (modified)
- `apps/web/components/features/analytics/analytics-page-client.tsx` (new)
- `apps/web/hooks/use-analytics.ts` (new)

### Change Log
- 2026-03-04: Story 8-2 implemented — analytics dashboard page layout with filters, hooks, and skeleton loading states
- 2026-03-04: Code review — fixed 3 HIGH + 3 MEDIUM issues (type mismatches, render loop, error states, timezone bug)
