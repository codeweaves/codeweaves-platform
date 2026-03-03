# Story 8.4: Date Range Filter Component

Status: ready-for-dev

## Story

As an **agent owner**,
I want to filter analytics by date range,
So that I can analyze specific time periods.

## Acceptance Criteria

1. **Given** the date range selector is visible, **When** I select a preset (7/14/30 days), **Then** all KPIs and charts update to reflect the selected range
2. "Last 7 days" is the default selection
3. Preset buttons: "7D", "14D", "30D", "Custom"
4. Custom date range picker allows selecting arbitrary start/end dates
5. Selected range persists during session (maintained in page state)
6. URL updates with `startDate` and `endDate` search params for shareability
7. Date picker does not allow selecting future dates
8. Date picker does not allow selecting a range longer than 365 days

## Tasks / Subtasks

- [ ] Task 1: Create date range filter component (AC: 1-8)
  - [ ] 1.1 Create `apps/web/components/features/analytics/date-range-filter.tsx`
  - [ ] 1.2 Implement preset buttons (7D, 14D, 30D) as toggle group
  - [ ] 1.3 Implement "Custom" option that reveals a date picker popover
  - [ ] 1.4 Use shadcn `Popover` + calendar for custom date picking (install `calendar` component if not present)
  - [ ] 1.5 Validate: no future dates, max 365-day range
  - [ ] 1.6 Call `onChange` callback with `{ start: Date, end: Date }` on selection

- [ ] Task 2: Install required shadcn components (AC: 4)
  - [ ] 2.1 Check if `calendar` and `popover` components exist
  - [ ] 2.2 Install missing: `BUN_CONFIG_IGNORE_SCRIPTS=true bunx shadcn@latest add calendar --yes` (if needed)
  - [ ] 2.3 Install `date-fns` if not already a dependency (for date math: subDays, format, etc.)

- [ ] Task 3: URL sync (AC: 6)
  - [ ] 3.1 Sync date range state to URL search params using `useSearchParams()` from Next.js
  - [ ] 3.2 On page load, read `startDate`/`endDate` from URL if present, otherwise default to 7 days

## Dev Notes

### Component API

```tsx
interface DateRangeFilterProps {
  value: { start: Date; end: Date };
  onChange: (range: { start: Date; end: Date }) => void;
}
```

### Preset Button Layout

```tsx
<div className="flex items-center gap-2">
  <Button variant={isPreset(7) ? "default" : "outline"} size="sm" onClick={() => setPreset(7)}>7D</Button>
  <Button variant={isPreset(14) ? "default" : "outline"} size="sm" onClick={() => setPreset(14)}>14D</Button>
  <Button variant={isPreset(30) ? "default" : "outline"} size="sm" onClick={() => setPreset(30)}>30D</Button>
  <Popover>
    <PopoverTrigger asChild>
      <Button variant={isCustom ? "default" : "outline"} size="sm">
        <CalendarIcon className="mr-2 h-4 w-4" />
        Custom
      </Button>
    </PopoverTrigger>
    <PopoverContent>
      {/* Date range picker */}
    </PopoverContent>
  </Popover>
</div>
```

### Date-fns Usage

Check if `date-fns` is already in `apps/web/package.json`. If not, install it:
```bash
cd apps/web && bun add date-fns
```

Key functions: `subDays`, `startOfDay`, `endOfDay`, `format`, `isAfter`, `isBefore`, `differenceInDays`.

### Project Structure Notes

- New: `apps/web/components/features/analytics/date-range-filter.tsx`
- May install: shadcn `calendar` component
- May install: `date-fns` package
- Uses: `apps/web/components/ui/button.tsx`, `popover.tsx`

### References

- [Source: apps/web/components/ui/popover.tsx] — Popover component (already installed)
- [Source: apps/web/components/ui/button.tsx] — Button variants

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
