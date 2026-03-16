# Story 10.10: Dashboard Voice Configuration UI

Status: ready-for-dev

## Story

As an **agent owner**,
I want to configure voice settings for my agent in the dashboard,
So that I can control voice behavior per agent.

## Acceptance Criteria

1. New **"Voice"** category added to the agent editor sidebar (with mic/audio icon)
2. Voice section contains a master **"Enable Voice"** toggle (`voiceEnabled`)
3. When voice is disabled, all sub-options are hidden (cascading visibility)
4. When voice is enabled, the following controls are visible:
   - **Voice Input (STT)** — toggle (`sttEnabled`)
   - **Voice Output (TTS)** — toggle (`ttsEnabled`)
   - **Default Language** — dropdown (`defaultLanguage`: en, hi, mr, bn, ta, te, gu, kn, ml, pa, or, hinglish)
   - **Supported Languages** — multi-select tag input (`supportedLanguages`)
   - **Auto-detect Language** — toggle (`autoDetectLanguage`)
   - **STT Provider** — dropdown (`sttProvider`: Auto / sarvam / deepgram / elevenlabs)
   - **TTS Provider** — dropdown (`ttsProvider`: Auto / sarvam / elevenlabs)
   - **TTS Voice ID** — text input (`ttsVoiceId`, placeholder shows provider-specific hint)
   - **TTS Speed** — slider with value display (`ttsSpeed`: 0.5x – 2.0x, step 0.1)
5. Changes are saved via the existing Save button using `PATCH /agents/:id` with `voiceEnabled` and `voiceConfig` fields
6. Form validates using `voiceConfigSchema` from `@repo/validation`
7. Sensible defaults applied: `sttEnabled: true`, `ttsEnabled: true`, `defaultLanguage: 'en'`, `autoDetectLanguage: true`, `ttsSpeed: 1.0`
8. Voice config is preserved when voice is disabled (user can re-enable without losing settings)
9. TTS-specific fields (Voice ID, Speed) are hidden when TTS is disabled
10. STT Provider dropdown is hidden when STT is disabled

## Tasks / Subtasks

