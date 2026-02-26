# Story 4.16: Agents Table Actions Column

Status: done

## Story

As an **agent manager** (any role),
I want action buttons on each row of the agents table,
so that I can quickly edit, embed, demo, or delete agents.

## Acceptance Criteria

1. **AC1:** Actions column added as the last column in agents data table
2. **AC2:** Four inline icon buttons with tooltips: Edit (Pencil), Embed (Code), Demo (ExternalLink), Delete (Trash2)
3. **AC3:** Edit navigates to `/dashboard/agents/:id` (agent editor page)
4. **AC4:** Embed opens controlled `EmbedCodeDialog` with embed snippet and copy button
5. **AC5:** Demo opens `/agents/demo/:id` in a new tab
6. **AC6:** Delete opens `AlertDialog` requiring typing "DELETE" to confirm
7. **AC7:** Successful delete shows success toast and refreshes the table
8. **AC8:** All actions available to CLIENT, ADMIN, and SUPER_ADMIN roles
9. **AC9:** Delete button styled with `text-destructive` color
10. **AC10:** Actions column header is center-aligned

## Tasks / Subtasks

- [x] **Task 1: Add useDeleteAgent Hook** (AC: 7)
  - [x] 1.1 Add `useDeleteAgent` mutation hook to `apps/web/hooks/use-agents.ts`
  - [x] 1.2 Invalidate `['agents']` query on success

- [x] **Task 2: Refactor EmbedCodeDialog** (AC: 4)
  - [x] 2.1 Add `open` and `onOpenChange` props for controlled mode
  - [x] 2.2 Support both uncontrolled (with trigger) and controlled (without trigger) usage

- [x] **Task 3: Add Actions Column** (AC: 1-6, 8-10)
  - [x] 3.1 Add actions column with `TooltipProvider` wrapping inline icon buttons
  - [x] 3.2 Edit: `router.push()` navigation
  - [x] 3.3 Embed: `setEmbedAgent(agent)` to open controlled dialog
  - [x] 3.4 Demo: `window.open()` in new tab
  - [x] 3.5 Delete: `setDeleteAgent(agent)` to open confirmation dialog

- [x] **Task 4: Delete Confirmation Dialog** (AC: 6, 7)
  - [x] 4.1 `AlertDialog` with text input requiring "DELETE" to enable the button
  - [x] 4.2 `AlertDialogAction` disabled until `deleteConfirmText === 'DELETE'`
  - [x] 4.3 Show "Deleting..." while mutation is pending
  - [x] 4.4 Toast success/error on completion

- [x] **Task 5: Update Backend Roles** (AC: 8)
  - [x] 5.1 Add `CLIENT` role to `@Roles()` decorator on DELETE endpoint in `AgentsController`
  - [x] 5.2 Update role authorization test

## Dev Notes

- `TooltipProvider` wraps each row's actions (not global) following existing pattern in `pending-invitations-list.tsx`
- `EmbedCodeDialog` is controlled via `embedAgent` state — when non-null, dialog opens with that agent's `publicId`
- Delete confirmation resets `deleteConfirmText` on close/cancel/success

## Branch & PR

- Branch: `feature/agent-editor-enhancements`
- PR: #42
