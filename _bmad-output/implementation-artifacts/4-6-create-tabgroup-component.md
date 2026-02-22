# Story 4.6: Create TabGroup Component

Status: done

## Story

As a **dashboard developer**,
I want a pill-style tab navigation component,
so that related theme settings within a category can be grouped and switched.

## Acceptance Criteria

1. **AC1:** TabGroup displays tabs as horizontal pill buttons
2. **AC2:** Active tab uses primary color highlight (blue-600 bg, white text)
3. **AC3:** Inactive tabs use muted styling (gray bg, dark text)
4. **AC4:** Tabs support optional icons (Lucide icons)
5. **AC5:** onChange callback returns selected tab id
6. **AC6:** Component is generic and reusable — not tied to specific theme categories
7. **AC7:** Tabs are keyboard accessible (arrow key navigation, Enter to select)

## Tasks / Subtasks

- [x] **Task 1: Build TabGroup Component** (AC: 1-7)
  - [x] 1.1 Create `apps/web/components/features/agents/agent-editor/tab-group.tsx`
  - [x] 1.2 Define `TabItem` interface: `{ id: string; label: string; icon?: React.ReactNode }`
  - [x] 1.3 Render horizontal row of pill buttons with gap-2
  - [x] 1.4 Style active tab: `bg-primary text-primary-foreground` rounded-full
  - [x] 1.5 Style inactive tabs: `bg-muted text-muted-foreground hover:bg-muted/80` rounded-full
  - [x] 1.6 Add `aria-selected` and `role="tab"` for accessibility
  - [x] 1.7 Support keyboard navigation (left/right arrows + Home/End)
  - [x] 1.8 Add `className` prop for container styling

## Dev Notes

### Component API

```tsx
interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabGroupProps {
  tabs: TabItem[];
  value: string;
  onChange: (tabId: string) => void;
  className?: string;
}
```

### Usage Example

```tsx
<TabGroup
  tabs={[
    { id: 'user', label: 'User Messages', icon: <User className="h-4 w-4" /> },
    { id: 'bot', label: 'Bot Messages', icon: <Bot className="h-4 w-4" /> },
  ]}
  value={activeTab}
  onChange={setActiveTab}
/>
```

### Implementation Pattern

```tsx
'use client';

import { cn } from '@/lib/utils';

export function TabGroup({ tabs, value, onChange, className }: TabGroupProps) {
  return (
    <div className={cn('flex gap-2', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            value === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

### Project Structure Notes

- Place in `apps/web/components/features/agents/agent-editor/tab-group.tsx`
- Used within Chat Appearance (4-9) to toggle between user/bot message settings
- Used within Behavior (4-10) for sub-sections
- Can be composed with FormSection for nested organization

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1536-1551] — Story 4.6 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — TabGroup spec

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Initial type check failed: `tabs[nextIndex]` possibly undefined — added guard with `const nextTab = tabs[nextIndex]; if (nextTab)`

### Completion Notes List
- Built TabGroup with pill-style buttons, role="tablist"/role="tab", aria-selected
- Active: bg-primary text-primary-foreground rounded-full
- Inactive: bg-muted text-muted-foreground hover:bg-muted/80 rounded-full
- Keyboard nav: ArrowLeft/Right (wrapping), Home/End, focus management via refs
- tabIndex roving (active=0, inactive=-1) for proper tab-key behavior
- Supports optional icons via React.ReactNode, className prop
- All validations pass: lint, check-types, build, test:cov (655 tests)
- **Code Review Fixes (2026-02-22):** 3 issues fixed
  - [MED] Exported TabItem and TabGroupProps interfaces for consumer typing (AC6)
  - [MED] tabsRef now sliced to tabs.length on change — prevents stale refs when tabs shrink
  - [LOW] Added aria-label prop forwarded to tablist container for screen reader context

### File List
- `apps/web/components/features/agents/agent-editor/tab-group.tsx` (new)
