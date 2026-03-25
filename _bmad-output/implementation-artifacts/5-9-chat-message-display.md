# Story 5-9: Chat Message Display

Status: ready-for-dev

## Story
As a **website visitor**, I want to see my messages and AI responses clearly, so that I can follow the conversation.

## Acceptance Criteria
1. User messages appear on the right with user avatar
2. AI messages appear on the left with bot avatar
3. Messages use configured colors and border radii
4. Timestamps display if enabled in config
5. Messages auto-scroll to show latest
6. Long messages wrap properly without overflow

## Tasks / Subtasks
- [ ] Create MessageBubble component (AC: #1, #2, #3, #6)
  - [ ] Create `apps/widget/src/components/MessageBubble.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [ ] Accept props: `{ content: string, role: 'user' | 'assistant', timestamp: Date, isStreaming?: boolean }`
  - [ ] Right-align user messages with `--cw-user-bubble-bg` and `--cw-user-bubble-text` CSS variables
  - [ ] Left-align bot messages with `--cw-bot-bubble-bg` and `--cw-bot-bubble-text` CSS variables
  - [ ] Set max-width to 80% of container to prevent full-width bubbles
  - [ ] Apply `word-break: break-word` and `white-space: pre-wrap` for proper long text and line break handling
  - [ ] Use `--cw-message-radius` (default 12px) for border radius, with different corner rounding for user vs bot bubbles (e.g., user: bottom-right sharp, bot: bottom-left sharp)
- [ ] Implement avatar rendering (AC: #1, #2)
  - [ ] Render 32px avatar next to each bubble (left of bot messages, right of user messages)
  - [ ] Support circle or square shape based on `avatarShape` config
  - [ ] Use `--cw-user-avatar-bg` / `--cw-bot-avatar-bg` for avatar background color
  - [ ] Display first letter of role label or custom image if provided
- [ ] Implement conditional timestamp display (AC: #4)
  - [ ] Show timestamp below bubble only when `config.showTimestamp` is true
  - [ ] Use `--cw-font-size-sm` for timestamp font size
  - [ ] Format timestamp in a readable short format (e.g., "2:34 PM")
- [ ] Implement auto-scroll behavior (AC: #5)
  - [ ] Scroll message container to bottom when a new message is added
  - [ ] Track scroll position: if `scrollTop + clientHeight >= scrollHeight - 50px`, user is "at bottom"
  - [ ] Only auto-scroll if user is at or near bottom; if user has scrolled up, do not force scroll
  - [ ] Re-enable auto-scroll when user scrolls back to bottom
- [ ] Implement streaming message display (AC: #5, #6)
  - [ ] For messages with `isStreaming: true`, render content progressively as it arrives
  - [ ] Show a blinking cursor/caret animation at the end of streaming text
  - [ ] Remove cursor when streaming completes (`isStreaming` becomes false)
- [ ] Implement message list and empty state (AC: #1, #2)
  - [ ] Manage messages array with Preact `useState` or signals
  - [ ] Set `role="log"` and `aria-live="polite"` on the message container for screen reader announcements
  - [ ] Use `aria-label` (not `aria-labelledby`) for ARIA references since widget is inside Shadow DOM
  - [ ] On empty state, display the greeting message from config as the first bot message
- [ ] Create component stylesheet (AC: #3)
  - [ ] Define all styles as constructable stylesheet within Shadow DOM
  - [ ] Use `--cw-*` CSS variable namespace for all themeable properties
  - [ ] Include `@keyframes` for streaming cursor blink animation

## Dev Notes

### Component Structure
- **File**: `apps/widget/src/components/MessageBubble.tsx`
- **Props**: `{ content: string, role: 'user' | 'assistant', timestamp: Date, isStreaming?: boolean }`
- This is a Preact component: use `class` attribute (not `className`), import hooks from `preact/hooks`

### Styling
- User messages: right-aligned, `--cw-user-bubble-bg`, `--cw-user-bubble-text`
- Bot messages: left-aligned, `--cw-bot-bubble-bg`, `--cw-bot-bubble-text`
- Avatar: 32px circle/square based on config (`avatarShape`), background from `--cw-user-avatar-bg` / `--cw-bot-avatar-bg`
- Timestamp: below bubble, `--cw-font-size-sm`, only if `config.showTimestamp`
- Message text: `word-break: break-word`, `white-space: pre-wrap`, `overflow-wrap: break-word`
- **Word-wrap/overflow reset:** Explicitly set `word-break: break-word` and `overflow-wrap: break-word` on message text — these properties can be inherited from host page and must be explicitly set
- Max width: 80% of container
- Border radius: `--cw-message-radius` (12px default), asymmetric corners for user vs bot

### Scrollable Message Container
- Apply `overscroll-behavior: contain` to prevent scroll chaining to the host page
- Apply `-webkit-overflow-scrolling: touch` for iOS momentum scrolling

### Font Loading
- Custom fonts must be loaded into light DOM (not shadow root) — handled by Story 5-2 Task 8
- System font stack is the default fallback

### Auto-Scroll Logic
- Track whether user is "at bottom": `scrollTop + clientHeight >= scrollHeight - 50`
- If at bottom when new message arrives, scroll to bottom
- If user has manually scrolled up, do not auto-scroll
- Resume auto-scroll when user scrolls back to bottom

### Streaming
- When `isStreaming` is true, show content as it arrives with a blinking cursor at the end
- When streaming completes, remove the cursor

### Accessibility
- Message container: `role="log"`, `aria-live="polite"`
- All ARIA IDREFs must stay within the same shadow root; use `aria-label` instead of `aria-labelledby`
- **ARIA in Shadow DOM:** Use `aria-label` instead of `aria-labelledby` because IDREFs don't cross Shadow DOM boundaries — reference research Section 10

### Project Structure Notes
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- CSS variables: `--cw-*` namespace
- AgentTheme fields: `userBubbleBg`, `userBubbleText`, `botBubbleBg`, `botBubbleText`, `showTimestamp`, `userAvatarBg`, `botAvatarBg`, `avatarShape` (circle/square), `messageBorderRadius`

### References
- Backend SSE endpoint: `POST /api/chat/{agentPublicId}/messages/stream`
- SSE token format: `data: {"type":"token","content":"..."}\n\n`
- SSE completion: `event: done`