- [ ] Task 1: Add "Voice" category to agent editor sidebar (AC: #1)
  - [ ] 1.1 Update `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx`
  - [ ] 1.2 Add `voice` to the `allCategories` array with a mic icon (e.g., `Mic` from lucide-react)
  - [ ] 1.3 Position it after "behavior" and before admin-only sections (prompt, integration, branding)
  - [ ] 1.4 Voice category is visible to all roles (not admin-only) — agent owners configure their own voice settings

- [ ] Task 2: Add voice section routing in agent editor form (AC: #1)
  - [ ] 2.1 Update `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx`
  - [ ] 2.2 Add `case 'voice':` that renders the new `<VoiceSettings />` component

- [ ] Task 3: Extend AgentFormData with voice fields (AC: #5, #8)
  - [ ] 3.1 Update `AgentFormData` interface in `agent-editor-context.tsx`:
    ```typescript
    interface AgentFormData {
      name: string;
      systemPrompt: string;
      welcomeMessage: string;
      allowedDomains: string[];
      webhookUrl: string;
      voiceEnabled: boolean;          // NEW
      voiceConfig: VoiceConfig | null; // NEW
    }
    ```
  - [ ] 3.2 Initialize `voiceEnabled` and `voiceConfig` from agent API response
  - [ ] 3.3 Include `voiceEnabled` and `voiceConfig` in the save payload sent to `PATCH /agents/:id`
  - [ ] 3.4 Ensure `deepEqual` comparison works correctly with the nested `voiceConfig` object for unsaved changes tracking

- [ ] Task 4: Create VoiceSettings section component (AC: #2, #3, #4, #9, #10)
  - [ ] 4.1 Create `apps/web/components/features/agents/agent-editor/sections/voice-settings.tsx`
  - [ ] 4.2 Use `<FormSection>` wrapper with title "Voice Configuration" and description "Enable voice input and output for this agent"
  - [ ] 4.3 Implement master toggle:
    ```
    ┌─────────────────────────────────────────┐
    │ Enable Voice                    [toggle] │
    │ Allow users to interact with this       │
    │ agent using voice                        │
    └─────────────────────────────────────────┘
    ```
  - [ ] 4.4 When `voiceEnabled: false`, hide everything below the master toggle
  - [ ] 4.5 Implement STT section (visible when voice enabled):
    ```
    ┌─────────────────────────────────────────┐
    │ Voice Input (STT)                       │
    │ Enable Speech-to-Text       [toggle]    │
    │ STT Provider    [Auto ▾]                │
    └─────────────────────────────────────────┘
    ```
  - [ ] 4.6 STT Provider dropdown hidden when `sttEnabled: false`
  - [ ] 4.7 STT Provider options: `Auto` (empty/null), `Sarvam AI`, `Deepgram`, `ElevenLabs`
  - [ ] 4.8 Implement TTS section (visible when voice enabled):
    ```
    ┌─────────────────────────────────────────┐
    │ Voice Output (TTS)                      │
    │ Enable Text-to-Speech       [toggle]    │
    │ TTS Provider    [Auto ▾]                │
    │ Voice ID        [input]                 │
    │ Speed           [===●===] 1.0x          │
    └─────────────────────────────────────────┘
    ```
  - [ ] 4.9 TTS Provider options: `Auto` (empty/null), `Sarvam AI`, `ElevenLabs` (no Deepgram — it doesn't support TTS for Indian languages)
  - [ ] 4.10 TTS Voice ID input: placeholder changes based on provider (e.g., "e.g., Anushka" for Sarvam, "e.g., Xb7hH8MSUJpSbSDYk0k2" for ElevenLabs)
  - [ ] 4.11 TTS Speed slider: range 0.5–2.0, step 0.1, show current value as "1.0x"
  - [ ] 4.12 Hide Voice ID, Speed when `ttsEnabled: false`
  - [ ] 4.13 Implement Language section (visible when voice enabled):
    ```
    ┌─────────────────────────────────────────┐
    │ Language                                 │
    │ Default Language    [English ▾]          │
    │ Supported Languages [en] [hi] [+]       │
    │ Auto-detect Language        [toggle]     │
    └─────────────────────────────────────────┘
    ```
  - [ ] 4.14 Default Language dropdown with language display names:
    - `en` — English, `hi` — Hindi, `mr` — Marathi, `bn` — Bengali, `ta` — Tamil, `te` — Telugu, `gu` — Gujarati, `kn` — Kannada, `ml` — Malayalam, `pa` — Punjabi, `or` — Odia, `hinglish` — Hinglish
  - [ ] 4.15 Supported Languages: multi-select or tag-style input where user adds/removes language codes
  - [ ] 4.16 Auto-detect Language toggle with description: "Automatically detect the user's language from their speech"

- [ ] Task 5: Wire form state to context (AC: #5, #6, #7, #8)
  - [ ] 5.1 Read `voiceEnabled` and `voiceConfig` from `useAgentEditor()` context
  - [ ] 5.2 On any change, call `updateFormData()` with updated values
  - [ ] 5.3 Apply defaults when voice is first enabled and no existing config:
    ```typescript
    const defaultVoiceConfig: VoiceConfig = {
      sttEnabled: true,
      ttsEnabled: true,
      defaultLanguage: 'en',
      supportedLanguages: ['en'],
      ttsSpeed: 1.0,
      autoDetectLanguage: true,
    };
    ```
  - [ ] 5.4 When `voiceEnabled` is toggled off, preserve `voiceConfig` in form state (don't clear it)
  - [ ] 5.5 Validate with `voiceConfigSchema` before saving (the existing save flow should handle this via the API)

- [ ] Task 6: Update save flow to include voice fields (AC: #5)
  - [ ] 6.1 Update `agent-editor-layout.tsx` save handler to include `voiceEnabled` and `voiceConfig` in the `PATCH /agents/:id` payload
  - [ ] 6.2 Only include `voiceConfig` in payload when `voiceEnabled` is true OR when it was previously set (preserve on disable)
  - [ ] 6.3 Handle API validation errors for voice config fields — display inline or as toast

## Dev Notes

### Existing Section Pattern

All agent editor sections follow the same pattern. Example from behavior settings:

```typescript
export function BehaviorSettings() {
  const { formData, previewFormData, updateFormData, updateThemeData } = useAgentEditor();

  return (
    <FormSection title="Behavior" description="Configure interaction behavior">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Label htmlFor="timestamps">Show Timestamps</Label>
          <Switch
            id="timestamps"
            checked={previewFormData.showTimestamps}
            onCheckedChange={(checked) => updateThemeData({ showTimestamps: checked })}
          />
        </div>
        {/* more fields */}
      </div>
    </FormSection>
  );
}
```

### Voice Settings Layout

```
┌─ Voice Configuration ──────────────────────────────┐
│                                                     │
│  Enable Voice                           [═══●]     │
│  Allow users to interact using voice                │
│                                                     │
│  ── Voice Input (STT) ─────────────────────────    │
│  Enable Speech-to-Text                  [═══●]     │
│  STT Provider           [ Auto           ▾ ]       │
│                                                     │
│  ── Voice Output (TTS) ─────────────────────────   │
│  Enable Text-to-Speech                  [═══●]     │
│  TTS Provider           [ Auto           ▾ ]       │
│  Voice ID               [ e.g., Anushka     ]      │
│  Speech Speed           [════●════════] 1.0x       │
│                                                     │
│  ── Language ───────────────────────────────────    │
│  Default Language       [ English        ▾ ]       │
│  Supported Languages    [ en ] [ hi ] [ + ]        │
│  Auto-detect Language                   [═══●]     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Language Options Constant

```typescript
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'or', label: 'Odia' },
  { value: 'hinglish', label: 'Hinglish' },
] as const;
```

### Provider Display Names

```typescript
const STT_PROVIDERS = [
  { value: '', label: 'Auto (recommended)' },
  { value: 'sarvam', label: 'Sarvam AI' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const TTS_PROVIDERS = [
  { value: '', label: 'Auto (recommended)' },
  { value: 'sarvam', label: 'Sarvam AI' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  // No Deepgram — doesn't support Indian TTS
];
```

### Cascading Visibility Rules

```
voiceEnabled: false  → hide everything below master toggle
voiceEnabled: true   → show STT section, TTS section, Language section
  sttEnabled: false  → hide STT Provider dropdown
  sttEnabled: true   → show STT Provider dropdown
  ttsEnabled: false  → hide TTS Provider, Voice ID, Speed
  ttsEnabled: true   → show TTS Provider, Voice ID, Speed
```

### Slider Component for TTS Speed

If a Slider component isn't already in Shadcn, add it:
```bash
BUN_CONFIG_IGNORE_SCRIPTS=true bunx shadcn@latest add slider --yes
```

### What NOT to Do

- **Do NOT** create a separate page for voice configuration — it's a section within the existing agent editor
- **Do NOT** add a separate save button for voice — use the existing Save button flow
- **Do NOT** fetch voice provider health/status — that's story 10-15
- **Do NOT** implement voice testing/preview from this settings page — the preview panel (10-8) handles visual preview
- **Do NOT** add voice analytics display here — that's story 10-14
- **Do NOT** implement per-language voice ID mapping (e.g., different voices for Hindi vs English) — single `ttsVoiceId` for now

### Dependencies

- **Requires story 10-6** (voice config schema in database, `voiceEnabled` + `voiceConfig` on Agent model, `PATCH /agents/:id` accepts voice fields)
- Uses `voiceConfigSchema` and `VoiceConfig` type from `packages/validation` (created in 10-6)
- Uses existing agent editor architecture (context, layout, sidebar, form sections)
- Uses Shadcn components: Switch, Select, Input, Label, Slider (may need to add Slider)

### Project Structure Notes

- New section: `apps/web/components/features/agents/agent-editor/sections/voice-settings.tsx` (new)
- Sidebar update: `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx` (modify)
- Form routing: `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx` (modify)
- Context update: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` (modify)
- Layout save flow: `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx` (modify)

### References

- [Architecture: Section 20.11 - Dashboard Voice Configuration](_bmad-output/planning-artifacts/architecture.md)
- [Agent editor sidebar](apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx)
- [Agent editor context](apps/web/components/features/agents/agent-editor/agent-editor-context.tsx)
- [Behavior settings](apps/web/components/features/agents/agent-editor/sections/behavior-settings.tsx) — pattern reference
- [Story 10-6: Voice Config Schema](_bmad-output/implementation-artifacts/10-6-voice-configuration-schema-database.md) — backend API and validation
- [Story 10-8: Voice UI](_bmad-output/implementation-artifacts/10-8-voice-ui-state-machine-mic-button.md) — preview shows mic button visually

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
