# Story 5-7: Bubble Notification Display

Status: done

## Story
As a **website visitor**, I want to see a greeting bubble near the chat icon, so that I'm encouraged to start a conversation.

## Acceptance Criteria
1. Bubble appears above/beside the icon after configured delay
2. Bubble displays configured greeting text
3. Bubble uses configured colors and border radius
4. Bubble has a close (X) button
5. Clicking the bubble opens the chat window
6. Bubble respects `showBubble` configuration

## Tasks / Subtasks
- [x] Create BubbleNotification component shell (AC: #1, #6)
  - [x] Create `apps/widget/src/components/BubbleNotification.tsx` as a Preact functional component
  - [x] Accept props: agent config, `onOpen` callback, trigger button position (left/right)
  - [x] Gate rendering on `config.showBubble === true` — render nothing if false
  - [x] Check sessionStorage for `cw_bubble_dismissed_{agentId}` — render nothing if dismissed
  - [x] Do not render if chat window is already open (accept `isOpen` prop)
- [x] Implement delayed appearance (AC: #1)
  - [x] Use `setTimeout` with `config.bubbleDelay` milliseconds (default 3000ms)
  - [x] Track visibility state internally; start hidden, show after delay
  - [x] Clean up timeout on unmount to prevent memory leaks
- [x] Display greeting text (AC: #2)
  - [x] Render `config.bubbleText` as the bubble content
  - [x] Apply max-width of 280px
  - [x] Apply text truncation with ellipsis for messages exceeding container (CSS `overflow: hidden; text-overflow: ellipsis`)
  - [x] Support multi-line text with reasonable max-height and overflow hidden
  - [x] On screens < 320px, reduce bubble max-width to `calc(100vw - 40px)` to prevent overflow
  - [x] Set `word-break: break-word` to handle long unbroken text gracefully
- [x] Apply theme-driven styling (AC: #3)
  - [x] Set background from `config.bubbleBg` via `--cw-bubble-bg` CSS variable
  - [x] Set text color from `config.bubbleTextColor` via `--cw-bubble-text` CSS variable
  - [x] Set border radius via `--cw-bubble-radius` CSS variable
  - [x] Add CSS triangle pointer/arrow toward the trigger button
- [x] Implement entrance animation (AC: #1)
  - [x] Fade-in + slide-up: `opacity: 0, translateY(10px)` to `opacity: 1, translateY(0)`
  - [x] Duration ~200ms ease-out
- [x] Implement close (X) button (AC: #4)
  - [x] Render a small close button at top-right corner of the bubble
  - [x] On click: hide bubble and store `cw_bubble_dismissed_{agentId}` in sessionStorage
  - [x] Stop event propagation so closing does not trigger bubble click
- [x] Wire bubble click to open chat (AC: #5)
  - [x] Clicking the bubble body calls `onOpen` callback to open the chat window
  - [x] Dismiss the bubble after opening (set internal visible state to false)
- [x] Implement bubble lifecycle rules (AC: #4, #5, #6)
  - [x] Once dismissed via close button, store flag in sessionStorage and do not re-appear for the rest of the session
  - [x] Once clicked to open chat, dismiss the bubble immediately
  - [x] After user closes the chat window, the bubble stays dismissed for the remainder of the session (do not re-show)
- [x] Position bubble relative to trigger button (AC: #1, #3)
  - [x] Position above the trigger button with a small gap (~12px)
  - [x] Align to the same side as the trigger (right-aligned for right position, left-aligned for left)
  - [x] CSS triangle arrow points downward toward the trigger button
- [x] Add accessibility attributes (AC: #2, #4)
  - [x] Set `role="status"` on the bubble container
  - [x] Set `aria-live="polite"` so screen readers announce the bubble
  - [x] Close button: `aria-label="Dismiss notification"`
  - [x] Bubble body: `pointer-events: auto`
  - [x] Screen reader testing note: `role="status"` with `aria-live="polite"` should announce the greeting text on appearance — verify with NVDA (Windows) and VoiceOver (macOS/iOS)
- [x] Add constructable stylesheet for BubbleNotification (AC: #3)
  - [x] Define styles following 3-sheet pattern
  - [x] Use `--cw-*` namespaced CSS variables for all configurable values

## Dev Notes

### Component Details
- **File:** `apps/widget/src/components/BubbleNotification.tsx`
- **Framework:** Preact 10.26.0 — use `class` attribute, not `className`
- **Shadow DOM:** All styles via constructable stylesheets inside closed Shadow DOM

### Timing and Session State
- Delay controlled by `config.bubbleDelay` (default 3000ms)
- Dismissed state stored in `sessionStorage` with key `cw_bubble_dismissed_{agentId}`
- On mount: check sessionStorage first, then set up delay timer if not dismissed
- On unmount: clear the delay timeout

### Positioning
- Bubble floats above the trigger button, offset by ~12px gap
- Aligned to the same side (left/right) as the trigger based on `config.iconPosition`
- CSS triangle (border trick) at bottom of bubble pointing toward trigger
- Right-aligned example: `right: var(--cw-trigger-offset); bottom: calc(var(--cw-trigger-offset) + var(--cw-trigger-size) + 12px)`

### Animation
- Entrance: `@keyframes cw-bubble-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`
- Duration: 200ms ease-out
- Exit on dismiss: immediate hide (no exit animation needed for MVP)

### CSS Triangle Arrow

Arrow position must be conditional based on `config.iconPosition` (left vs right):

```css
.cw-bubble::after {
  content: '';
  position: absolute;
  bottom: -6px;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid var(--cw-bubble-bg);
}

/* Right-side trigger (default) — arrow on the right */
:host([data-position="right"]) .cw-bubble::after {
  right: 24px;
  left: auto;
}

/* Left-side trigger — arrow on the left */
:host([data-position="left"]) .cw-bubble::after {
  left: 24px;
  right: auto;
}
```

### Accessibility
- `role="status"` on the container so it is treated as a live region
- `aria-live="polite"` so the greeting is announced without interrupting
- Close button uses `aria-label="Dismiss notification"`

### Project Structure Notes
- Widget app lives in `apps/widget/`
- Uses Preact (not React) — `class` not `className`
- All interactive elements require `pointer-events: auto`
- CSS variables use `--cw-*` namespace

### References
- Agent config fields: `showBubble`, `bubbleText`, `bubbleDelay`, `bubbleBg`, `bubbleTextColor`
- AgentTheme fields: `iconPosition` (determines bubble alignment side)
- Depends on TriggerButton (Story 5-6) being rendered for positioning context

## File List
- `apps/widget/src/components/BubbleNotification.tsx` — New: full BubbleNotification component
- `apps/widget/src/components/Widget.tsx` — Modified: added extractBubbleConfig(), pass props to BubbleNotification
- `apps/widget/src/styles/components.ts` — Modified: full bubble notification CSS (positioning, arrow, animation, close button, responsive)

## Change Log
- 2026-03-25: Implemented BubbleNotification component with all acceptance criteria — delayed appearance, greeting text, theme-driven styling, close button, bubble click to open chat, lifecycle rules, positioning with CSS triangle, accessibility, and constructable stylesheet styles.
- 2026-03-25: Fixed 5 code review findings — delayMs:0 fallback bug, empty text guard, bubble-specific CSS variables, dismiss logic deduplication.

## Senior Developer Review (AI)

- **Review Date:** 2026-03-25
- **Outcome:** Changes Requested (5 findings) → All Fixed
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3-layer parallel review)
- **Total Findings:** 12 raised, 7 rejected as noise, 5 patch fixes applied
- **Action Items:**
  - [x] [Med] Fix `delayMs: 0` fallback — change `> 0` to `>= 0` so 0ms delay means "show immediately"
  - [x] [Med] Guard empty bubble text — treat `enabled: true` + empty text as disabled
  - [x] [Med] Use `--cw-bubble-radius` CSS variable instead of generic `--cw-border-radius`
  - [x] [Low] Close button color should reference `--cw-bubble-text` not just `--cw-bubble-fg`
  - [x] [Low] Extract shared `dismiss()` function to avoid duplicate logic in keyboard/mouse handlers

## Dev Agent Record

### Implementation Plan
- Created BubbleNotification as a Preact functional component with typed props interface (agentId, bubbleConfig, isOpen, onOpen)
- Used sessionStorage for dismiss persistence with try/catch for private browsing safety
- Implemented delayed show via setTimeout with cleanup on unmount
- All styling via CSS variables (--cw-bubble-bg, --cw-bubble-text, --cw-bubble-radius, --cw-bubble-shadow)
- CSS triangle arrow uses `.cw-widget[data-position]` selector to position on correct side
- Fade-in + slide-up animation via @keyframes cw-bubble-in (200ms ease-out)
- Close button with event propagation stop to prevent triggering bubble click
- Text truncation via -webkit-line-clamp: 4 with word-break: break-word
- Responsive: max-width reduces to calc(100vw - 40px) on screens < 320px
- Accessibility: role="status", aria-live="polite", aria-label on close button

### Debug Log
- TypeScript narrowing issue: `state === 'open'` comparison in else branch of ternary was flagged as always-false. Fixed by passing `isOpen={false}` directly since BubbleNotification only renders in minimized state.

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| 1 | Med | `delayMs: 0` fell back to 3000ms instead of showing immediately | Changed `> 0` to `>= 0` in delay guard |
| 2 | Med | Empty `text` with `enabled: true` rendered broken empty bubble | Added `text.trim()` + length check in `extractBubbleConfig` |
| 3 | Med | Border radius used generic `--cw-border-radius` instead of bubble-specific | Changed to `--cw-bubble-radius` with fallback to `--cw-border-radius` |
| 4 | Low | Close button color used `--cw-bubble-fg` instead of `--cw-bubble-text` | Updated to `--cw-bubble-text` with fallback to `--cw-bubble-fg` |
| 5 | Low | Dismiss keyboard handler duplicated logic from mouse handler | Extracted shared `dismiss()` callback, both handlers delegate to it |

### Completion Notes
All 11 tasks and all subtasks completed. 5 code review findings fixed. Lint, type-check, and build all pass. No backend changes — widget-only story (no tests per project convention for frontend apps).
