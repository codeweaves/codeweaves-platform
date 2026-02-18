# Story 4.12: Implement Theme Save and Reset

Status: ready-for-dev

## Story

As an **agent owner**,
I want to save or reset my theme changes,
so that I can commit customizations or revert to the last saved state.

## Acceptance Criteria

1. **AC1:** Save button persists theme via `PUT /agents/:id/theme` API
2. **AC2:** Version is incremented on save (server-side)
3. **AC3:** Success toast confirms save ("Theme saved successfully")
4. **AC4:** Reset button reverts form to last saved state (not defaults — that's the API reset)
5. **AC5:** "Reset to Defaults" option resets to default theme via `POST /agents/:id/theme/reset`
6. **AC6:** Unsaved changes warning on page navigation (beforeunload or route change)
7. **AC7:** Save button disabled when no changes (dirty check)
8. **AC8:** Loading state on save button during API call
9. **AC9:** Error toast on save failure with retry option

## Tasks / Subtasks

- [ ] **Task 1: Theme API Hooks** (AC: 1, 2, 5)
  - [ ] 1.1 Create `apps/web/hooks/use-agent-theme.ts`
  - [ ] 1.2 Add `useAgentTheme(agentId)` query hook — fetches `GET /agents/:id/theme`
  - [ ] 1.3 Add `useUpdateAgentTheme()` mutation — calls `PUT /agents/:id/theme`
  - [ ] 1.4 Add `useResetAgentTheme()` mutation — calls `POST /agents/:id/theme/reset`
  - [ ] 1.5 Invalidate theme query on successful mutation

- [ ] **Task 2: Dirty State Tracking** (AC: 4, 6, 7)
  - [ ] 2.1 Add `isDirty` computed state to agent editor context
  - [ ] 2.2 Compare current `themeData` with `savedThemeData` using deep equality
  - [ ] 2.3 Add `resetThemeToSaved()` method that reverts `themeData` to `savedThemeData`
  - [ ] 2.4 Update `savedThemeData` after successful save

- [ ] **Task 3: Save/Reset UI** (AC: 1, 3, 4, 5, 7, 8, 9)
  - [ ] 3.1 Update save button in `agent-editor-layout.tsx` footer to handle theme save
  - [ ] 3.2 Save calls both agent config update AND theme update in parallel
  - [ ] 3.3 Disable save when `!isDirty` (both agent form and theme form)
  - [ ] 3.4 Show spinner on save button during API calls
  - [ ] 3.5 Toast on success/failure
  - [ ] 3.6 Reset button reverts to saved state
  - [ ] 3.7 Add dropdown option "Reset to Defaults" that calls the reset API

- [ ] **Task 4: Unsaved Changes Warning** (AC: 6)
  - [ ] 4.1 Add `beforeunload` event listener when `isDirty`
  - [ ] 4.2 Add Next.js route change interception when `isDirty`
  - [ ] 4.3 Show confirmation dialog: "You have unsaved changes. Are you sure you want to leave?"

## Dev Notes

### Theme API Hook Pattern

Follow existing `use-agents.ts` hook patterns:

```typescript
// apps/web/hooks/use-agent-theme.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export function useAgentTheme(agentId: string) {
  return useQuery({
    queryKey: ['agent-theme', agentId],
    queryFn: () => apiClient.get(`/agents/${agentId}/theme`).then(r => r.data),
  });
}

export function useUpdateAgentTheme() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, config }: { agentId: string; config: WidgetTheme }) =>
      apiClient.put(`/agents/${agentId}/theme`, config),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-theme', agentId] });
    },
  });
}
```

### Dirty Check with Deep Equality

```typescript
import { isEqual } from 'lodash-es'; // or a lightweight deep-equal

const isDirty = !isEqual(themeData, savedThemeData);
```

Or use JSON.stringify for simple comparison:

```typescript
const isDirty = JSON.stringify(themeData) !== JSON.stringify(savedThemeData);
```

### Save Button Enhancement

The footer already has Save/Reset buttons. Update to handle both agent config + theme:

```tsx
const handleSave = async () => {
  setSaving(true);
  try {
    await Promise.all([
      // Save agent config (name, prompt, etc.)
      hasAgentChanges && updateAgent.mutateAsync({ id: agent.id, data: agentFormData }),
      // Save theme config
      hasThemeChanges && updateTheme.mutateAsync({ agentId: agent.id, config: themeData }),
    ]);
    toast.success('Changes saved successfully');
  } catch {
    toast.error('Failed to save changes');
  } finally {
    setSaving(false);
  }
};
```

### Dependencies

- Story 4-2 (Theme API) must be completed first
- Story 4-7 (General Settings) for context `themeData` infrastructure

### Project Structure Notes

- Theme hooks in `apps/web/hooks/use-agent-theme.ts` — follows existing hook patterns
- Dirty state logic added to `agent-editor-context.tsx`
- Save/reset UI in `agent-editor-layout.tsx` footer

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1644-1660] — Story 4.12 acceptance criteria
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx`] — current save/reset footer
- [Source: `apps/web/hooks/use-agents.ts`] — existing hook patterns
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`] — context to update

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
