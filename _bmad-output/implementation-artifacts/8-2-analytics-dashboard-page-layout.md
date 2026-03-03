# Story 8.2: Analytics Dashboard Page Layout

Status: ready-for-dev

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

- [ ] Task 1: Replace placeholder analytics page (AC: 1-8)
  - [ ] 1.1 Replace `apps/web/app/(protected)/dashboard/analytics/page.tsx` with full layout
  - [ ] 1.2 Create `apps/web/components/features/analytics/analytics-page-client.tsx` (client component)
  - [ ] 1.3 Implement page header with title "Analytics" and description
  - [ ] 1.4 Add filters bar: date range selector + agent filter + org filter (admin only)
  - [ ] 1.5 Add KPI cards section (placeholder grid, populated in story 8-3)
  - [ ] 1.6 Add charts section with 2-column grid layout (placeholders for 8-5, 8-6, 8-7)
  - [ ] 1.7 Add agent table section at bottom (placeholder for 8-8)
  - [ ] 1.8 Implement loading skeleton states for each section

- [ ] Task 2: Create analytics data hooks (AC: 1, 6)
  - [ ] 2.1 Create `apps/web/hooks/use-analytics.ts` with:
    - `useAnalyticsSummary(params)` — fetches `/analytics/summary`
    - `useConversationsChart(params)` — fetches `/analytics/charts/conversations`
    - `useResponseTimesChart(params)` — fetches `/analytics/charts/response-times`
    - `useMessageVolumeChart(params)` — fetches `/analytics/charts/message-volume`
    - `useAgentAnalytics(params)` — fetches `/analytics/agents`
  - [ ] 2.2 All hooks use React Query with `queryKey: ['analytics', subKey, params]`
  - [ ] 2.3 All hooks respect `enabled` flag (only fetch when auth ready)

- [ ] Task 3: Create analytics filter state (AC: 2-4, 7-8)
  - [ ] 3.1 Create filter state management in the page client component using `useState`
  - [ ] 3.2 Default date range: last 7 days
  - [ ] 3.3 Agent filter: dropdown populated from existing `useAgents()` hook
  - [ ] 3.4 Org filter: dropdown populated from organizations list (admin/super_admin only)
  - [ ] 3.5 Sync filter state to URL search params for shareability

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

### Debug Log References

### Completion Notes List

### File List
