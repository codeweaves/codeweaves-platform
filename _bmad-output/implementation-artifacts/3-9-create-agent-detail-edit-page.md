# Story 3.9: Create Agent Detail/Edit Page

Status: ready-for-dev

> **Prerequisites:** Story 3-1 (Agent backend), Story 3-8 (Agent list page). Stories 3-4 through 3-7 should ideally be complete for full integration, but the page can be built incrementally.

## Story

As a **dashboard user**,
I want to view and edit agent details on a dedicated page with sidebar tabs,
so that I can configure all aspects of my agent — name, status, domains, webhook, prompt, and branding.

## Acceptance Criteria

1. **AC1:** `/dashboard/agents/[id]` page loads agent data and displays a tab-based editor
2. **AC2:** Sidebar has 7 tabs: General, Appearance, Chat Interface, Behavior, Prompt, Integration, Branding
3. **AC3:** CLIENT users only see 4 tabs: General, Appearance, Chat Interface, Behavior (Prompt, Integration, Branding are hidden)
4. **AC4:** General tab shows: agent name (editable) + organization (read-only after creation, shown to admin only)
5. **AC5:** Integration tab shows: webhook URL (admin only) + domain allowlist (admin only) — returns null for non-admin
6. **AC6:** Prompt tab shows: initial context + org info fields (admin only) — returns null for non-admin
7. **AC7:** Branding tab shows: footer branding config (admin only) — returns null for non-admin
8. **AC8:** Status toggle (ACTIVE/INACTIVE) in the page header — CLIENT can toggle for own org, ADMIN/SUPER_ADMIN can toggle any
9. **AC9:** Save button persists changes via `PATCH /agents/:id`
10. **AC10:** Cancel/Reset discards unsaved changes and reverts to last saved state
11. **AC11:** Unsaved changes indicator (visual cue) when form has been modified
12. **AC12:** "Embed Code" button (admin only) shows copy-to-clipboard dialog with the embed snippet
13. **AC13:** Appearance, Chat, and Behavior tabs are placeholder sections for now (Epic 4 theme editor fills them)
14. **AC14:** Page shows 404 if agent not found or user lacks access

## Tasks / Subtasks

- [ ] **Task 1: Agent Detail Page** (AC: 1, 14)
  - [ ] 1.1 Create `apps/web/app/(protected)/dashboard/agents/[id]/page.tsx`
  - [ ] 1.2 Fetch agent data from `GET /agents/:id` on mount
  - [ ] 1.3 Show loading skeleton while fetching
  - [ ] 1.4 Show 404/not-found if agent doesn't exist or access denied
  - [ ] 1.5 Pass agent data to `AgentEditor` component

- [ ] **Task 2: Agent Editor Layout** (AC: 2, 3, 8, 11, 12)
  - [ ] 2.1 Create `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx`
  - [ ] 2.2 Header bar: agent name, status toggle, embed code button (admin), save/cancel buttons
  - [ ] 2.3 Layout: sidebar (tabs) + main content (form) — no live preview yet (Epic 4)
  - [ ] 2.4 Unsaved changes indicator: dot/badge on Save button when dirty

- [ ] **Task 3: Agent Editor Sidebar** (AC: 2, 3)
  - [ ] 3.1 Create `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx`
  - [ ] 3.2 7 categories with icons (matching AgentEditor reference)
  - [ ] 3.3 Filter out `integration`, `prompt`, `branding` for non-admin users
  - [ ] 3.4 Highlight selected tab

- [ ] **Task 4: Agent Editor Context (State Management)** (AC: 9, 10, 11)
  - [ ] 4.1 Create `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`
  - [ ] 4.2 Two-state system: `savedData` (from server) and `tempData` (current form state)
  - [ ] 4.3 `hasUnsavedChanges` — deep comparison between saved and temp
  - [ ] 4.4 `resetToSaved()` — revert temp to saved
  - [ ] 4.5 `saveCurrentState()` — call PATCH API, update saved on success

- [ ] **Task 5: General Settings Section** (AC: 4)
  - [ ] 5.1 Create `apps/web/components/features/agents/agent-editor/sections/general-settings.tsx`
  - [ ] 5.2 Agent name: editable text input
  - [ ] 5.3 Organization: read-only input showing org name (admin only, disabled after creation)
  - [ ] 5.4 Follow `AgentEditor/sections/GeneralSettings.tsx` reference exactly

