# Story 8.10: Analytics Empty State

Status: ready-for-dev

## Story

As a **new user**,
I want helpful guidance when I have no analytics data,
So that I understand how to get started.

## Acceptance Criteria

1. **Given** no analytics data exists for the selected period, **When** the analytics page loads, **Then** an empty state illustration/icon is shown
2. Message explains "No analytics data yet" with a helpful subtitle
3. Link/button to create first agent is provided (if user has no agents)
4. If user has agents but no data in the date range, message says "No data for the selected period — try expanding the date range"
5. Sample/demo data preview is NOT shown (avoid confusion with real data)
6. Empty state replaces the entire content area (KPIs, charts, table) — not shown per-component

## Tasks / Subtasks

- [ ] Task 1: Create analytics empty state component (AC: 1-6)
  - [ ] 1.1 Create `apps/web/components/features/analytics/analytics-empty-state.tsx`
  - [ ] 1.2 Use lucide-react `BarChart3` or `LineChart` icon as illustration (large, muted)
  - [ ] 1.3 Implement two variants:
    - No agents: "Create your first agent to start collecting analytics" + CTA button
    - No data in range: "No data for the selected period" + suggestion to expand range
  - [ ] 1.4 CTA button links to `/dashboard/agents` (create agent page)

- [ ] Task 2: Integrate empty state into analytics page (AC: 6)
  - [ ] 2.1 In `analytics-page-client.tsx`, check if summary data is empty (all KPIs are 0 or null)
  - [ ] 2.2 If empty, render `<AnalyticsEmptyState />` instead of KPIs/charts/table
  - [ ] 2.3 Keep the filter bar visible above the empty state (so user can change date range)

## Dev Notes

### Component Structure

```tsx
// apps/web/components/features/analytics/analytics-empty-state.tsx
interface AnalyticsEmptyStateProps {
  hasAgents: boolean;
}

export function AnalyticsEmptyState({ hasAgents }: AnalyticsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BarChart3 className="h-16 w-16 text-muted-foreground/40" />
      <h2 className="mt-4 text-lg font-semibold">
        {hasAgents ? 'No data for the selected period' : 'No analytics data yet'}
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {hasAgents
          ? 'Try expanding the date range or wait for more conversations to come in.'
          : 'Create your first agent and start chatting to see analytics here.'}
      </p>
      {!hasAgents && (
        <Button asChild className="mt-6">
          <Link href="/dashboard/agents">Create Agent</Link>
        </Button>
      )}
    </div>
  );
}
```

### Integration in Analytics Page

```tsx
// In analytics-page-client.tsx
const { data: summary, isLoading } = useAnalyticsSummary(params);
const { data: agents } = useAgents({ limit: 1 }); // Just check if any agents exist

const hasAgents = (agents?.meta?.total ?? 0) > 0;
const hasData = summary && summary.kpis.totalConversations.value > 0;

return (
  <div className="space-y-6">
    {/* Header + Filters always visible */}
    ...

    {isLoading ? (
      <AnalyticsSkeleton />
    ) : !hasData ? (
      <AnalyticsEmptyState hasAgents={hasAgents} />
    ) : (
      <>
        <KpiSummaryCards ... />
        <Charts ... />
        <AgentTable ... />
      </>
    )}
  </div>
);
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/analytics-empty-state.tsx`
- Modify: `apps/web/components/features/analytics/analytics-page-client.tsx` — add empty state logic
- Uses: `apps/web/components/ui/button.tsx`, lucide-react icons
- Uses: `apps/web/hooks/use-agents.ts` (to check if agents exist)

### References

- [Source: apps/web/app/(protected)/dashboard/analytics/page.tsx] — Current placeholder page
- [Source: 8-2-analytics-dashboard-page-layout.md] — Analytics page layout structure
- [Source: apps/web/components/ui/button.tsx] — Button component

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
