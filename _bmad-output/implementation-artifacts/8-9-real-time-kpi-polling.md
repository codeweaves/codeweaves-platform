# Story 8.9: Real-Time KPI Polling

Status: done

## Story

As an **agent owner**,
I want KPIs to update without page refresh,
So that I see current data while monitoring.

## Acceptance Criteria

1. **Given** the analytics page is open, **When** new data arrives, **Then** KPI values update every 60 seconds via polling
2. Update animation highlights changed values (brief color flash or number transition)
3. No full page reload required
4. Polling pauses when browser tab is inactive (using `document.visibilityState`)
5. Polling resumes when tab becomes active again
6. All chart and table data also refreshes on the same polling cycle

## Tasks / Subtasks

- [x] Task 1: Configure React Query polling (AC: 1, 3, 6)
  - [x] 1.1 Update `useAnalyticsSummary()` hook to accept `refetchInterval` option
  - [x] 1.2 Set `refetchInterval: 60_000` (60 seconds) on all analytics hooks
  - [x] 1.3 React Query handles background refetching automatically — data updates in place without remount

- [x] Task 2: Tab visibility handling (AC: 4-5)
  - [x] 2.1 Create `apps/web/hooks/use-tab-visible.ts` — returns boolean `isTabVisible`
  - [x] 2.2 Use `document.visibilityState` and `visibilitychange` event
  - [x] 2.3 Pass `refetchInterval: isTabVisible ? 60_000 : false` to all analytics hooks

- [x] Task 3: Value change animation (AC: 2)
  - [x] 3.1 In `KpiCard` component, detect when value changes (compare prev vs current via `useRef`)
  - [x] 3.2 Add brief CSS animation on value change: `animate-pulse` for 1 second or a green flash
  - [x] 3.3 Animation should be subtle — not distracting

## Dev Notes

### React Query refetchInterval

React Query has built-in polling support:

```tsx
// apps/web/hooks/use-analytics.ts
export function useAnalyticsSummary(params: AnalyticsParams, options?: { refetchInterval?: number | false }) {
  const api = useApiClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  return useQuery({
    queryKey: ['analytics', 'summary', params],
    queryFn: () => api.get(`/analytics/summary?${buildQueryString(params)}`),
    enabled: isAuthenticated && !authLoading,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
```

### Tab Visibility Hook

```tsx
// apps/web/hooks/use-tab-visible.ts
export function useTabVisible(): boolean {
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );

  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return isVisible;
}
```

### Usage in Analytics Page

```tsx
// In analytics-page-client.tsx
const isTabVisible = useTabVisible();
const refetchInterval = isTabVisible ? 60_000 : false;

const summary = useAnalyticsSummary(params, { refetchInterval });
const conversations = useConversationsChart(params, { refetchInterval });
// ... pass to all hooks
```

### Value Change Animation in KpiCard

```tsx
// In kpi-card.tsx
const prevValueRef = useRef(value);
const [isChanged, setIsChanged] = useState(false);

useEffect(() => {
  if (prevValueRef.current !== value) {
    setIsChanged(true);
    const timer = setTimeout(() => setIsChanged(false), 1000);
    prevValueRef.current = value;
    return () => clearTimeout(timer);
  }
}, [value]);

// Apply class
<span className={cn("text-2xl font-bold", isChanged && "animate-pulse text-green-600")}>
  {formattedValue}
</span>
```

### Project Structure Notes

- Modify: `apps/web/hooks/use-analytics.ts` — add refetchInterval support to all hooks
- New: `apps/web/hooks/use-tab-visible.ts`
- Modify: `apps/web/components/features/analytics/kpi-card.tsx` — add value change animation
- Modify: `apps/web/components/features/analytics/analytics-page-client.tsx` — wire up polling + tab visibility

### References

- [Source: apps/web/hooks/use-agents.ts] — React Query hook pattern
- [Source: 8-2-analytics-dashboard-page-layout.md] — Analytics page client component
- [Source: 8-3-kpi-summary-cards-component.md] — KpiCard component

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Lint fix: moved React hooks above early return in KpiCard to satisfy rules-of-hooks
- Type fix: explicit `number | false` annotation for refetchInterval ternary

### Completion Notes List
- Added `AnalyticsQueryOptions` interface with `refetchInterval` to all 5 analytics hooks
- Created `useTabVisible` hook using `document.visibilityState` API
- Wired 60s polling to all hooks, pausing when tab is inactive
- Added subtle green flash animation on KpiCard value changes via `transition-colors duration-700`
- AgentAnalyticsTable updated to accept and forward `pollingOptions`

### Code Review Fixes (2026-03-05)
- [H1] Fixed staleTime conflict: added `resolveStaleTime()` — returns 0 when polling is active, ANALYTICS_STALE_TIME otherwise
- [M1] Added `refetchIntervalInBackground: false` to all analytics hooks to prevent polling when window is blurred
- [M2] Added `hasMountedRef` guard in KpiCard to skip animation on initial data load (only animate polling updates)
- [M3] Added `aria-live="polite"` to KpiCard value element for screen reader accessibility

### File List
- Modified: `apps/web/hooks/use-analytics.ts`
- New: `apps/web/hooks/use-tab-visible.ts`
- Modified: `apps/web/components/features/analytics/kpi-card.tsx`
- Modified: `apps/web/components/features/analytics/analytics-page-client.tsx`
- Modified: `apps/web/components/features/analytics/agent-analytics-table.tsx`
