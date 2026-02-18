# Story 4.3: Implement Theme Editor Page Layout

Status: done

## Story

As an **agent owner**,
I want a visual theme editor page with 3-panel layout,
so that I can customize my widget's appearance with a live preview.

## Acceptance Criteria

1. **AC1:** 3-panel layout is displayed: left sidebar (256px config categories), center panel (flex-3 form inputs), right panel (flex-2, min 450px live preview)
2. **AC2:** Main dashboard sidebar collapses on mount, restores on unmount
3. **AC3:** Agent name displayed in dashboard header bar (not duplicated in editor)
4. **AC4:** Status toggle (Active/Inactive with Activating.../Deactivating... loading) and embed code button in header actions
5. **AC5:** Save and Reset buttons fixed at bottom of center panel
6. **AC6:** Layout uses full viewport height minus header (calc(100vh - 4rem))
7. **AC7:** Negative margin (-m-6) counteracts dashboard main padding

## Completion Notes

This story was completed as part of the Agent Editor UI Overhaul (PR #33 on `feature/agent-editor-ui-overhaul`).

**Implemented in:**
- `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx` — 3-panel layout, sidebar collapse, page header injection
- `apps/web/components/layout/page-header.tsx` — PageHeaderContext for injecting title + actions into dashboard header
- `apps/web/components/layout/header.tsx` — Updated to consume PageHeaderContext
- `apps/web/components/layout/dashboard-shell.tsx` — Wrapped with PageHeaderProvider
- `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx` — Config category sidebar with cursor-pointer
- `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx` — Category-to-section routing
- `apps/web/app/globals.css` — .scrollarea CSS for hidden-by-default scrollbars

All acceptance criteria verified and passing. Layout matches the reference design.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### File List

- `apps/web/components/features/agents/agent-editor/agent-editor-layout.tsx`
- `apps/web/components/layout/page-header.tsx`
- `apps/web/components/layout/header.tsx`
- `apps/web/components/layout/dashboard-shell.tsx`
- `apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx`
- `apps/web/components/features/agents/agent-editor/agent-editor-form.tsx`
- `apps/web/app/globals.css`
