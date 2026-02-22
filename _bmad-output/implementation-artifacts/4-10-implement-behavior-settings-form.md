# Story 4.10: Implement Behavior Settings Form

Status: done

## Story

As an **agent owner**,
I want to configure widget behavior (greeting, starters, bubble, typing indicator),
so that the chat experience matches my engagement goals.

## Acceptance Criteria

1. **AC1:** Greeting message textarea input
2. **AC2:** Conversational starters — up to 4 items, each with display text and message to send
3. **AC3:** Add/remove starter buttons with drag-to-reorder (nice-to-have)
4. **AC4:** Bubble notification settings: toggle on/off, text input, background color, text color, delay (ms)
5. **AC5:** Typing indicator toggle (show/hide)
6. **AC6:** Animation transition duration input (ms)
7. **AC7:** All changes reflect in live preview immediately

## Tasks / Subtasks

- [x] **Task 1: Replace Behavior Settings Section** (AC: 1-7)
  - [x] 1.1 Update `apps/web/components/features/agents/agent-editor/sections/behavior-settings.tsx`
  - [x] 1.2 Add FormSection "Greeting" with textarea for greeting message
  - [x] 1.3 Add FormSection "Conversational Starters" with:
    - Dynamic list of starter items (up to 4)
    - Each item: Input for display text + Input for message
    - Add button (when < 4 items)
    - Remove button per item
  - [x] 1.4 Add FormSection "Bubble Notification" with:
    - Switch to enable/disable
    - Input for bubble text
    - ColorPicker for background
    - ColorPicker for text color
    - Number input for delay (milliseconds)
  - [x] 1.5 Add FormSection "Animations" with:
    - Switch for typing indicator
    - Number input for transition duration (ms)

## Dev Notes

### Conversational Starters UI

```tsx
const starters = themeData.starters; // Array<{ text: string; message: string }>

const addStarter = () => {
  if (starters.length >= 4) return;
  updateThemeData('starters', [...starters, { text: '', message: '' }]);
};

const removeStarter = (index: number) => {
  updateThemeData('starters', starters.filter((_, i) => i !== index));
};

const updateStarter = (index: number, field: 'text' | 'message', value: string) => {
  const updated = starters.map((s, i) => i === index ? { ...s, [field]: value } : s);
  updateThemeData('starters', updated);
};
```

```tsx
<FormSection title="Conversational Starters" description="Quick reply buttons shown on chat open (max 4)">
  {starters.map((starter, index) => (
    <div key={index} className="flex items-start gap-2 rounded-lg border p-3">
      <div className="flex-1 space-y-2">
        <Input
          value={starter.text}
          onChange={(e) => updateStarter(index, 'text', e.target.value)}
          placeholder="Button text"
        />
        <Input
          value={starter.message}
          onChange={(e) => updateStarter(index, 'message', e.target.value)}
          placeholder="Message to send"
        />
      </div>
      <Button variant="ghost" size="icon" onClick={() => removeStarter(index)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ))}
  {starters.length < 4 && (
    <Button variant="outline" onClick={addStarter} className="w-full">
      <Plus className="mr-2 h-4 w-4" /> Add Starter
    </Button>
  )}
</FormSection>
```

### Bubble Notification Conditional Fields

```tsx
<FormSection title="Bubble Notification" description="Auto-popup message on widget icon">
  <div className="grid grid-cols-3 items-center gap-4">
    <Label>Enable Bubble</Label>
    <Switch
      checked={themeData.bubble.enabled}
      onCheckedChange={(checked) => updateThemeData('bubble.enabled', checked)}
    />
  </div>
  {themeData.bubble.enabled && (
    <>
      <div className="grid grid-cols-3 items-center gap-4">
        <Label>Bubble Text</Label>
        <Input
          value={themeData.bubble.text}
          onChange={(e) => updateThemeData('bubble.text', e.target.value)}
          className="col-span-2"
        />
      </div>
      <ColorPicker label="Background" value={themeData.bubble.backgroundColor} ... />
      <ColorPicker label="Text Color" value={themeData.bubble.textColor} ... />
      <div className="grid grid-cols-3 items-center gap-4">
        <Label>Delay (ms)</Label>
        <Input
          type="number"
          value={themeData.bubble.delayMs}
          onChange={(e) => updateThemeData('bubble.delayMs', parseInt(e.target.value))}
          className="col-span-2"
          min={0}
          max={30000}
          step={500}
        />
      </div>
    </>
  )}
</FormSection>
```

### Dependencies

- Story 4-4 (FormSection), 4-5 (ColorPicker) must be completed first
- Story 4-7 (General Settings) must be done for context update infrastructure

### Project Structure Notes

- Replace placeholder in `behavior-settings.tsx`
- Greeting message and welcome message overlap — greeting is theme-level (shown in widget), welcome message is agent-level (stored on Agent model). Clarify distinction in UI labels.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1608-1623] — Story 4.10 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — WidgetTheme.bubble, animations, starters schemas
- [Source: `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` lines 201-233] — bubble rendering in preview

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A

### Completion Notes List
- Replaced placeholder with full behavior settings form
- Greeting section uses Textarea bound to `formData.welcomeMessage` (Agent-level greeting)
- Conversational Starters: dynamic list (max 4) with add/remove, each item has display text + message fields
- Bubble Notification: toggle with conditional fields (text, bg color, text color, delay ms)
- Animations: typing indicator toggle + transition duration number input
- Drag-to-reorder (AC3 nice-to-have) deferred — add/remove implemented
- All controls use `updateThemeData` for immediate preview (AC7)
- [Review Fix H1] Greeting textarea now binds to `formData.welcomeMessage` instead of `themeData.header.title` (was overwriting header title)
- [Review Fix H2] Removed useless `useCallback` wrappers on starter helpers (starters ref changes every render)
- [Review Fix M3] Number inputs (delayMs, transitionDuration) now clamp values to valid Zod schema ranges

### File List
- `apps/web/components/features/agents/agent-editor/sections/behavior-settings.tsx`
