# Story 8.9: Real-Time KPI Polling

Status: ready-for-dev

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

- [ ] Task 1: Configure React Query polling (AC: 1, 3, 6)
  - [ ] 1.1 Update `useAnalyticsSummary()` hook to accept `refetchInterval` option
  - [ ] 1.2 Set `refetchInterval: 60_000` (60 seconds) on all analytics hooks
  - [ ] 1.3 React Query handles background refetching automatically — data updates in place without remount

- [ ] Task 2: Tab visibility handling (AC: 4-5)
  - [ ] 2.1 Create `apps/web/hooks/use-tab-visible.ts` — returns boolean `isTabVisible`
  - [ ] 2.2 Use `document.visibilityState` and `visibilitychange` event
  - [ ] 2.3 Pass `refetchInterval: isTabVisible ? 60_000 : false` to all analytics hooks

- [ ] Task 3: Value change animation (AC: 2)
  - [ ] 3.1 In `KpiCard` component, detect when value changes (compare prev vs current via `useRef`)
  - [ ] 3.2 Add brief CSS animation on value change: `animate-pulse` for 1 second or a green flash
  - [ ] 3.3 Animation should be subtle — not distracting

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

### Debug Log References

### Completion Notes List

### File List
