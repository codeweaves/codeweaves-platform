# Story 4.7: Implement General Settings Form

Status: ready-for-dev

## Story

As an **agent owner**,
I want to configure general widget settings like position, font, and icon appearance,
so that the basic widget look matches my website.

## Acceptance Criteria

1. **AC1:** Widget position selector (left/right) — radio or toggle
2. **AC2:** Font family dropdown with common web fonts (Inter, Roboto, Open Sans, system-ui, etc.)
3. **AC3:** Default font size input (number, 12-20px range)
4. **AC4:** Icon background color picker
5. **AC5:** Icon hover background color picker
6. **AC6:** Icon size slider/input (40-80px)
7. **AC7:** Icon border radius slider/input (0-50%)
8. **AC8:** Icon shadow input (CSS shadow string)
9. **AC9:** Custom icon image URL input (optional)
10. **AC10:** All changes reflect in live preview immediately (no save required)
11. **AC11:** Form uses FormSection and ColorPicker components from stories 4-4 and 4-5

## Tasks / Subtasks

- [ ] **Task 1: Update Agent Editor Context for Theme Data** (AC: 10)
  - [ ] 1.1 Add `themeData: WidgetTheme` to `AgentEditorContext`
  - [ ] 1.2 Add `updateThemeData(path: string, value: any)` helper using lodash `set` or manual dot-path setter
  - [ ] 1.3 Initialize `themeData` from API response or `defaultWidgetTheme`
  - [ ] 1.4 Wire `themeData` into `toPreviewFormData()` bridge function

- [ ] **Task 2: Replace General Settings Section** (AC: 1-9, 11)
  - [ ] 2.1 Update `apps/web/components/features/agents/agent-editor/sections/general-settings.tsx`
  - [ ] 2.2 Keep existing agent name + org fields at top
  - [ ] 2.3 Add FormSection "Widget Position" with left/right toggle
  - [ ] 2.4 Add FormSection "Typography" with font family select + font size input
  - [ ] 2.5 Add FormSection "Icon Appearance" with:
    - ColorPicker for background color
    - ColorPicker for hover background color
    - Number input for size (40-80)
    - Slider for border radius (0-50)
    - Input for shadow CSS
    - Input for custom image URL (optional)

- [ ] **Task 3: Font Family Select** (AC: 2)
  - [ ] 3.1 Define font options: Inter, Roboto, Open Sans, Lato, Poppins, system-ui
  - [ ] 3.2 Use Shadcn Select component
  - [ ] 3.3 Show font preview in each option if feasible

## Dev Notes

### Theme Data Flow

The general settings form reads and writes to `themeData` in the editor context:

```tsx
const { themeData, updateThemeData } = useAgentEditor();

// Reading
const position = themeData.icon.position;

// Writing
updateThemeData('icon.position', 'left');
updateThemeData('typography.fontFamily', 'Roboto');
```

### Dot-Path Setter Utility

Create a simple helper (no lodash needed) for nested updates:

```typescript
function setNestedValue<T>(obj: T, path: string, value: any): T {
  const keys = path.split('.');
  const result = structuredClone(obj);
  let current: any = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}
```

### Layout Pattern

Each form row uses the standard 3-column grid:

```tsx
<div className="grid grid-cols-3 items-center gap-4">
  <Label>Background Color</Label>
  <ColorPicker
    value={themeData.icon.backgroundColor}
    onChange={(color) => updateThemeData('icon.backgroundColor', color)}
    className="col-span-2"
  />
</div>
```

### Font Options

```typescript
const FONT_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: "'Open Sans', sans-serif", label: 'Open Sans' },
  { value: 'Lato, sans-serif', label: 'Lato' },
  { value: 'Poppins, sans-serif', label: 'Poppins' },
  { value: 'system-ui, sans-serif', label: 'System Default' },
];
```

### Dependencies

- Story 4-4 (FormSection) and 4-5 (ColorPicker) must be completed first
- Story 4-1 (WidgetTheme types) must be completed first for type definitions
- Shadcn Slider component needed: `bunx shadcn@latest add slider`

### Project Structure Notes

- Update existing `general-settings.tsx` — don't create a new file
- Agent name and org remain at top, theme settings below
- Context update (Task 1) is shared infrastructure for all theme forms

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1554-1569] — Story 4.7 acceptance criteria
- [Source: `apps/web/components/features/agents/agent-editor/sections/general-settings.tsx`] — current component
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`] — context to update
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — WidgetTheme.icon and WidgetTheme.typography schemas

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
