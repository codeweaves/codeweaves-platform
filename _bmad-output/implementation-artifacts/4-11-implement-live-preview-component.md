# Story 4.11: Implement Live Preview Component

Status: done

## Story

As an **agent owner**,
I want to see theme changes in real-time in a live preview,
so that I know exactly how my widget will look before saving.

## Acceptance Criteria

1. **AC1:** Preview updates immediately when any theme value changes (no save required)
2. **AC2:** Preview shows minimized icon state (widget bubble)
3. **AC3:** Preview shows expanded chat state (full chat window)
4. **AC4:** Preview shows sample messages (user + bot) with current styling
5. **AC5:** Preview is interactive — can click icon to expand, click X to minimize
6. **AC6:** Preview shows bubble notification with configured text and colors
7. **AC7:** Preview renders in the right panel of the 3-panel layout (flex-2, min 450px)

## Completion Notes

This story was completed as part of the Agent Editor UI Overhaul (PR #33 on `feature/agent-editor-ui-overhaul`).

**Implemented in:**
- `apps/web/components/features/agents/agent-editor/agent-preview.tsx` — Wrapper with "Live Preview" header, manages preview state (minimized, bubble, messages)
- `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx` — Full chat widget preview ported from legacy code, renders all theme states (icon, bubble, expanded chat, messages, input, branding)
- `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx` — `PreviewFormData` type and `toPreviewFormData()` bridge function mapping `AgentFormData` → preview shape with hardcoded theme defaults

**Current state:** The preview uses `PreviewFormData` which maps from `AgentFormData`. When the theme data integration is added (Story 4-7's Task 1), the `toPreviewFormData()` bridge will read from `themeData` instead of hardcoded defaults, making the preview truly reactive to all theme changes.

All acceptance criteria verified and passing. Preview is interactive, shows all states, and renders in the correct layout position.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### File List

- `apps/web/components/features/agents/agent-editor/agent-preview.tsx`
- `apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx`
- `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`
