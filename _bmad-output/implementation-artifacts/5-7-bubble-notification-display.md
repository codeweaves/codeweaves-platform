# Story 5-7: Bubble Notification Display

Status: ready-for-dev

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
- [ ] Create BubbleNotification component shell (AC: #1, #6)
  - [ ] Create `apps/widget/src/components/BubbleNotification.tsx` as a Preact functional component
  - [ ] Accept props: agent config, `onOpen` callback, trigger button position (left/right)
  - [ ] Gate rendering on `config.showBubble === true` — render nothing if false
  - [ ] Check sessionStorage for `cw_bubble_dismissed_{agentId}` — render nothing if dismissed
  - [ ] Do not render if chat window is already open (accept `isOpen` prop)
- [ ] Implement delayed appearance (AC: #1)
  - [ ] Use `setTimeout` with `config.bubbleDelay` milliseconds (default 3000ms)
  - [ ] Track visibility state internally; start hidden, show after delay
  - [ ] Clean up timeout on unmount to prevent memory leaks
- [ ] Display greeting text (AC: #2)
  - [ ] Render `config.bubbleText` as the bubble content
  - [ ] Apply max-width of 280px
  - [ ] Apply text truncation with ellipsis for messages exceeding container (CSS `overflow: hidden; text-overflow: ellipsis`)
  - [ ] Support multi-line text with reasonable max-height and overflow hidden
  - [ ] On screens < 320px, reduce bubble max-width to `calc(100vw - 40px)` to prevent overflow
  - [ ] Set `word-break: break-word` to handle long unbroken text gracefully
- [ ] Apply theme-driven styling (AC: #3)
  - [ ] Set background from `config.bubbleBg` via `--cw-bubble-bg` CSS variable
  - [ ] Set text color from `config.bubbleTextColor` via `--cw-bubble-text` CSS variable
  - [ ] Set border radius via `--cw-bubble-radius` CSS variable
  - [ ] Add CSS triangle pointer/arrow toward the trigger button
- [ ] Implement entrance animation (AC: #1)
  - [ ] Fade-in + slide-up: `opacity: 0, translateY(10px)` to `opacity: 1, translateY(0)`
  - [ ] Duration ~200ms ease-out
- [ ] Implement close (X) button (AC: #4)
  - [ ] Render a small close button at top-right corner of the bubble
  - [ ] On click: hide bubble and store `cw_bubble_dismissed_{agentId}` in sessionStorage
  - [ ] Stop event propagation so closing does not trigger bubble click
- [ ] Wire bubble click to open chat (AC: #5)
  - [ ] Clicking the bubble body calls `onOpen` callback to open the chat window
  - [ ] Dismiss the bubble after opening (set internal visible state to false)
- [ ] Implement bubble lifecycle rules (AC: #4, #5, #6)
  - [ ] Once dismissed via close button, store flag in sessionStorage and do not re-appear for the rest of the session
  - [ ] Once clicked to open chat, dismiss the bubble immediately
  - [ ] After user closes the chat window, the bubble stays dismissed for the remainder of the session (do not re-show)
- [ ] Position bubble relative to trigger button (AC: #1, #3)
  - [ ] Position above the trigger button with a small gap (~12px)
  - [ ] Align to the same side as the trigger (right-aligned for right position, left-aligned for left)
  - [ ] CSS triangle arrow points downward toward the trigger button
- [ ] Add accessibility attributes (AC: #2, #4)
  - [ ] Set `role="status"` on the bubble container
  - [ ] Set `aria-live="polite"` so screen readers announce the bubble
  - [ ] Close button: `aria-label="Dismiss notification"`
  - [ ] Bubble body: `pointer-events: auto`
  - [ ] Screen reader testing note: `role="status"` with `aria-live="polite"` should announce the greeting text on appearance — verify with NVDA (Windows) and VoiceOver (macOS/iOS)
- [ ] Add constructable stylesheet for BubbleNotification (AC: #3)
  - [ ] Define styles following 3-sheet pattern
  - [ ] Use `--cw-*` namespaced CSS variables for all configurable values

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
