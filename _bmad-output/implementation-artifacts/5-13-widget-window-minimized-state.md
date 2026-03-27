# Story 5-13: Widget Window Minimized State

Status: done

## Story

As a **website visitor**, I want to minimize the chat window without closing it, so that I can continue browsing while keeping my conversation.

## Acceptance Criteria

1. Window collapses to header-only view (80px height)
2. Conversation state is preserved
3. Clicking header expands back to full size
4. Close button still works from minimized state
5. Animation is smooth (300ms transition)

## Tasks / Subtasks

- [x] Add minimized state to widget state machine (AC: #1, #2)
  - [x] Extend widget state type: `type WidgetState = 'closed' | 'expanded' | 'minimized'`
  - [x] Define state transitions: `closed` → `expanded`, `expanded` → `minimized`, `minimized` → `expanded`, `minimized` → `closed`
  - [x] Preserve messages array and conversation state across all transitions
- [x] Add minimize button to chat window header (AC: #1)
  - [x] Add minimize icon button (dash/underscore icon) next to the close button
  - [x] Minimize button click sets state to `minimized`
  - [x] Inline SVG icon for the minimize button (no icon library)
- [x] Implement minimized view rendering (AC: #1, #4)
  - [x] Show header bar only: agent name, logo, minimize/close buttons
  - [x] Height: 80px, width: same as chat window (`--cw-chat-width`)
  - [x] Same position as expanded window (bottom-right/left, above trigger area)
  - [x] Close (X) button transitions to `closed` state (shows trigger button)
  - [x] Hide trigger button while minimized (widget is still "open")
- [x] Implement header click to expand (AC: #3)
  - [x] Click anywhere on header (except close button) expands to full chat
  - [x] On expand from minimized, auto-scroll to bottom of messages
- [x] Implement smooth animation between states (AC: #5)
  - [x] CSS transition on height: 300ms ease
  - [x] Content below header: `overflow: hidden` during transition
  - [x] Transition from expanded → minimized: height shrinks to 80px
  - [x] Transition from minimized → expanded: height grows to full size
- [x] Add accessibility attributes (AC: #3)
  - [x] `aria-expanded="false"` on minimized header
  - [x] `aria-expanded="true"` on expanded header
  - [x] Keyboard support: Enter/Space on header to toggle
  - [x] **Focus management on minimize:** When minimizing, move focus to the header bar (first focusable element in minimized view). When expanding, move focus back to input field. This prevents focus being trapped on hidden elements.
- [x] Handle mobile behavior (AC: #1, #5)
  - [x] Minimized state works the same on mobile, just different widths
  - [x] Touch targets remain accessible at 80px height

## Dev Notes

### Widget State Machine

This introduces a third state to the widget lifecycle:

```
closed ──(click trigger)──→ expanded
expanded ──(click minimize)──→ minimized
minimized ──(click header)──→ expanded
minimized ──(click close)──→ closed
expanded ──(click close)──→ closed
```

**Trigger button visibility per state:**
- `closed`: trigger visible
- `expanded`: trigger hidden
- `minimized`: trigger hidden

### Minimized View

- Shows only the header bar containing: agent name/logo on the left, minimize and close buttons on the right
- Height: 80px is the total minimized view height (includes header 56px + padding/border). Reference `--cw-header-height` (56px) CSS variable — the 80px accounts for additional spacing
- Width matches the expanded chat window width (`--cw-chat-width` CSS variable)
- Positioned identically to the expanded window so the transition feels like a collapse

### Animation Implementation

Use CSS transitions on the widget container:

```css
.cw-chat-window {
  transition: height 300ms ease;
  overflow: hidden;
}
.cw-chat-window--minimized {
  height: 80px;
}
```

Content below the header is hidden via `overflow: hidden` so it disappears smoothly during the height transition rather than abruptly.

### SPA Navigation
- Minimized state persists across SPA navigation (state is in Preact signals, DOM stays mounted)
- If widget is destroyed via `destroy()`, minimized state is lost

### Conversation Preservation

- Messages array, scroll position, input draft text, and connection state all remain in Preact state/signals
- Only the visual rendering changes — the DOM for message list and input is still mounted but hidden by overflow
- On expand, call `scrollToBottom()` to ensure the latest messages are visible

### Project Structure Notes

- Modify: widget state management to add `'minimized'` state
- Modify: chat window component to handle minimized rendering and transitions
- Modify: header component to add minimize button and click-to-expand behavior
- Modify: trigger button visibility logic to hide during minimized state

### References

- Preact uses `class` attribute (not `className`)
- Shadow DOM with constructable stylesheets and `--cw-*` CSS variables
- Widget built as IIFE bundle

## Dev Agent Record

### Implementation Plan

Renamed the existing widget states (`'minimized'`→`'closed'`, `'open'`→`'expanded'`) and introduced a true `'minimized'` state where the ChatWindow stays mounted but collapses to 80px header-only view. The ChatWindow component now accepts `isMinimized` and `onExpand` props. A `.cw-chat-body` wrapper groups the message area, starters, and input so overflow hiding during the CSS height transition works cleanly. ChatHeader was converted to `forwardRef` for focus management and gained click-to-expand/keyboard support when minimized. Focus moves to header on minimize and back to input on expand. Mobile minimized view overrides fullscreen to remain in the collapsed position.

### Debug Log

- No issues encountered during implementation.

### Completion Notes

- All 7 tasks and subtasks implemented and verified.
- WidgetState type updated: `'closed' | 'expanded' | 'minimized'`
- State transitions: closed→expanded, expanded→minimized, minimized→expanded, minimized→closed, expanded→closed
- Conversation preserved: ChatWindow stays mounted for both expanded and minimized states
- 300ms CSS height transition with `prefers-reduced-motion` support
- Accessibility: `aria-expanded`, `role="button"` on minimized header, Enter/Space keyboard, focus management
- Mobile: minimized view reverts from fullscreen to compact positioned window
- Build, type-check, and lint all pass cleanly
- Widget bundle: 64.98 kB (19.89 kB gzip) — no significant size increase

## File List

- `apps/widget/src/types/index.ts` — Updated WidgetState type
- `apps/widget/src/components/Widget.tsx` — Updated state names, rendering logic, added onExpand/isMinimized
- `apps/widget/src/components/ChatWindow.tsx` — Added minimized support, focus management, header click/keyboard handlers, .cw-chat-body wrapper
- `apps/widget/src/components/ChatHeader.tsx` — Converted to forwardRef, added isMinimized/onHeaderClick/onHeaderKeyDown props, aria-expanded
- `apps/widget/src/styles/components.ts` — Added .cw-chat-window--minimized, .cw-chat-body, minimized header radius, mobile minimized overrides, reduced-motion

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| 1 | High | Mobile scroll lock persists in minimized state — body unscrollable behind 80px header | Conditioned `lockScroll()` on `isMobile && !isMinimized`; unlocks when minimized |
| 2 | Medium | Escape key from minimized fully closes widget, destroying conversation | Ignore Escape when `isMinimized` to prevent accidental data loss |
| 3 | Medium | Focus trap cycles through hidden elements (input, send btn) when minimized | Scoped focus trap to `.cw-chat-header` when minimized; full dialog when expanded |
| 4 | Low | Height transition on `.cw-chat-window` animates keyboard/resize changes too | Moved `transition` to `.cw-chat-window--minimized` and `.cw-chat-window--expanding` only |
| 5 | Low | Minimize button renders when already minimized (no-op but confusing) | Conditionally render minimize button: hidden when `isMinimized` |
| 6 | Low | `wasMinimized` as state causes unnecessary effect re-execution | Converted from `useState` to `useRef` — not used for rendering |

## Senior Developer Review (AI)

- **Review Date:** 2026-03-27
- **Outcome:** Changes Requested (6 findings)
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 6 actionable (7 rejected as noise/false positives)
- **Action Items:**
  - [x] High: Fix mobile scroll lock persisting in minimized state
  - [x] Medium: Fix Escape key destroying conversation from minimized state
  - [x] Medium: Fix focus trap cycling through hidden elements when minimized
  - [x] Low: Scope height transition to minimize/expand toggle only
  - [x] Low: Hide minimize button when already minimized
  - [x] Low: Convert wasMinimized from state to ref

## Change Log

- 2026-03-27: Implemented widget window minimized state (Story 5-13) — all acceptance criteria satisfied
- 2026-03-27: Addressed code review findings — 6 items resolved (1 High, 2 Medium, 3 Low)
