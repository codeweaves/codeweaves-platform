# Story 8.7: Message Volume by Hour Heatmap

Status: done

## Story

As an **agent owner**,
I want to see when users are most active,
So that I can optimize agent availability.

## Acceptance Criteria

1. **Given** message data exists, **When** the heatmap renders, **Then** grid shows days (rows) vs hours (columns)
2. Cell color intensity reflects message volume (light = low, dark = high)
3. Hover shows exact count for each cell (e.g., "Tuesday 2pm: 42 messages")
4. Legend shows color scale (min to max)
5. Peak hours are visually highlighted (darkest cells)
6. Days are labeled: Mon, Tue, Wed, Thu, Fri, Sat, Sun
7. Hours are labeled: 12am, 1am, ... 11pm (or 0, 1, ... 23)
8. Empty state: "No message data for this period"
9. Loading state: skeleton placeholder
10. Chart spans full width (2-column span in the grid from story 8-2)

## Tasks / Subtasks

- [x] Task 1: Create heatmap component (AC: 1-10)
  - [x] 1.1 Create `apps/web/components/features/analytics/message-volume-heatmap.tsx`
  - [x] 1.2 Build a custom CSS grid heatmap (7 rows x 24 columns) — Recharts doesn't have a native heatmap
  - [x] 1.3 Calculate color intensity based on min/max values in the dataset
  - [x] 1.4 Use Tailwind classes or inline styles for cell background colors (blue/purple gradient)
  - [x] 1.5 Add hover tooltip using shadcn `Tooltip` component on each cell
  - [x] 1.6 Add day labels (rows) and hour labels (columns)
  - [x] 1.7 Add color scale legend
  - [x] 1.8 Handle empty data and loading states

## Dev Notes

### Why Custom Heatmap (Not Recharts)

Recharts doesn't have a built-in heatmap component. Options:
1. **Custom CSS grid** (recommended) — lightweight, full control, no extra dependencies
2. `recharts-heatmap` — small community package, not well maintained
3. D3.js — overkill for one component

CSS grid heatmap is the cleanest approach.

### Component Structure

```tsx
// apps/web/components/features/analytics/message-volume-heatmap.tsx
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getColorIntensity(value: number, max: number): string {
  if (max === 0) return 'bg-muted';
  const intensity = Math.round((value / max) * 5); // 0-5 levels
  const colors = [
    'bg-blue-50', 'bg-blue-100', 'bg-blue-200',
    'bg-blue-300', 'bg-blue-500', 'bg-blue-700'
  ];
  return colors[intensity] || colors[0];
}

export function MessageVolumeHeatmap({ params, className }: ChartProps) {
  const { data, isLoading } = useMessageVolumeChart(params);

  // Build lookup: { "1-14": 42 } (day 1, hour 14 = Monday 2pm)
  const volumeMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.data?.forEach(({ day, hour, count }) => map.set(`${day}-${hour}`, count));
    return map;
  }, [data]);

  const maxVolume = useMemo(() => Math.max(0, ...(data?.data?.map(d => d.count) ?? [])), [data]);

  return (
    <Card className={cn("lg:col-span-2", className)}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Message Volume by Hour</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {/* Hour labels */}
          <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-1">
            <div /> {/* empty corner */}
            {HOURS.map(h => (
              <div key={h} className="text-center text-xs text-muted-foreground">
                {h % 6 === 0 ? `${h}:00` : ''}
              </div>
            ))}
          </div>
          {/* Day rows */}
          {DAYS.map((day, dayIdx) => (
            <div key={day} className="grid grid-cols-[60px_repeat(24,1fr)] gap-1">
              <div className="text-xs text-muted-foreground flex items-center">{day}</div>
              {HOURS.map(hour => {
                const count = volumeMap.get(`${dayIdx + 1}-${hour}`) ?? 0;
                return (
                  <Tooltip key={hour}>
                    <TooltipTrigger>
                      <div className={cn("h-6 rounded-sm", getColorIntensity(count, maxVolume))} />
                    </TooltipTrigger>
                    <TooltipContent>{day} {hour}:00 — {count} messages</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-0.5">
            {['bg-blue-50','bg-blue-100','bg-blue-200','bg-blue-300','bg-blue-500','bg-blue-700'].map(c => (
              <div key={c} className={cn("h-3 w-3 rounded-sm", c)} />
            ))}
          </div>
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

### API Data Shape (from story 8-1)

```typescript
// GET /analytics/charts/message-volume
{
  data: [
    { day: 1, hour: 9, count: 42 },  // Monday 9am
    { day: 1, hour: 10, count: 58 }, // Monday 10am
    // day: 0=Sun, 1=Mon, ..., 6=Sat
    // hour: 0-23
  ]
}
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/message-volume-heatmap.tsx`
- Uses: `apps/web/hooks/use-analytics.ts` (`useMessageVolumeChart`)
- Uses: `apps/web/components/ui/card.tsx`, `tooltip.tsx`, `skeleton.tsx`
- No additional package installs needed

### References

- [Source: 8-1-analytics-api-endpoints.md] — /analytics/charts/message-volume response shape
- [Source: 8-2-analytics-dashboard-page-layout.md] — lg:col-span-2 placement in grid
- [Source: apps/web/components/ui/tooltip.tsx] — Tooltip component (already installed)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- Created message-volume-heatmap.tsx with custom CSS grid (7x24), blue intensity gradient, shadcn Tooltip on each cell, day/hour labels, legend
- Component uses lg:col-span-2 for full-width placement in grid
- Dark mode support via dual Tailwind classes (bg-blue-X dark:bg-blue-Y)
- All AC 1-10 satisfied

### File List
- apps/web/components/features/analytics/message-volume-heatmap.tsx (new)
- apps/web/components/features/analytics/analytics-page-client.tsx (modified)
- apps/web/hooks/use-analytics.ts (modified — staleTime added)

## Senior Developer Review (AI)

**Reviewer:** Code Review Workflow — 2026-03-04

### Issues Found & Fixed
1. **[HIGH] Day mapping off-by-one bug** — DAYS array started with Mon (index 0) but API uses day=0 for Sunday. Sunday data never rendered. Fixed: reordered DAYS to `['Sun','Mon',...,'Sat']` and changed lookup key from `dayIdx+1` to `dayIdx`.
2. **[MEDIUM] 168 Radix Tooltip instances** — Replaced 168 individual `<Tooltip>` components with a single state-driven floating tooltip using mouse events. Reduces DOM nodes from ~500+ to ~170.
3. **[MEDIUM] Missing staleTime on analytics queries** — Added `staleTime: 5 * 60 * 1000` to all analytics hooks in use-analytics.ts to match backend 5-min cache, reducing unnecessary re-fetches.