- [ ] **Task 6: Integration Settings Section** (AC: 5)
  - [ ] 6.1 Create `apps/web/components/features/agents/agent-editor/sections/integration-settings.tsx`
  - [ ] 6.2 Return `null` if user is not admin
  - [ ] 6.3 Webhook URL field: fetches from `GET /agents/:id/webhook`, saves via `PATCH /agents/:id/webhook`
  - [ ] 6.4 Domain allowlist: tag input with add/remove — saves via `PATCH /agents/:id`
  - [ ] 6.5 Follow `AgentEditor/sections/IntegrationSettings.tsx` reference

- [ ] **Task 7: Prompt Settings Section** (AC: 6)
  - [ ] 7.1 Create `apps/web/components/features/agents/agent-editor/sections/prompt-settings.tsx`
  - [ ] 7.2 Return `null` if user is not admin
  - [ ] 7.3 Two textarea fields: Initial Context, Organization Info
  - [ ] 7.4 Placeholder for now — saved to agent model fields (`systemPrompt`, `welcomeMessage`)

- [ ] **Task 8: Branding Settings Section** (AC: 7)
  - [ ] 8.1 Create `apps/web/components/features/agents/agent-editor/sections/branding-settings.tsx`
  - [ ] 8.2 Return `null` if user is not admin
  - [ ] 8.3 Placeholder section with branding toggle, text prefix, link text, link URL
  - [ ] 8.4 These fields will be stored in the AgentTheme model (Epic 4) — for now, show UI only

- [ ] **Task 9: Placeholder Sections** (AC: 13)
  - [ ] 9.1 Create `apps/web/components/features/agents/agent-editor/sections/appearance-settings.tsx` — placeholder with "Appearance settings will be available in the Theme Editor" message
  - [ ] 9.2 Create `apps/web/components/features/agents/agent-editor/sections/chat-settings.tsx` — placeholder
  - [ ] 9.3 Create `apps/web/components/features/agents/agent-editor/sections/behavior-settings.tsx` — placeholder

- [ ] **Task 10: Agent Editor Form Router** (AC: 2)
  - [ ] 10.1 Create `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx`
  - [ ] 10.2 Switch on `selectedCategory` to render the correct section component
  - [ ] 10.3 Pass form data and update handler to each section

- [ ] **Task 11: Embed Code Dialog** (AC: 12)
  - [ ] 11.1 Create `apps/web/components/features/agents/embed-code-dialog.tsx`
  - [ ] 11.2 Show embed snippet: `<script src="..." data-agent-id="${publicId}"></script>`
  - [ ] 11.3 Copy-to-clipboard button with toast confirmation
  - [ ] 11.4 Only shown to ADMIN/SUPER_ADMIN

- [ ] **Task 12: Status Toggle** (AC: 8)
  - [ ] 12.1 In the editor header, add a Switch component for ACTIVE/INACTIVE
  - [ ] 12.2 Calls `PATCH /agents/:id` with `{ status }` immediately on toggle
  - [ ] 12.3 Show toast on success/failure
  - [ ] 12.4 CLIENT can toggle for own org agents, ADMIN/SUPER_ADMIN for any

## Dev Notes

### Follow the AgentEditor Reference Exactly

The `AgentEditor/` folder at the project root is the definitive UI reference. Key files:

| Reference File | Maps To |
|---|---|
| `AgentEditorLayout.tsx` | `agent-editor-layout.tsx` |
| `AgentEditorSidebar.tsx` | `agent-editor-sidebar.tsx` |
| `AgentEditorForm.tsx` | `agent-editor-form.tsx` |
| `AgentEditorContext.tsx` | `agent-editor-context.tsx` |
| `sections/GeneralSettings.tsx` | `sections/general-settings.tsx` |
| `sections/IntegrationSettings.tsx` | `sections/integration-settings.tsx` |
| `sections/PromptSettings.tsx` | `sections/prompt-settings.tsx` |
| `sections/BrandingSettings.tsx` | `sections/branding-settings.tsx` |
| `sections/AppearanceSettings.tsx` | `sections/appearance-settings.tsx` (placeholder) |
| `sections/ChatSettings.tsx` | `sections/chat-settings.tsx` (placeholder) |
| `sections/BehaviorSettings.tsx` | `sections/behavior-settings.tsx` (placeholder) |

