# Story 4.7: Implement General Settings Form

Status: complete

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

- [x] **Task 1: Update Agent Editor Context for Theme Data** (AC: 10)
  - [x] 1.1 Add `themeData: WidgetTheme` to `AgentEditorContext`
  - [x] 1.2 Add `updateThemeData(path: string, value: unknown)` helper using dot-path setter (no lodash)
  - [x] 1.3 Initialize `themeData` from API response or `defaultWidgetTheme`
  - [x] 1.4 Wire `themeData` into `toPreviewFormData()` bridge function

- [x] **Task 2: Replace General Settings Section** (AC: 1-9, 11)
  - [x] 2.1 Update `apps/web/components/features/agents/agent-editor/sections/general-settings.tsx`
  - [x] 2.2 Keep existing agent name + org fields at top
  - [x] 2.3 Add FormSection "Widget Position" with left/right TabGroup toggle
  - [x] 2.4 Add FormSection "Typography" with font family select + font size slider
  - [x] 2.5 Add FormSection "Icon Appearance" with:
    - ColorPicker for background color
    - ColorPicker for hover background color
    - Slider for size (40-80)
    - Slider for border radius (0-50%)
    - Input for shadow CSS
    - Input for custom image URL (optional)

- [x] **Task 3: Font Family Select** (AC: 2)
  - [x] 3.1 Define font options: Inter, Roboto, Open Sans, Lato, Poppins, system-ui
  - [x] 3.2 Use Shadcn Select component
  - [x] 3.3 Show font preview in each option via inline fontFamily style

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
Claude Opus 4.6

### Debug Log References
- Fixed `@repo/validation` package exports (import pointed to missing `.mjs` file)
- Added `transpilePackages: ['@repo/validation']` to Next.js config for build resolution
- Fixed preview icon to use dynamic `iconSize`, `iconShadow`, `iconHoverBg`, `iconCustomImage`
- Fixed border radius unit: form shows `%`, preview applies `%` (not `px`)
- Removed local `iconTab` state that could drift on reset — uses `themeData.icon.position` directly
- Memoized context provider value and `toPreviewFormData` call for performance
- Added `hasThemeChanges` flag to context to avoid `JSON.stringify` comparison
- Fetches saved theme from `GET /agents/:id/theme` on page load
- Saves theme via `PATCH /agents/:id/theme` only when theme data changed

### Completion Notes List
- All 11 acceptance criteria implemented and wired to live preview
- Shared `@repo/validation` package added as workspace dependency to `apps/web`
- Shadcn Slider component installed
- Context infrastructure (themeData, updateThemeData, save/reset) is shared for all future theme forms

### File List
- `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` — added themeData, updateThemeData, setNestedValue, hasThemeChanges; rewired toPreviewFormData
- `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx` — wire themeData to preview, add theme save/reset, memoize previewFormData
- `apps/web/components/features/agents/agent-editor/sections/general-settings.tsx` — full implementation with FormSection, ColorPicker, TabGroup, Slider, Select
- `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` — dynamic icon size/shadow/hover/custom image, headerShowLogo, subtitleColor
- `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx` — updated descriptions
- `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx` — updated import
- `apps/web/app/(protected)/dashboard/agents/[id]/page.tsx` — fetch theme from API on load
- `apps/web/next.config.js` — added transpilePackages for @repo/validation
- `apps/web/package.json` — added @repo/validation workspace dependency
- `apps/web/components/ui/slider.tsx` — new Shadcn Slider component
- `packages/validation/package.json` — fixed exports field to match actual dist files
- `bun.lock` — updated lockfile from @repo/validation dependency addition
