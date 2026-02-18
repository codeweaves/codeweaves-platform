# Story 4.4: Create FormSection Component

Status: ready-for-dev

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

- [ ] **Task 1: Install Shadcn Collapsible** (AC: 6)
  - [ ] 1.1 Run `bunx shadcn@latest add collapsible`

- [ ] **Task 2: Build FormSection Component** (AC: 1-7)
  - [ ] 2.1 Create `apps/web/components/features/agents/agent-editor/form-section.tsx`
  - [ ] 2.2 Use Shadcn `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`
  - [ ] 2.3 Add chevron icon (ChevronDown from lucide) that rotates on collapse
  - [ ] 2.4 Style title as `text-base font-semibold`, description as `text-sm text-muted-foreground`
  - [ ] 2.5 Wrap children in `space-y-4` container
  - [ ] 2.6 Add `defaultOpen` prop, default `true`
  - [ ] 2.7 Add `className` prop for custom container styling

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

### Debug Log References

### Completion Notes List

### File List
