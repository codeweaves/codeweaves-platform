# Story 8.6: Response Time Distribution Chart

Status: done

## Story

As an **agent owner**,
I want to see how fast my agents respond,
So that I can ensure good user experience.

## Acceptance Criteria

1. **Given** response time data exists, **When** the chart renders, **Then** a bar chart shows response time buckets
2. Buckets: <1s, 1-2s, 2-5s, 5-10s, >10s
3. Bars are color-coded (green to red gradient — fast is green, slow is red)
4. Percentage of responses in each bucket is shown as label on/above each bar
5. P50, P95, P99 values are displayed as annotations below the chart
6. Hover tooltip shows exact count and percentage for each bucket
7. Empty state: "No response time data for this period"
8. Loading state: skeleton placeholder

## Tasks / Subtasks

- [x] Task 1: Create response time chart component (AC: 1-8)
  - [x] 1.1 Create `apps/web/components/features/analytics/response-times-chart.tsx`
  - [x] 1.2 Use Recharts `<BarChart>` with `<Bar>` component
  - [x] 1.3 Color each bar based on bucket: <1s=green, 1-2s=lime, 2-5s=yellow, 5-10s=orange, >10s=red
  - [x] 1.4 Display percentage labels on top of each bar using Recharts `<LabelList>`
  - [x] 1.5 Display P50/P95/P99 as stat badges below the chart
  - [x] 1.6 Custom tooltip with count + percentage
  - [x] 1.7 Handle empty data and loading states

## Dev Notes

### Component Structure

```tsx
// apps/web/components/features/analytics/response-times-chart.tsx
const BUCKET_COLORS = {
  '<1s': '#22c55e',   // green-500
  '1-2s': '#84cc16',  // lime-500
  '2-5s': '#eab308',  // yellow-500
  '5-10s': '#f97316', // orange-500
  '>10s': '#ef4444',  // red-500
};

export function ResponseTimesChart({ params, className }: ChartProps) {
  const { data, isLoading } = useResponseTimesChart(params);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Response Time Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Bar chart */}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data?.buckets}>
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count">
              {data?.buckets?.map((entry, i) => (
                <Cell key={i} fill={BUCKET_COLORS[entry.label]} />
              ))}
              <LabelList dataKey="percentage" position="top" formatter={(v) => `${v}%`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Percentile badges */}
        <div className="mt-4 flex items-center gap-4">
          <Badge variant="outline">P50: {formatDuration(data?.percentiles?.p50)}</Badge>
          <Badge variant="outline">P95: {formatDuration(data?.percentiles?.p95)}</Badge>
          <Badge variant="outline">P99: {formatDuration(data?.percentiles?.p99)}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
```

### API Data Shape (from story 8-1)

```typescript
// GET /analytics/charts/response-times
{
  buckets: [
    { label: "<1s", min: 0, max: 1000, count: 450, percentage: 45.0 },
    { label: "1-2s", min: 1000, max: 2000, count: 300, percentage: 30.0 },
    { label: "2-5s", min: 2000, max: 5000, count: 150, percentage: 15.0 },
    { label: "5-10s", min: 5000, max: 10000, count: 80, percentage: 8.0 },
    { label: ">10s", min: 10000, max: null, count: 20, percentage: 2.0 },
  ],
  percentiles: { p50: 850, p95: 4200, p99: 8500 }
}
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/response-times-chart.tsx`
- Uses: `recharts` (installed in story 8-5)
- Uses: `apps/web/hooks/use-analytics.ts` (`useResponseTimesChart`)
- Uses: `apps/web/components/ui/card.tsx`, `badge.tsx`, `skeleton.tsx`
- Uses: `apps/web/lib/format-utils.ts` (`formatDuration` from story 8-3)

### References

- [Source: 8-1-analytics-api-endpoints.md] — /analytics/charts/response-times response shape
- [Source: 8-5-conversations-over-time-chart.md] — Recharts installation, chart component pattern

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed LabelList formatter type: Recharts `LabelFormatter` expects `RenderableText` param (includes null), not just `number`

### Completion Notes List
- Created response-times-chart.tsx with Recharts BarChart, color-coded bars per bucket, LabelList percentages, custom tooltip, P50/P95/P99 badges
- Replaced ChartPlaceholder in analytics-page-client.tsx with real component
- All AC 1-8 satisfied

### File List
- apps/web/components/features/analytics/response-times-chart.tsx (new)
- apps/web/components/features/analytics/analytics-page-client.tsx (modified)

## Senior Developer Review (AI)

**Reviewer:** Code Review Workflow — 2026-03-04

### Issues Found & Fixed
1. **[MEDIUM] Missing staleTime on analytics queries** — Fixed in shared use-analytics.ts (see story 8-7 review). Added `staleTime: 5 * 60 * 1000` to match backend 5-min cache.

### Notes
- Implementation is clean. All 8 ACs verified against actual code. Color coding, labels, tooltips, P50/P95/P99 badges, empty/loading/error states all present and correct.
