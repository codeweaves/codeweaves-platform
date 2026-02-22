# Story 4.9: Implement Chat Appearance Settings Form

Status: done

## Story

As an **agent owner**,
I want to customize chat message appearance (colors, avatars, body background),
so that conversations look on-brand and professional.

## Acceptance Criteria

1. **AC1:** User message settings: background color, text color, border radius (0-24)
2. **AC2:** Bot message settings: background color, text color, border radius (0-24)
3. **AC3:** Bot avatar config: type selector (robot/machine/bot/support/custom), shape (circle/square/rounded), background color, icon color, custom image URL
4. **AC4:** User avatar config: same options as bot avatar
5. **AC5:** Chat body background color picker
6. **AC6:** Timestamp settings: show/hide toggle, format (12h/24h), color
7. **AC7:** Input field settings: background color, text color, placeholder text, border color, border radius
8. **AC8:** Send button settings: background color, hover color, icon color, border radius
9. **AC9:** TabGroup component used to switch between User Messages / Bot Messages sub-sections
10. **AC10:** All changes reflect in live preview immediately

## Tasks / Subtasks

- [x] **Task 1: Replace Appearance Settings Section** (AC: 1-10)
  - [x] 1.1 Update `apps/web/components/features/agents/agent-editor/sections/appearance-settings.tsx`
  - [x] 1.2 Add TabGroup with "User Messages" and "Bot Messages" tabs
  - [x] 1.3 User Messages tab:
    - FormSection "Message Style" — ColorPicker bg, ColorPicker text, Slider border radius
    - FormSection "Avatar" — Select type, Select shape, ColorPicker bg, ColorPicker icon color, Input custom image URL
  - [x] 1.4 Bot Messages tab:
    - FormSection "Message Style" — same controls as user
    - FormSection "Avatar" — same controls as user
  - [x] 1.5 Add FormSection "Chat Body" — ColorPicker background
  - [x] 1.6 Add FormSection "Timestamps" — Switch show/hide, Select format (12h/24h), ColorPicker color
  - [x] 1.7 Add FormSection "Input Field" — ColorPicker bg, ColorPicker text, Input placeholder, ColorPicker border, Slider border radius
  - [x] 1.8 Add FormSection "Send Button" — ColorPicker bg, ColorPicker hover bg, ColorPicker icon color, Slider border radius

## Dev Notes

### TabGroup Usage for User/Bot Messages

```tsx
const [messageTab, setMessageTab] = useState<'user' | 'bot'>('user');

<TabGroup
  tabs={[
    { id: 'user', label: 'User Messages', icon: <User className="h-4 w-4" /> },
    { id: 'bot', label: 'Bot Messages', icon: <Bot className="h-4 w-4" /> },
  ]}
  value={messageTab}
  onChange={(id) => setMessageTab(id as 'user' | 'bot')}
/>

{messageTab === 'user' ? (
  <>
    <FormSection title="Message Style">
      <ColorPicker value={themeData.userMessage.backgroundColor} ... />
      <ColorPicker value={themeData.userMessage.textColor} ... />
      <Slider value={themeData.userMessage.borderRadius} min={0} max={24} ... />
    </FormSection>
    <FormSection title="Avatar">
      <Select value={themeData.userAvatar.type} ... />
      ...
    </FormSection>
  </>
) : (
  // Same for bot...
)}
```

### Avatar Type Options

```typescript
const AVATAR_TYPES = [
  { value: 'robot', label: 'Robot' },
  { value: 'machine', label: 'Machine' },
  { value: 'bot', label: 'Bot' },
  { value: 'support', label: 'Support' },
  { value: 'custom', label: 'Custom Image' },
];

const AVATAR_SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
];
```

### Dependencies

- Story 4-4 (FormSection), 4-5 (ColorPicker), 4-6 (TabGroup) must be completed first
- Story 4-7 (General Settings) must be done first for context update infrastructure
- Shadcn Slider: `bunx shadcn@latest add slider` (if not already installed from 4-7)

### Project Structure Notes

- This is the largest settings form — consider splitting into sub-components if it exceeds 200 lines
- Replace the current placeholder in `appearance-settings.tsx`
- Avatar fields in theme: `botAvatar` and `userAvatar` as top-level keys

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1590-1605] — Story 4.9 acceptance criteria
- [Source: `_bmad-output/planning-artifacts/architecture.md`] — WidgetTheme.userMessage, botMessage, input, sendButton schemas
- [Source: `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` lines 317-468] — message + input rendering in preview
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` lines 77-140] — PreviewFormData avatar fields

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A

### Completion Notes List
- Replaced placeholder with full appearance settings form
- Split user/bot message controls into a shared `MessageControls` sub-component to keep file under 300 lines
- TabGroup switches between User Messages and Bot Messages tabs (AC9)
- Each tab shows Message Style (bg, text, border-radius) + Avatar (type, shape, bg, icon color, custom URL)
- Custom image URL field only shown when avatar type is "custom"
- Chat Body, Timestamps, Input Field, Send Button sections all implemented with conditional rendering for timestamp fields
- All controls use `updateThemeData` dot-path API for immediate live preview (AC10)
- [Review Fix M1] Moved MESSAGE_TABS JSX into component scope via useMemo to avoid module-level React elements
- [Review Fix M2] MessageControls now receives themeData/updateThemeData as props instead of calling useAgentEditor() independently

### File List
- `apps/web/components/features/agents/agent-editor/sections/appearance-settings.tsx`
