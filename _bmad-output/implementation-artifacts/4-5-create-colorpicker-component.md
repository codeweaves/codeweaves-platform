# Story 4.5: Create ColorPicker Component

Status: done

## Story

As a **dashboard developer**,
I want a color picker component with hex input,
so that users can select colors for theme settings visually and precisely.

## Acceptance Criteria

1. **AC1:** Component displays a color swatch showing the current value
2. **AC2:** Clicking the swatch opens a popover with a color picker
3. **AC3:** Hex input field allows manual color entry with validation
4. **AC4:** Picker uses a saturation/hue panel (react-colorful or similar lightweight lib)
5. **AC5:** onChange callback returns hex color string (e.g., `#3b82f6`)
6. **AC6:** Integrates with 3-column grid layout used by all theme forms (`grid grid-cols-3 items-center gap-4`)
7. **AC7:** Popover closes on click outside or Escape key
8. **AC8:** Invalid hex values are rejected and reverted

## Tasks / Subtasks

- [x] **Task 1: Install Color Picker Library** (AC: 4)
  - [x] 1.1 Run `cd apps/web && bun add react-colorful` (3KB, no deps, tree-shakeable)

- [x] **Task 2: Install Shadcn Popover** (AC: 2, 7)
  - [x] 2.1 Popover already installed — verified present at `apps/web/components/ui/popover.tsx`

- [x] **Task 3: Build ColorPicker Component** (AC: 1-8)
  - [x] 3.1 Create `apps/web/components/features/agents/agent-editor/color-picker.tsx`
  - [x] 3.2 Render color swatch button (24x24 rounded square with border)
  - [x] 3.3 Wrap picker in Shadcn Popover
  - [x] 3.4 Use `HexColorPicker` from react-colorful inside popover
  - [x] 3.5 Add hex input field below picker with `#` prefix
  - [x] 3.6 Validate hex input on blur — reject invalid, revert to previous value
  - [x] 3.7 Debounce onChange by 100ms to avoid excessive re-renders during drag
  - [x] 3.8 Add `label` prop for use with `<Label>`
  - [x] 3.9 Support `disabled` state

## Dev Notes

### Component API

```tsx
interface ColorPickerProps {
  value: string;         // Current hex color, e.g. "#3b82f6"
  onChange: (color: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}
```

### Usage Example

```tsx
<div className="grid grid-cols-3 items-center gap-4">
  <Label>Background Color</Label>
  <ColorPicker
    value={formData.icon.backgroundColor}
    onChange={(color) => updateTheme('icon.backgroundColor', color)}
    className="col-span-2"
  />
</div>
```

### Implementation Pattern

```tsx
'use client';

import { useState, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export function ColorPicker({ value, onChange, disabled, className }: ColorPickerProps) {
  const [localHex, setLocalHex] = useState(value);

  const handleHexInput = useCallback((input: string) => {
    const hex = input.startsWith('#') ? input : `#${input}`;
    setLocalHex(hex);
    if (HEX_REGEX.test(hex)) {
      onChange(hex);
    }
  }, [onChange]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            className="h-8 w-8 shrink-0 rounded-md border border-input"
            style={{ backgroundColor: value }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <HexColorPicker color={value} onChange={onChange} />
          <Input
            value={localHex}
            onChange={(e) => handleHexInput(e.target.value)}
            className="mt-2"
            maxLength={7}
          />
        </PopoverContent>
      </Popover>
      <span className="text-sm text-muted-foreground font-mono">{value}</span>
    </div>
  );
}
```

### Library Choice: react-colorful

- **Size:** ~3KB gzip (vs react-color at ~13KB)
- **Dependencies:** Zero
- **Tree-shakeable:** Yes
- **Supports:** Hex, RGB, HSL pickers
- **Install:** `bun add react-colorful`

### Project Structure Notes

- Place in `apps/web/components/features/agents/agent-editor/color-picker.tsx`
- Used by all theme setting forms that have color fields (4-7, 4-8, 4-9, 4-13)
- The 3-column grid layout (`grid grid-cols-3`) is the standard for all theme form rows

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1518-1533] — Story 4.5 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — ColorPicker spec
- [Source: `apps/web/components/features/agents/agent-editor/sections/`] — existing form layout patterns

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Type check initially failed on tab-group.tsx (sibling story) — fixed array access guard

### Completion Notes List
- Installed react-colorful@5.6.1 (3KB, zero deps)
- Popover was already installed — skipped reinstall
- Built ColorPicker with: swatch button, HexColorPicker in Popover, hex Input with validation
- Debounced picker onChange by 100ms via useRef timeout
- Invalid hex reverted on blur (AC8)
- **Code Review Fixes (2026-02-22):** 4 issues fixed
  - [HIGH] Removed internal Label rendering — label prop now only drives aria-label for accessibility; external Label in grid layout is the correct pattern (AC6)
  - [MED] Debounce now flushes pending color on unmount via pendingColorRef — no more lost final color
  - [MED] HexColorPicker now uses localHex instead of value — eliminates thumb snap-back during drag
  - [LOW] Hex display span now shows localHex for real-time feedback during typing
- Syncs localHex with value prop via useEffect
- Supports label, disabled, className props
- All validations pass: lint, check-types, build, test:cov (655 tests)

### File List
- `apps/web/package.json` (modified — added react-colorful dependency)
- `apps/web/components/features/agents/agent-editor/color-picker.tsx` (new)
- `bun.lock` (modified)
