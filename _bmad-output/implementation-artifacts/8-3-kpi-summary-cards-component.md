# Story 8.3: KPI Summary Cards Component

Status: done

## Story

As an **agent owner**,
I want to see key metrics at a glance,
So that I quickly understand my overall performance.

## Acceptance Criteria

1. **Given** the analytics page loads, **When** KPI data is available, **Then** 6 primary KPI cards are displayed
2. Cards show: Total Users, Total Conversations, Total Messages, Avg Response Time, User Retention Rate, User Growth Rate
3. Each card displays: metric name, current value, trend indicator (% change vs previous period)
4. Positive trends are green with up arrow, negative are red with down arrow, zero/neutral is gray
5. For Avg Response Time, a DECREASE is positive (green) — faster is better
6. Cards are responsive: 3x2 grid on desktop, 2x3 on tablet, 1x6 on mobile
7. Loading state shows 6 skeleton cards matching the same grid
8. Values are formatted: numbers with commas, percentages with %, milliseconds with "ms" suffix

## Tasks / Subtasks

- [x] Task 1: Create KPI card component (AC: 2-5, 8)
  - [x] 1.1 Create `apps/web/components/features/analytics/kpi-card.tsx`
  - [x] 1.2 Props: `title`, `value`, `formattedValue`, `trend` (% number), `trendInverted` (for response time), `icon`, `isLoading`
  - [x] 1.3 Display trend with `TrendingUp`/`TrendingDown` icons from lucide-react
  - [x] 1.4 Color logic: positive trend = green, negative = red, handle `trendInverted` for response time
  - [x] 1.5 Format values: `formatNumber()`, `formatPercentage()`, `formatDuration()`

- [x] Task 2: Create KPI summary cards container (AC: 1, 6-7)
  - [x] 2.1 Create `apps/web/components/features/analytics/kpi-summary-cards.tsx`
  - [x] 2.2 Consume `useAnalyticsSummary(params)` hook from story 8-2
  - [x] 2.3 Map API response to 6 KPI cards with correct formatting
  - [x] 2.4 Implement responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
  - [x] 2.5 Show skeleton grid when loading

## Dev Notes

### KPI Card Design

```tsx
// apps/web/components/features/analytics/kpi-card.tsx
interface KpiCardProps {
  title: string;
  value: string; // pre-formatted value
  trend?: number; // % change, e.g., 12.5 or -3.2
  trendInverted?: boolean; // true = decrease is good (response time)
  icon: LucideIcon;
  isLoading?: boolean;
}
```

Use `<Card>` from shadcn with:
- Icon + title in card header
- Large value display
- Trend badge below value

### 6 KPI Cards Mapping

| Card | API field | Format | Icon | Trend Inverted |
|------|-----------|--------|------|----------------|
| Total Users | `kpis.totalUsers` | `formatNumber()` | Users | No |
| Total Conversations | `kpis.totalConversations` | `formatNumber()` | MessageSquare | No |
| Total Messages | `kpis.totalMessagesExchanged` | `formatNumber()` | MessagesSquare | No |
| Avg Response Time | `kpis.avgResponseTimeMs` | `formatDuration()` | Clock | **Yes** |
| User Retention | `kpis.userRetentionRate` | `formatPercentage()` | UserCheck | No |
| User Growth | `kpis.userGrowthRate` | `formatPercentage()` | TrendingUp | No |

### Value Formatting Utilities

Create `apps/web/lib/format-utils.ts`:
```typescript
export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatPercentage(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

### Project Structure Notes

- New: `apps/web/components/features/analytics/kpi-card.tsx`
- New: `apps/web/components/features/analytics/kpi-summary-cards.tsx`
- New: `apps/web/lib/format-utils.ts`
- Uses: `apps/web/hooks/use-analytics.ts` (from story 8-2)
- Uses: `apps/web/components/ui/card.tsx`, `apps/web/components/ui/skeleton.tsx`

### References

- [Source: apps/web/components/ui/card.tsx] — Card component with CardHeader, CardTitle, CardContent
- [Source: apps/web/components/ui/skeleton.tsx] — Skeleton for loading states
- [Source: 8-1-analytics-api-endpoints.md] — Response shape for /analytics/summary

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A

### Completion Notes List
- Created `format-utils.ts` with `formatNumber`, `formatPercentage`, `formatDuration`
- Created `kpi-card.tsx` with trend indicators (green/red/neutral), `trendInverted` support, loading skeleton
- Created `kpi-summary-cards.tsx` mapping 6 KPIs with responsive 1/2/3 column grid
- Replaced inline KpiCard placeholder in analytics-page-client.tsx with KpiSummaryCards component
- Updated page skeleton to match new 6-card grid layout

### File List
- New: `apps/web/lib/format-utils.ts`
- New: `apps/web/components/features/analytics/kpi-card.tsx`
- New: `apps/web/components/features/analytics/kpi-summary-cards.tsx`
- Modified: `apps/web/components/features/analytics/analytics-page-client.tsx`
