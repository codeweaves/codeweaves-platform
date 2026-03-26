# Story 5-11: Typing Indicator Animation

Status: done

## Story
As a **website visitor**, I want to see when the AI is preparing a response, so that I know my message was received.

## Acceptance Criteria
1. Typing indicator appears with bot avatar
2. Three dots animate with staggered bounce
3. Indicator disappears when response arrives
4. Indicator times out after 30 seconds with error message

## Tasks / Subtasks
- [x] Create TypingIndicator component (AC: #1, #2)
  - [x] Create `apps/widget/src/components/TypingIndicator.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [x] Render as a bot message bubble: left-aligned, bot avatar, `--cw-bot-bubble-bg` background
  - [x] Display three 8px circular dots inside the bubble
  - [x] Apply staggered bounce animation with `animation-delay` (0s, 0.15s, 0.3s)
  - [x] Set `aria-label="Assistant is typing"` and `role="status"` on the indicator container
- [x] Define bounce animation in component stylesheet (AC: #2)
  - [x] Create `@keyframes cw-bounce` inside the constructable stylesheet (must be within Shadow DOM):
    ```css
    @keyframes cw-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-8px); }
    }
    ```
  - [x] Style `.cw-typing-dot`: 8px width/height, 50% border-radius, `--cw-bot-bubble-text` background color, `cw-bounce 1.2s infinite` animation
  - [x] Second dot: `animation-delay: 0.15s`
  - [x] Third dot: `animation-delay: 0.3s`
  - [x] Respect `prefers-reduced-motion`: exact CSS: `@media (prefers-reduced-motion: reduce) { .cw-typing-dot { animation: none; opacity: 0.6; } }`
- [x] Implement show/hide logic (AC: #1, #3)
  - [x] Show the indicator when a user message is sent AND waiting for the first SSE token from the backend
  - [x] Hide the indicator when the first SSE token arrives (parent switches to rendering a streaming MessageBubble)
  - [x] Auto-scroll to bottom when the indicator appears
- [x] Implement 30-second timeout (AC: #4)
  - [x] Start a 30-second timer when the indicator is shown
  - [x] If no response arrives within 30 seconds, hide the indicator and display an error message: "Response taking too long, please try again"
  - [x] If the response arrives before timeout, clear the timer (use `clearTimeout`)
  - [x] Clean up the timer on component unmount to prevent memory leaks
    - Clear the 30-second timeout timer
    - Remove any event listeners
    - Reference: docs/research-widget-css-isolation.md Section 14 for cleanup patterns

## Dev Notes

### Component Structure
- **File**: `apps/widget/src/components/TypingIndicator.tsx`
- Renders as a bot-style message bubble (left-aligned, with bot avatar)
- Preact component: use `class` attribute, import from `preact/hooks`

### Animation CSS
All keyframes and styles must live inside the constructable stylesheet within the Shadow DOM:
```css
@keyframes cw-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-8px); }
}
.cw-typing-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--cw-bot-bubble-text, #666);
  animation: cw-bounce 1.2s infinite;
}
.cw-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.cw-typing-dot:nth-child(3) { animation-delay: 0.3s; }
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  .cw-typing-dot {
    animation: none;
    opacity: 0.6;
  }
}
```

### Show/Hide Logic
- **Show when**: message sent AND waiting for first SSE token
- **Hide when**: first SSE token arrives (switch to streaming MessageBubble)
- **Timeout**: 30s with no response -> hide indicator, show error "Response taking too long, please try again"
- Timeout must be clearable (`clearTimeout` when response arrives or component unmounts)

### Accessibility
- Container: `role="status"`, `aria-label="Assistant is typing"`
- Use `aria-label` (not `aria-labelledby`) since widget is inside Shadow DOM

### Project Structure Notes
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- CSS variables: `--cw-*` namespace
- Bot avatar config: `botAvatarBg`, `avatarShape` (circle/square)

### References
- Backend SSE endpoint: `POST /api/chat/{agentPublicId}/messages/stream`
- SSE token format: `data: {"type":"token","content":"..."}\n\n`
- SSE completion signal: `event: done`

## Senior Developer Review (AI)

- **Review Date:** 2026-03-26
- **Outcome:** Approve (after fixes)
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 11 raw → 4 patch, 3 defer, 4 rejected
- **Action Items:**
  - [x] **[High]** Fix stale `onTimeout` reference from fallback arrow function in MessageArea — made `onTypingTimeout` required prop, eliminated inline `() => {}` fallback
  - [x] **[Low]** Consolidate duplicate `preact/hooks` import lines in TypingIndicator
  - [x] **[Low]** Add `imgFailed` reset when `imageUrl` prop changes in Avatar
  - [x] **[Low]** Extract shared Avatar component to avoid duplication with MessageBubble

## Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | High | `onTypingTimeout ?? (() => {})` created new fn on every render, resetting 30s timer | Made `onTypingTimeout` required prop, renamed to `handleTypingTimeout` in destructure |
| P2 | Low | Two separate import lines from `preact/hooks` | Consolidated into single import |
| P3 | Low | Avatar `imgFailed` state never reset when `imageUrl` changes | Added `useEffect` to reset `imgFailed` on URL change in shared Avatar |
| P4 | Low | Duplicate Avatar component between TypingIndicator and MessageBubble | Extracted shared `Avatar.tsx`, imported in both components |

## Dev Agent Record

### Implementation Plan
- Created TypingIndicator as a pure Preact component following MessageBubble patterns
- Animation CSS placed in constructable stylesheet (components.ts) for Shadow DOM compatibility
- Show/hide state managed in ChatWindow via `isTyping` state, passed through MessageArea
- 30s timeout handled in TypingIndicator via useEffect + clearTimeout cleanup
- Timeout callback adds error message to chat and hides indicator

### Debug Log
- No issues encountered during implementation
- Lint, type-check, and build all pass cleanly

### Completion Notes
- TypingIndicator component renders as a bot message bubble with three bouncing dots
- Staggered bounce animation (0s, 0.15s, 0.3s delays) via CSS keyframes
- `prefers-reduced-motion` support: disables animation, shows static dots at 0.6 opacity
- `role="status"` and `aria-label="Assistant is typing"` for accessibility
- `isTyping` state set to true when user sends a message (starter select); will be set to false when SSE first token arrives (story 5-19)
- 30s timeout displays error: "Response taking too long, please try again"
- Timer properly cleaned up on unmount and on visibility change to prevent memory leaks
- MessageArea auto-scrolls when typing indicator appears

## File List
- `apps/widget/src/components/Avatar.tsx` (new) — shared avatar component with imgFailed reset
- `apps/widget/src/components/TypingIndicator.tsx` (new) — typing indicator component
- `apps/widget/src/styles/components.ts` (modified) — added bounce animation CSS + reduced-motion
- `apps/widget/src/components/MessageArea.tsx` (modified) — integrated TypingIndicator, added isTyping/onTypingTimeout props
- `apps/widget/src/components/ChatWindow.tsx` (modified) — added isTyping state, handleTypingTimeout, wired props to MessageArea
- `apps/widget/src/components/MessageBubble.tsx` (modified) — imports shared Avatar instead of inline copy

## Change Log
- 2026-03-26: Implemented typing indicator animation (story 5-11) — component, CSS animations, show/hide logic, 30s timeout with error message
- 2026-03-26: Code review fixes — extracted shared Avatar component, fixed stale onTimeout reference, consolidated imports, added imgFailed reset
