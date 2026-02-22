# Story 4.13: Implement Branding Settings Form

Status: done

## Story

As an **agent owner**,
I want to configure widget branding (powered-by footer, logo, colors),
so that the widget attribution can be customized to match my brand guidelines.

## Acceptance Criteria

1. **AC1:** Toggle to enable/disable branding footer visibility
2. **AC2:** Text prefix input (e.g., "Powered by")
3. **AC3:** Toggle between logo or text link display
4. **AC4:** Link text input (e.g., "CodeWeaves")
5. **AC5:** Link URL input with URL validation
6. **AC6:** Logo URL input (when logo mode selected)
7. **AC7:** ColorPicker for branding text color
8. **AC8:** ColorPicker for branding link color
9. **AC9:** All changes reflect in live preview immediately
10. **AC10:** Branding section is admin-only (SUPER_ADMIN, ADMIN)

## Tasks / Subtasks

- [x] **Task 1: Replace Branding Settings Section** (AC: 1-10)
  - [x] 1.1 Update `apps/web/components/features/agents/agent-editor/sections/branding-settings.tsx`
  - [x] 1.2 Move branding data from `AgentFormData` to `themeData.branding`
  - [x] 1.3 Add FormSection "Branding Visibility" with enable/disable switch
  - [x] 1.4 When enabled, show:
    - Input for text prefix ("Powered by")
    - Toggle: Logo mode vs Text link mode
    - If text link: Input for link text + Input for link URL
    - If logo: Input for logo URL
    - ColorPicker for text color
    - ColorPicker for link color

- [x] **Task 2: Migrate Branding from AgentFormData** (AC: all)
  - [x] 2.1 Remove branding fields from `AgentFormData` (they were placeholders)
  - [x] 2.2 Branding now lives in `themeData.branding` (from WidgetTheme schema)
  - [x] 2.3 Update `toPreviewFormData()` to read branding from `themeData.branding`

## Dev Notes

### Branding Config Shape (from WidgetTheme)

```typescript
branding: {
  enabled: boolean;        // Show/hide branding footer
  textPrefix: string;      // e.g., "Powered by"
  useLogo: boolean;        // Toggle between logo and text link
  linkText: string;        // e.g., "CodeWeaves"
  linkUrl: string;         // e.g., "https://codeweaves.com"
  logo?: string;           // Logo URL (when useLogo is true)
  textColor: string;       // Branding text color
  linkColor: string;       // Branding link color
}
```

### Logo/Text Toggle Pattern

```tsx
<FormSection title="Display Mode">
  <div className="grid grid-cols-3 items-center gap-4">
    <Label>Use Logo</Label>
    <Switch
      checked={themeData.branding.useLogo}
      onCheckedChange={(checked) => updateThemeData('branding.useLogo', checked)}
    />
  </div>
  {themeData.branding.useLogo ? (
    <div className="grid grid-cols-3 items-center gap-4">
      <Label>Logo URL</Label>
      <Input
        value={themeData.branding.logo || ''}
        onChange={(e) => updateThemeData('branding.logo', e.target.value)}
        placeholder="https://example.com/logo.png"
        className="col-span-2"
      />
    </div>
  ) : (
    <>
      <div className="grid grid-cols-3 items-center gap-4">
        <Label>Link Text</Label>
        <Input
          value={themeData.branding.linkText}
          onChange={(e) => updateThemeData('branding.linkText', e.target.value)}
          className="col-span-2"
        />
      </div>
      <div className="grid grid-cols-3 items-center gap-4">
        <Label>Link URL</Label>
        <Input
          value={themeData.branding.linkUrl}
          onChange={(e) => updateThemeData('branding.linkUrl', e.target.value)}
          placeholder="https://example.com"
          className="col-span-2"
        />
      </div>
    </>
  )}
</FormSection>
```

### Migration: AgentFormData → ThemeData

Current `AgentFormData` has these placeholder branding fields that need to move:
- `brandingEnabled` → `themeData.branding.enabled`
- `brandingTextPrefix` → `themeData.branding.textPrefix`
- `brandingLinkText` → `themeData.branding.linkText`
- `brandingLinkUrl` → `themeData.branding.linkUrl`

Remove these from `AgentFormData` and update all references.

### Dependencies

- Story 4-4 (FormSection), 4-5 (ColorPicker) must be completed first
- Story 4-7 (General Settings) for context `themeData` infrastructure
- Story 4-1 (WidgetTheme schema with branding) must be completed first

### Project Structure Notes

- Update existing `branding-settings.tsx` — keep `adminOnly` flag in sidebar
- Branding was the only placeholder that had real fields in AgentFormData — migration needed
- The preview's branding footer in `chat-widget-surface.tsx` already reads from PreviewFormData branding fields

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1663-1678] — Story 4.13 acceptance criteria
- [Source: `apps/web/components/features/agents/agent-editor/sections/branding-settings.tsx`] — current placeholder
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`] — AgentFormData branding fields to migrate
- [Source: `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` lines 471-501] — branding footer rendering

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None — no issues encountered.

### Completion Notes List
- Task 1: Completely rewrote `branding-settings.tsx` to use `themeData.branding` via `updateThemeData()`. Added FormSections for: Branding Visibility (enabled toggle), Footer Text (textPrefix input), Display Mode (useLogo toggle with conditional logo URL or link text/URL fields), Branding Colors (textColor and linkColor ColorPickers). All fields conditionally rendered when branding is enabled. Admin-only guard preserved.
- Task 2: Removed 4 placeholder branding fields (`brandingEnabled`, `brandingTextPrefix`, `brandingLinkText`, `brandingLinkUrl`) from `AgentFormData` interface and `agentToFormData()`. `toPreviewFormData()` already mapped from `themeData.branding` — no changes needed. `chat-widget-surface.tsx` uses `PreviewFormData` (not `AgentFormData`) — no changes needed.

### File List
- `apps/web/components/features/agents/agent-editor/sections/branding-settings.tsx` (modified — full rewrite)
- `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` (modified — removed branding fields from AgentFormData)
