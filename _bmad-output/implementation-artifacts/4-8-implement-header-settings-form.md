# Story 4.8: Implement Header Settings Form

Status: complete

## Story

As an **agent owner**,
I want to customize the widget header (title, subtitle, logo, colors),
so that the chat widget header matches my brand.

## Acceptance Criteria

1. **AC1:** Text input for header title
2. **AC2:** Text input for header subtitle (optional)
3. **AC3:** Logo toggle (show/hide) with URL input when enabled
4. **AC4:** ColorPicker for header background color
5. **AC5:** ColorPicker for header text color
6. **AC6:** ColorPicker for subtitle text color
7. **AC7:** All changes reflect in live preview immediately
8. **AC8:** Form uses FormSection and ColorPicker components

## Tasks / Subtasks

- [x] **Task 1: Replace Chat Settings Section with Header Settings** (AC: 1-8)
  - [x] 1.1 Renamed `chat-settings.tsx` to `header-settings.tsx`, exported `HeaderSettings`
  - [x] 1.3 Add FormSection "Header Content" with:
    - Input for title
    - Input for subtitle (optional, clears to undefined)
  - [x] 1.4 Add FormSection "Header Appearance" with:
    - ColorPicker for background color
    - ColorPicker for text color
    - ColorPicker for subtitle color
  - [x] 1.5 Add FormSection "Logo" with:
    - Switch to show/hide logo
    - Input for logo URL (conditionally visible when enabled)

- [x] **Task 2: Update Sidebar Categories** (AC: all)
  - [x] 2.1 Renamed "Chat Interface" to "Header" in `agent-editor-sidebar.tsx`
  - [x] 2.2 Updated `agent-editor-form.tsx` import to `header-settings.tsx`

## Dev Notes

### Sidebar Category Restructure

The current sidebar has: General, Appearance, Chat Interface, Behavior, Prompt, Integration, Branding.

For the theme editor, consider restructuring to:
- **General** — agent name, org, widget position, typography, icon
- **Header** — title, subtitle, logo, header colors (was "Chat Interface")
- **Messages** — user/bot message colors, avatars (was "Appearance")
- **Behavior** — greeting, starters, bubble, typing indicator
- **Prompt** — system prompt, welcome message (admin only)
- **Integration** — webhooks, domains (admin only)
- **Branding** — footer branding (admin only)

This restructure happens naturally as we replace placeholder sections.

### Theme Data Access

```tsx
const { themeData, updateThemeData } = useAgentEditor();

// Header fields
<Input
  value={themeData.header.title}
  onChange={(e) => updateThemeData('header.title', e.target.value)}
/>
<ColorPicker
  value={themeData.header.backgroundColor}
  onChange={(color) => updateThemeData('header.backgroundColor', color)}
/>
```

### Logo Toggle Pattern

```tsx
<div className="grid grid-cols-3 items-center gap-4">
  <Label>Show Logo</Label>
  <Switch
    checked={themeData.header.showLogo}
    onCheckedChange={(checked) => updateThemeData('header.showLogo', checked)}
  />
</div>
{themeData.header.showLogo && (
  <div className="grid grid-cols-3 items-center gap-4">
    <Label>Logo URL</Label>
    <Input
      value={themeData.header.logoUrl || ''}
      onChange={(e) => updateThemeData('header.logoUrl', e.target.value)}
      placeholder="https://example.com/logo.png"
      className="col-span-2"
    />
  </div>
)}
```

### Dependencies

- Story 4-4 (FormSection), 4-5 (ColorPicker) must be completed first
- Story 4-7 (General Settings) should be done first for context update pattern

### Project Structure Notes

- Update existing placeholder section or create new — depends on sidebar restructure decision
- Keep `adminOnly` checks if the section has admin-only fields

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1572-1587] — Story 4.8 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — WidgetTheme.header schema
- [Source: `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` lines 261-315] — header rendering in preview

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Updated chat-widget-surface.tsx to respect `headerShowLogo` flag for conditional logo display
- Updated subtitle rendering to use `headerSubtitleColor` instead of hardcoded `opacity-90`

### Completion Notes List
- All 8 acceptance criteria implemented and wired to live preview
- File renamed from chat-settings.tsx to header-settings.tsx for consistency
- Sidebar label updated from "Chat Interface" to "Header"
- Preview immediately reflects title, subtitle, logo, and all color changes

### File List
- `apps/web/components/features/agents/agent-editor/sections/header-settings.tsx` — new HeaderSettings form (renamed from chat-settings.tsx)
- `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx` — updated import path
- `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx` — renamed category to "Header"
- `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` — headerShowLogo + subtitleColor support
