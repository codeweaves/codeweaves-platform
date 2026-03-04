# Story 8.8: Per-Agent Analytics Table

Status: done

## Story

As an **agent owner**,
I want to compare performance across my agents,
So that I can identify which agents need improvement.

## Acceptance Criteria

1. **Given** I have multiple agents, **When** the agent table loads, **Then** table shows one row per agent
2. Columns: Agent Name, Conversations, Messages, Avg Response Time, Queries Raised
3. Table is sortable by any column (click column header to sort)
4. Clicking agent name navigates to agent detail page (`/dashboard/agents/{agentId}`)
5. Pagination handles >10 agents (server-side pagination)
6. Loading state shows table skeleton
7. Empty state: "No agent data for this period"

## Tasks / Subtasks

- [x] Task 1: Create agent analytics table component (AC: 1-7)
  - [x] 1.1 Create `apps/web/components/features/analytics/agent-analytics-table.tsx`
  - [x] 1.2 Use existing `DataTable` component from `apps/web/components/ui/data-table/`
  - [x] 1.3 Define columns with `ColumnDef` from @tanstack/react-table
  - [x] 1.4 Use `onFetch` callback pattern for server-side pagination/sorting
  - [x] 1.5 Agent name column as clickable link to `/dashboard/agents/{agentId}`
  - [x] 1.6 Format Avg Response Time with `formatDuration()` from `apps/web/lib/format-utils.ts`
  - [x] 1.7 Format number columns with `formatNumber()`

## Dev Notes

### Reusing DataTable Component

The project already has a sophisticated `DataTable` component at `apps/web/components/ui/data-table/`. Use it with the `onFetch` callback pattern — same as `AgentsDataTable`:

```tsx
// apps/web/components/features/analytics/agent-analytics-table.tsx
export function AgentAnalyticsTable({ params }: { params: AnalyticsParams }) {
  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 1, pageSize: 10, sorting: [], search: '', filters: {}
  });

  const queryParams = {
    ...params,
    page: fetchParams.page,
    limit: fetchParams.pageSize,
    sortBy: fetchParams.sorting[0]?.id ?? 'conversations',
    sortOrder: fetchParams.sorting[0]?.desc ? 'desc' : 'asc',
  };

  const { data, isLoading } = useAgentAnalytics(queryParams);

  const columns: ColumnDef<AgentMetrics>[] = [
    {
      accessorKey: 'agentName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Agent" />,
      cell: ({ row }) => (
        <Link href={`/dashboard/agents/${row.original.agentId}`} className="text-primary hover:underline">
          {row.original.agentName}
        </Link>
      ),
    },
    {
      accessorKey: 'conversations',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Conversations" />,
      cell: ({ row }) => formatNumber(row.original.conversations),
    },
    {
      accessorKey: 'messages',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Messages" />,
      cell: ({ row }) => formatNumber(row.original.messages),
    },
    {
      accessorKey: 'avgResponseTimeMs',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Avg Response" />,
      cell: ({ row }) => formatDuration(row.original.avgResponseTimeMs),
    },
    {
      accessorKey: 'queriesRaised',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Queries" />,
      cell: ({ row }) => formatNumber(row.original.queriesRaised),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Per-Agent Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pageCount={data?.meta?.totalPages ?? 0}
          totalItems={data?.meta?.total ?? 0}
          onFetch={setFetchParams}
          initialPageSize={10}
          pageSizeOptions={[5, 10, 50]}
          isLoading={isLoading}
        />
      </CardContent>
    </Card>
  );
}
```

### API Data Shape (from story 8-1)

```typescript
// GET /analytics/agents
{
  data: [
    { agentId: "uuid", agentName: "Sales Bot", conversations: 1240, messages: 8420, avgResponseTimeMs: 1350, queriesRaised: 4210 },
    { agentId: "uuid", agentName: "Support Bot", conversations: 890, messages: 5630, avgResponseTimeMs: 2100, queriesRaised: 2815 },
  ],
  meta: { page: 1, limit: 10, total: 5, totalPages: 1 }
}
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/agent-analytics-table.tsx`
- Uses: `apps/web/components/ui/data-table/data-table.tsx` — existing DataTable with onFetch pattern
- Uses: `apps/web/hooks/use-analytics.ts` (`useAgentAnalytics`)
- Uses: `apps/web/lib/format-utils.ts` (`formatNumber`, `formatDuration`)
- Uses: `apps/web/components/ui/card.tsx`

### References

- [Source: apps/web/components/ui/data-table/data-table.tsx] — DataTable component with onFetch API
- [Source: apps/web/components/features/agents/agents-data-table.tsx] — Example DataTable usage with onFetch
- [Source: 8-1-analytics-api-endpoints.md] — /analytics/agents response shape
- [Source: 8-3-kpi-summary-cards-component.md] — formatNumber, formatDuration utilities

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- Created agent-analytics-table.tsx using existing DataTable with onFetch pattern
- 5 columns: Agent (link), Conversations, Messages, Avg Response, Queries — all sortable via DataTableColumnHeader
- Server-side pagination with page sizes [5, 10, 50]
- Replaced placeholder in analytics-page-client.tsx; removed unused useAgentAnalytics import from page
- All AC 1-7 satisfied

### File List
- apps/web/components/features/analytics/agent-analytics-table.tsx (new)
- apps/web/components/features/analytics/analytics-page-client.tsx (modified)

## Senior Developer Review (AI)

**Reviewer:** Code Review Workflow — 2026-03-04

### Issues Found & Fixed
1. **[HIGH] No page reset on filter change** — When parent params (date range, agentId, orgId) changed, the table stayed on the current page instead of resetting to page 0. Fixed: added useEffect with ref to detect param changes and reset page.
2. **[HIGH] No error state handling** — The component only passed `isLoading` to DataTable but silently swallowed API errors. Fixed: added `isError` destructure from useAgentAnalytics and error UI with AlertCircle icon.
3. **[MEDIUM] Missing staleTime** — Fixed in shared use-analytics.ts (see story 8-7 review).
