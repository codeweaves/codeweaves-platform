# Story 5-13: Widget Window Minimized State

Status: ready-for-dev

## Story

As a **website visitor**, I want to minimize the chat window without closing it, so that I can continue browsing while keeping my conversation.

## Acceptance Criteria

1. Window collapses to header-only view (80px height)
2. Conversation state is preserved
3. Clicking header expands back to full size
4. Close button still works from minimized state
5. Animation is smooth (300ms transition)

## Tasks / Subtasks

- [ ] Add minimized state to widget state machine (AC: #1, #2)
  - [ ] Extend widget state type: `type WidgetState = 'closed' | 'expanded' | 'minimized'`
  - [ ] Define state transitions: `closed` → `expanded`, `expanded` → `minimized`, `minimized` → `expanded`, `minimized` → `closed`
  - [ ] Preserve messages array and conversation state across all transitions
- [ ] Add minimize button to chat window header (AC: #1)
  - [ ] Add minimize icon button (dash/underscore icon) next to the close button
  - [ ] Minimize button click sets state to `minimized`
  - [ ] Inline SVG icon for the minimize button (no icon library)
- [ ] Implement minimized view rendering (AC: #1, #4)
  - [ ] Show header bar only: agent name, logo, minimize/close buttons
  - [ ] Height: 80px, width: same as chat window (`--cw-chat-width`)
  - [ ] Same position as expanded window (bottom-right/left, above trigger area)
  - [ ] Close (X) button transitions to `closed` state (shows trigger button)
  - [ ] Hide trigger button while minimized (widget is still "open")
- [ ] Implement header click to expand (AC: #3)
  - [ ] Click anywhere on header (except close button) expands to full chat
  - [ ] On expand from minimized, auto-scroll to bottom of messages
- [ ] Implement smooth animation between states (AC: #5)
  - [ ] CSS transition on height: 300ms ease
  - [ ] Content below header: `overflow: hidden` during transition
  - [ ] Transition from expanded → minimized: height shrinks to 80px
  - [ ] Transition from minimized → expanded: height grows to full size
- [ ] Add accessibility attributes (AC: #3)
  - [ ] `aria-expanded="false"` on minimized header
  - [ ] `aria-expanded="true"` on expanded header
  - [ ] Keyboard support: Enter/Space on header to toggle
  - [ ] **Focus management on minimize:** When minimizing, move focus to the header bar (first focusable element in minimized view). When expanding, move focus back to input field. This prevents focus being trapped on hidden elements.
- [ ] Handle mobile behavior (AC: #1, #5)
  - [ ] Minimized state works the same on mobile, just different widths
  - [ ] Touch targets remain accessible at 80px height

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
