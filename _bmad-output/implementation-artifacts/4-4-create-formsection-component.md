# Story 4.4: Create FormSection Component

Status: done

## Story

As a **dashboard developer**,
I want a reusable, collapsible form section component,
so that theme settings are organized consistently across all editor categories.

## Acceptance Criteria

1. **AC1:** FormSection accepts `title`, `description` (optional), and `children` props
2. **AC2:** Sections are collapsible with a chevron toggle — expanded by default
3. **AC3:** Collapse/expand has smooth animation (200ms transition)
4. **AC4:** Title renders as bold heading, description as muted subtext
5. **AC5:** Children rendered in consistent vertical spacing (space-y-4)
6. **AC6:** Component uses Shadcn Collapsible primitive under the hood
7. **AC7:** Optional `defaultOpen` prop (defaults to `true`)

## Tasks / Subtasks

- [x] **Task 1: Install Shadcn Collapsible** (AC: 6)
  - [x] 1.1 Run `bunx shadcn@latest add collapsible`

- [x] **Task 2: Build FormSection Component** (AC: 1-7)
  - [x] 2.1 Create `apps/web/components/features/agents/agent-editor/form-section.tsx`
  - [x] 2.2 Use Shadcn `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`
  - [x] 2.3 Add chevron icon (ChevronDown from lucide) that rotates on collapse
  - [x] 2.4 Style title as `text-base font-semibold`, description as `text-sm text-muted-foreground`
  - [x] 2.5 Wrap children in `space-y-4` container
  - [x] 2.6 Add `defaultOpen` prop, default `true`
  - [x] 2.7 Add `className` prop for custom container styling

## Dev Notes

### Component API

```tsx
interface FormSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}
```

### Usage Example

```tsx
<FormSection title="Icon Settings" description="Customize the widget launcher icon">
  <div className="grid grid-cols-3 items-center gap-4">
    <Label>Position</Label>
    <Select ... />
  </div>
  <div className="grid grid-cols-3 items-center gap-4">
    <Label>Background Color</Label>
    <ColorPicker ... />
  </div>
</FormSection>
```

### Implementation Pattern

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function FormSection({
  title,
  description,
  defaultOpen = true,
  className,
  children,
}: FormSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
        <div className="text-left">
          <h4 className="text-base font-semibold">{title}</h4>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### Project Structure Notes

- Place in `apps/web/components/features/agents/agent-editor/form-section.tsx` — co-located with theme editor
- Uses Shadcn's Collapsible which wraps Radix UI — install first if not already available
- All theme setting forms (stories 4-7 through 4-10, 4-13) will use this component

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1501-1515] — Story 4.4 acceptance criteria
- [Source: `apps/web/components/features/agents/agent-editor/sections/`] — existing section patterns
- [Source: Shadcn Collapsible docs] — component API

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None

### Completion Notes List

- Installed Shadcn Collapsible via `BUN_CONFIG_IGNORE_SCRIPTS=true bunx shadcn@latest add collapsible --yes` (workaround for cpu-features post-install failure on Windows)
- Created FormSection component at `apps/web/components/features/agents/agent-editor/form-section.tsx`
- Component implements all ACs: collapsible with chevron toggle, smooth 200ms animation, bold title + muted description, `space-y-4` children spacing, `defaultOpen` (default `true`), `className` prop
- No frontend unit tests — manual testing only per project convention
- All validation passed: lint, check-types, build, test:cov (35 suites, 655 tests)

### Code Review Fixes (2026-02-20)

- [HIGH] Added `collapsible-down`/`collapsible-up` animation + `overflow-hidden` to `CollapsibleContent` in `collapsible.tsx` — AC3 smooth animation now fully implemented
- [MEDIUM] Exported `FormSectionProps` interface for downstream type consumption
- [MEDIUM] Added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to `CollapsibleTrigger` for keyboard accessibility

### File List

- `apps/web/components/ui/collapsible.tsx` (new — Shadcn Collapsible primitive)
- `apps/web/components/features/agents/agent-editor/form-section.tsx` (new — FormSection component)
