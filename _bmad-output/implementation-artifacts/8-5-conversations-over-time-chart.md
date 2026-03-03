# Story 8.5: Conversations Over Time Chart

Status: ready-for-dev

## Story

As an **agent owner**,
I want to see conversation trends over time,
So that I can identify patterns and growth.

## Acceptance Criteria

1. **Given** the charts section loads, **When** data is available, **Then** a line chart shows conversations per day
2. X-axis shows dates (formatted as "Jan 15", "Jan 16", etc.)
3. Y-axis shows conversation count (auto-scaled)
4. Hover tooltip shows exact date and count value
5. Chart is responsive to container width
6. Empty state shows "No data for this period" message inside the chart card
7. Loading state shows a skeleton placeholder matching chart dimensions
8. Chart uses the project's color scheme (primary brand color for the line)

## Tasks / Subtasks

- [ ] Task 1: Install charting library (AC: 1)
  - [ ] 1.1 Install Recharts: `cd apps/web && bun add recharts`
  - [ ] 1.2 Recharts is built for React, works well with Next.js, lightweight, and has good TypeScript support

- [ ] Task 2: Create conversations chart component (AC: 1-8)
  - [ ] 2.1 Create `apps/web/components/features/analytics/conversations-chart.tsx`
  - [ ] 2.2 Wrap in `<Card>` with title "Conversations Over Time"
  - [ ] 2.3 Use Recharts `<ResponsiveContainer>` + `<LineChart>` + `<Line>` + `<XAxis>` + `<YAxis>` + `<Tooltip>`
  - [ ] 2.4 Format X-axis labels with date-fns `format(date, 'MMM d')`
  - [ ] 2.5 Custom tooltip showing full date and count
  - [ ] 2.6 Handle empty data: show centered "No data for this period" text
  - [ ] 2.7 Handle loading: show Skeleton inside card

## Dev Notes

### Why Recharts

No charting library is currently installed. Recharts is the recommended choice because:
- Built specifically for React (composable components)
- Good TypeScript support
- Responsive by default with `<ResponsiveContainer>`
- Lightweight compared to D3-based alternatives
- Widely used with Next.js projects

### Component Structure

```tsx
// apps/web/components/features/analytics/conversations-chart.tsx
interface ConversationsChartProps {
  params: AnalyticsParams;
  className?: string;
}

export function ConversationsChart({ params, className }: ConversationsChartProps) {
  const { data, isLoading } = useConversationsChart(params);

  if (isLoading) return <ChartSkeleton className={className} />;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Conversations Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        {!data?.data?.length ? (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.data}>
              <XAxis dataKey="date" tickFormatter={(d) => format(new Date(d), 'MMM d')} />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

### API Data Shape (from story 8-1)

```typescript
// GET /analytics/charts/conversations
{ data: [{ date: "2026-01-15", count: 42 }, { date: "2026-01-16", count: 38 }, ...] }
```

### Project Structure Notes

- Install: `recharts` package in `apps/web`
- New: `apps/web/components/features/analytics/conversations-chart.tsx`
- Uses: `apps/web/hooks/use-analytics.ts` (`useConversationsChart`)
- Uses: `apps/web/components/ui/card.tsx`, `skeleton.tsx`

### References

- [Source: 8-1-analytics-api-endpoints.md] — /analytics/charts/conversations response shape
- [Source: 8-2-analytics-dashboard-page-layout.md] — Chart placement in grid layout
- [Source: apps/web/components/ui/card.tsx] — Card wrapper component

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
