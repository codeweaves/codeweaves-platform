# Story 13.2: Dashboard Chat Trigger URL Input

Status: ready-for-dev

## Story

As a **dashboard admin**,
I want to enter the Chat Trigger URL in the agent settings UI,
So that I can enable real streaming for specific agents.

## Acceptance Criteria

1. A "Chat Trigger URL" input field appears below the existing Webhook URL field in Integration Settings
2. The field has helper text: "n8n Chat Trigger URL for real-time streaming (optional)"
3. The field validates as a URL on blur (client-side visual feedback)
4. Saving the agent persists the Chat Trigger URL via `PATCH /agents/:id/chat-trigger`
5. Loading the agent page fetches the Chat Trigger URL via `GET /agents/:id/chat-trigger`
6. Clearing the field and saving removes the Chat Trigger URL (sends empty string or null)
7. Field is only visible to ADMIN and SUPER_ADMIN roles (same as webhook URL)

## Tasks / Subtasks

- [ ] Task 1: Update AgentFormData interface (AC: 5)
  - [ ] Add `chatTriggerUrl: string` to `AgentFormData` in `agent-editor-context.tsx`
  - [ ] Initialize with empty string default

- [ ] Task 2: Fetch chatTriggerUrl on page load (AC: 5)
  - [ ] Add `api.get(/agents/${agent.id}/chat-trigger)` call in `[id]/page.tsx`
  - [ ] Run in parallel with existing webhook and theme fetches
  - [ ] Handle 404/null gracefully (field stays empty)

- [ ] Task 3: Add input field in Integration Settings (AC: 1, 2, 3, 7)
  - [ ] Add Chat Trigger URL input below webhook URL in `integration-settings.tsx`
  - [ ] Same role gate as webhook URL (ADMIN/SUPER_ADMIN only)
  - [ ] Add helper text and placeholder

- [ ] Task 4: Save chatTriggerUrl on form save (AC: 4, 6)
  - [ ] Add `api.patch(/agents/${agent.id}/chat-trigger, { chatTriggerUrl })` in save handler
  - [ ] Only send PATCH if value changed (same pattern as webhook)
  - [ ] Run in parallel with other save operations
  - [ ] Handle clearing: send PATCH with empty/null to remove

## Dev Notes

### No Frontend Tests

Per project convention, **no unit tests** for frontend code. Manual testing only.

### Existing Webhook URL Pattern to Mirror

The Chat Trigger URL field should be an exact copy of how the Webhook URL field works. Here's the full pattern:

**1. Form Data Interface** (`agent-editor-context.tsx`, lines 14-23):
```typescript
// AgentFormData interface — add chatTriggerUrl here
interface AgentFormData {
  // ... existing fields ...
  webhookUrl: string;
  chatTriggerUrl: string;  // ← ADD THIS
  // ...
}
```

**2. Page Load — Fetch URL** (`[id]/page.tsx`, lines 22-60):
```typescript
// Currently fetches webhook in parallel:
const [webhookRes, themeRes] = await Promise.all([
  api.get(`/agents/${agent.id}/webhook`),
  api.get(`/agents/${agent.id}/theme`),
]);

// Add chatTriggerUrl fetch:
const [webhookRes, chatTriggerRes, themeRes] = await Promise.all([
  api.get(`/agents/${agent.id}/webhook`),
  api.get(`/agents/${agent.id}/chat-trigger`).catch(() => ({ chatTriggerUrl: null })),
  api.get(`/agents/${agent.id}/theme`),
]);
```
Note: `.catch()` handles case where no chat trigger URL exists (404 or null).

**3. Integration Settings Field** (`integration-settings.tsx`, lines 70-80):
```tsx
// Existing webhook field:
<div className="space-y-2">
  <Label className="text-sm font-medium">Webhook URL</Label>
  <Input
    value={formData.webhookUrl}
    onChange={(e) => updateFormData('webhookUrl', e.target.value)}
    placeholder="https://your-api.com/webhook"
  />
  <p className="text-xs text-muted-foreground">
    This URL will receive POST requests when users send messages
  </p>
</div>

// ADD BELOW — Chat Trigger URL field:
<div className="space-y-2">
  <Label className="text-sm font-medium">Chat Trigger URL</Label>
  <Input
    value={formData.chatTriggerUrl}
    onChange={(e) => updateFormData('chatTriggerUrl', e.target.value)}
    placeholder="https://your-n8n.com/webhook/xxx/chat"
  />
  <p className="text-xs text-muted-foreground">
    n8n Chat Trigger URL for real-time streaming (optional)
  </p>
</div>
```

**4. Save Handler** (`agent-editor-layout.tsx`, lines 184-240):
```typescript
// Existing webhook save (lines 212-217):
if (formData.webhookUrl !== savedFormData.webhookUrl) {
  promises.push(api.patch(`/agents/${agent.id}/webhook`, { webhookUrl: formData.webhookUrl }));
}

// ADD — Chat Trigger URL save:
if (formData.chatTriggerUrl !== savedFormData.chatTriggerUrl) {
  promises.push(
    api.patch(`/agents/${agent.id}/chat-trigger`, { chatTriggerUrl: formData.chatTriggerUrl })
  );
}
```

### State Management

Uses **React Context** (NOT React Hook Form):
- `AgentEditorContext` provides `formData` and `updateFormData(field, value)`
- `hasUnsavedChanges` computed via `deepEqual()` comparison with `savedFormData`
- No special handling needed — just adding the field to AgentFormData makes it work

### Role Gating

The Integration Settings section already gates on admin roles (line 31-34 of `integration-settings.tsx`). The new field inherits this gate — no additional role check needed.

### API Contract (from Story 13-1)

- **GET** `/agents/:id/chat-trigger` → `{ chatTriggerUrl: string | null }`
- **PATCH** `/agents/:id/chat-trigger` → body: `{ chatTriggerUrl: string }`
- Both require ADMIN or SUPER_ADMIN role
- URL is encrypted at rest (backend handles this transparently)

### Dependencies

- **Story 13-1 must be complete first** — the PATCH/GET endpoints must exist before the frontend can use them
- No new packages or Shadcn components needed — reuses existing `Input`, `Label` from Shadcn

### Project Structure Notes

| File | Change |
|------|--------|
| `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` | Add `chatTriggerUrl` to AgentFormData interface and default |
| `apps/web/app/(protected)/dashboard/agents/[id]/page.tsx` | Fetch chatTriggerUrl in parallel on page load |
| `apps/web/components/features/agents/agent-editor/sections/integration-settings.tsx` | Add Chat Trigger URL input field |
| `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx` | Add chatTriggerUrl PATCH in save handler |

### References

- [Source: architecture.md#ADR-013] — Two URLs per agent: webhookUrl (legacy) + chatTriggerUrl (streaming)
- [Source: architecture.md#Section 12.1] — Streaming mode selection based on chatTriggerUrl presence
- [Source: integration-settings.tsx#70-80] — Existing webhook URL field pattern
- [Source: agent-editor-context.tsx#14-23] — AgentFormData interface
- [Source: agent-editor-layout.tsx#184-240] — Save handler with parallel API calls
- [Source: [id]/page.tsx#22-60] — Page load with parallel data fetching

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
