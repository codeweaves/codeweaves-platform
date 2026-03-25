# Story 5-11: Typing Indicator Animation

Status: ready-for-dev

## Story
As a **website visitor**, I want to see when the AI is preparing a response, so that I know my message was received.

## Acceptance Criteria
1. Typing indicator appears with bot avatar
2. Three dots animate with staggered bounce
3. Indicator disappears when response arrives
4. Indicator times out after 30 seconds with error message

## Tasks / Subtasks
- [ ] Create TypingIndicator component (AC: #1, #2)
  - [ ] Create `apps/widget/src/components/TypingIndicator.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [ ] Render as a bot message bubble: left-aligned, bot avatar, `--cw-bot-bubble-bg` background
  - [ ] Display three 8px circular dots inside the bubble
  - [ ] Apply staggered bounce animation with `animation-delay` (0s, 0.15s, 0.3s)
  - [ ] Set `aria-label="Assistant is typing"` and `role="status"` on the indicator container
- [ ] Define bounce animation in component stylesheet (AC: #2)
  - [ ] Create `@keyframes cw-bounce` inside the constructable stylesheet (must be within Shadow DOM):
    ```css
    @keyframes cw-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-8px); }
    }
    ```
  - [ ] Style `.cw-typing-dot`: 8px width/height, 50% border-radius, `--cw-bot-bubble-text` background color, `cw-bounce 1.2s infinite` animation
  - [ ] Second dot: `animation-delay: 0.15s`
  - [ ] Third dot: `animation-delay: 0.3s`
  - [ ] Respect `prefers-reduced-motion`: exact CSS: `@media (prefers-reduced-motion: reduce) { .cw-typing-dot { animation: none; opacity: 0.6; } }`
- [ ] Implement show/hide logic (AC: #1, #3)
  - [ ] Show the indicator when a user message is sent AND waiting for the first SSE token from the backend
  - [ ] Hide the indicator when the first SSE token arrives (parent switches to rendering a streaming MessageBubble)
  - [ ] Auto-scroll to bottom when the indicator appears
- [ ] Implement 30-second timeout (AC: #4)
  - [ ] Start a 30-second timer when the indicator is shown
  - [ ] If no response arrives within 30 seconds, hide the indicator and display an error message: "Response taking too long, please try again"
  - [ ] If the response arrives before timeout, clear the timer (use `clearTimeout`)
  - [ ] Clean up the timer on component unmount to prevent memory leaks
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