**The reference uses `useIsAdmin()` hook** — in our actual app, use `useProfile()` and check `profile.role`:

```typescript
const { profile } = useProfile();
const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';
```

### 7 Sidebar Tabs

```
General         → FileText icon    → Name + org
Appearance      → Palette icon     → Placeholder (Epic 4)
Chat Interface  → MessageCircle    → Placeholder (Epic 4)
Behavior        → Settings icon    → Placeholder (Epic 4)
Prompt          → ScrollText icon  → Admin only — initial context
Integration     → Plug icon        → Admin only — webhook + domains
Branding        → BadgeInfo icon   → Admin only — footer branding
```

Non-admin users see only: General, Appearance, Chat Interface, Behavior.

### Two-State Form Management

From `AgentEditorContext.tsx`:
```typescript
// savedData = what's on the server (set after successful save or initial load)
// tempData = current form values (user is editing)
// hasUnsavedChanges = deep comparison savedData vs tempData
// resetToSaved() → set tempData = savedData
// saveCurrentState() → PATCH API, on success: savedData = tempData
```

### Embed Code Format

```html
<script src="https://widget.codeweaves.com/widget.js" data-agent-id="PUBLIC_ID"></script>
```

The `publicId` comes from the agent data. The widget URL base should come from an env var (`NEXT_PUBLIC_WIDGET_URL`).

### Appearance / Chat / Behavior — Placeholders

These tabs will be fully implemented in Epic 4 (Theme Editor). For now, show a simple card:

```tsx
export default function AppearanceSettings() {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <p>Appearance customization will be available in the Theme Editor.</p>
    </div>
  );
}
```

### Organization is Read-Only After Creation

In the General tab, the organization field is always shown as a disabled input for existing agents (both admin and client). Only during creation (story 3-8 dialog) is the org dropdown editable.

### API Calls Used

| Action | Method | Endpoint |
|--------|--------|----------|
| Load agent | GET | `/agents/:id` |
| Update agent | PATCH | `/agents/:id` |
| Get webhook | GET | `/agents/:id/webhook` |
| Set webhook | PATCH | `/agents/:id/webhook` |
| Test webhook | POST | `/agents/:id/webhook/test` |

### File Structure

```
apps/web/
├── app/(protected)/dashboard/agents/
│   ├── page.tsx                                        # EXISTS (3-8)
│   └── [id]/
│       └── page.tsx                                    # NEW
├── components/features/agents/
│   ├── agents-data-table.tsx                           # EXISTS (3-8)
│   ├── create-agent-dialog.tsx                         # EXISTS (3-8)
│   ├── embed-code-dialog.tsx                           # NEW
│   └── agent-editor/
│       ├── agent-editor-layout.tsx                     # NEW
│       ├── agent-editor-sidebar.tsx                    # NEW
│       ├── agent-editor-form.tsx                       # NEW
│       ├── agent-editor-context.tsx                    # NEW
│       └── sections/
│           ├── general-settings.tsx                    # NEW
│           ├── appearance-settings.tsx                 # NEW (placeholder)
│           ├── chat-settings.tsx                       # NEW (placeholder)
│           ├── behavior-settings.tsx                   # NEW (placeholder)
│           ├── prompt-settings.tsx                     # NEW
│           ├── integration-settings.tsx                # NEW
│           └── branding-settings.tsx                   # NEW
```

### References

- [Source: `AgentEditor/` folder] — complete UI reference (all 19 files)
- [Source: `AgentEditor/types.ts`] — `AgentFormData` interface, `CategoryId` type
- [Source: `AgentEditor/AgentEditorSidebar.tsx`] — sidebar tab filtering for non-admin
- [Source: `AgentEditor/sections/IntegrationSettings.tsx`] — webhook + domain UI
- [Source: `AgentEditor/sections/GeneralSettings.tsx`] — name + org dropdown
- [Source: `AgentEditor/AgentEditorContext.tsx`] — two-state form management
- [Source: `apps/web/app/(protected)/dashboard/organizations/page.tsx`] — page pattern
- [Source: `apps/web/lib/api-client.ts`] — API client hook
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1426-1442] — Story 3.9 AC

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
