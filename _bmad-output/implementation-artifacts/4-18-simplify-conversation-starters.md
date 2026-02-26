# Story 4.18: Simplify Conversation Starters Schema

Status: done

## Story

As an **agent owner**,
I want a single input field per conversation starter instead of separate "button text" and "message" fields,
so that the editing experience is simpler and more intuitive.

## Acceptance Criteria

1. **AC1:** Starter schema changed from `{ text, message }` to `{ message }` (single field)
2. **AC2:** `message` field has `min(1).max(80)` character validation
3. **AC3:** Character counter displayed inside input (e.g., "12/80")
4. **AC4:** Max 4 starters allowed
5. **AC5:** Starters display correctly in live preview (widget surface)
6. **AC6:** Starters display correctly on public demo page
7. **AC7:** Clicking a starter on the demo page sends the message successfully
8. **AC8:** Editor input has `maxLength={80}` attribute as additional guard

## Tasks / Subtasks

- [x] **Task 1: Update Validation Schema** (AC: 1, 2)
  - [x] 1.1 Change `starterSchema` in `packages/validation/src/theme.ts` to `{ message: z.string().min(1).max(80) }`
  - [x] 1.2 Remove `text` field from schema

- [x] **Task 2: Update Editor UI** (AC: 3, 4, 8)
  - [x] 2.1 Change `behavior-settings.tsx` from two inputs to single input per starter
  - [x] 2.2 Add character counter `{starter.message.length}/80` inside input
  - [x] 2.3 Update `addStarter()` to create `{ message: '' }`
  - [x] 2.4 Simplify `updateStarter()` to single value parameter with length guard

- [x] **Task 3: Update Context Mapping** (AC: 5)
  - [x] 3.1 Change `agent-editor-context.tsx` mapping from `s.text` to `s.message`

- [x] **Task 4: Update Demo Page** (AC: 6, 7)
  - [x] 4.1 Change `Starter` interface to `{ message: string }`
  - [x] 4.2 Display `starter.message` as button text
  - [x] 4.3 Remove `useCallback` wrapper on `sendMessage` (caused stale closure)
  - [x] 4.4 Add `isTyping` guard to prevent double-sends
  - [x] 4.5 Add `type="button"` to starter buttons

- [x] **Task 5: Update Tests** (AC: all)
  - [x] 5.1 Update `theme.validation.spec.ts` starter tests to use `{ message }` format
  - [x] 5.2 Add 3 new tests: empty message rejection, 80-char limit, at-limit acceptance
  - [x] 5.3 Update `public-agents.controller.spec.ts` mock data

## Dev Notes

- 80-char limit chosen based on research: chat widget starters should be short like CTAs (50-80 chars optimal)
- Frontend enforces limit in two places: `maxLength={80}` on input and `if (value.length > 80) return` in handler
- Backend validates via Zod `z.string().min(1).max(80)`

## Branch & PR

- Branch: `feature/agent-editor-enhancements`
- PR: #43
