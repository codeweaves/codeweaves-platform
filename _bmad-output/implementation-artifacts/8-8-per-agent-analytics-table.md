# Story 8.8: Per-Agent Analytics Table

Status: ready-for-dev

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

- [ ] Task 1: Create agent analytics table component (AC: 1-7)
  - [ ] 1.1 Create `apps/web/components/features/analytics/agent-analytics-table.tsx`
  - [ ] 1.2 Use existing `DataTable` component from `apps/web/components/ui/data-table/`
  - [ ] 1.3 Define columns with `ColumnDef` from @tanstack/react-table
  - [ ] 1.4 Use `onFetch` callback pattern for server-side pagination/sorting
  - [ ] 1.5 Agent name column as clickable link to `/dashboard/agents/{agentId}`
  - [ ] 1.6 Format Avg Response Time with `formatDuration()` from `apps/web/lib/format-utils.ts`
  - [ ] 1.7 Format number columns with `formatNumber()`

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

### Debug Log References

### Completion Notes List

### File List
