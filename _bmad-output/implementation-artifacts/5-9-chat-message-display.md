# Story 5-9: Chat Message Display

Status: done

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
- [x] Create MessageBubble component (AC: #1, #2, #3, #6)
  - [x] Create `apps/widget/src/components/MessageBubble.tsx` with Preact (use `class` not `className`, import hooks from `preact/hooks`)
  - [x] Accept props: `{ content: string, role: 'user' | 'assistant', timestamp: Date, isStreaming?: boolean }`
  - [x] Right-align user messages with `--cw-msg-user-bg` and `--cw-msg-user-text` CSS variables
  - [x] Left-align bot messages with `--cw-msg-bot-bg` and `--cw-msg-bot-text` CSS variables
  - [x] Set max-width to 80% of container to prevent full-width bubbles
  - [x] Apply `word-break: break-word` and `white-space: pre-wrap` for proper long text and line break handling
  - [x] Use `--cw-msg-user-radius` / `--cw-msg-bot-radius` (default 16px) for border radius, with asymmetric corners (user: bottom-right sharp, bot: bottom-left sharp)
- [x] Implement avatar rendering (AC: #1, #2)
  - [x] Render 32px avatar next to each bubble (left of bot messages, right of user messages)
  - [x] Support circle or square shape based on `avatarShape` config
  - [x] Use `--cw-avatar-user-bg` / `--cw-avatar-bot-bg` for avatar background color
  - [x] Display first letter of role label ("U" for user, "A" for assistant)
- [x] Implement conditional timestamp display (AC: #4)
  - [x] Show timestamp below bubble only when `config.showTimestamp` (timestamps.show) is true
  - [x] Use 11px font size for timestamp
  - [x] Format timestamp in a readable short format (e.g., "2:34 PM")
- [x] Implement auto-scroll behavior (AC: #5)
  - [x] Scroll message container to bottom when a new message is added
  - [x] Track scroll position: if `scrollTop + clientHeight >= scrollHeight - 50px`, user is "at bottom"
  - [x] Only auto-scroll if user is at or near bottom; if user has scrolled up, do not force scroll
  - [x] Re-enable auto-scroll when user scrolls back to bottom
- [x] Implement streaming message display (AC: #5, #6)
  - [x] For messages with `isStreaming: true`, render content progressively as it arrives
  - [x] Show a blinking cursor/caret animation at the end of streaming text
  - [x] Remove cursor when streaming completes (`isStreaming` becomes false)
- [x] Implement message list and empty state (AC: #1, #2)
  - [x] Manage messages array with Preact `useState` in ChatWindow
  - [x] Set `role="log"` and `aria-live="polite"` on the message container for screen reader announcements
  - [x] Use `aria-label` (not `aria-labelledby`) for ARIA references since widget is inside Shadow DOM
  - [x] On empty state, display the greeting message from config as the first bot message
- [x] Create component stylesheet (AC: #3)
  - [x] Define all styles as constructable stylesheet within Shadow DOM
  - [x] Use `--cw-*` CSS variable namespace for all themeable properties
  - [x] Include `@keyframes` for streaming cursor blink animation

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

## Dev Agent Record

### Implementation Plan
- Created `MessageBubble` component with avatar, timestamp, and streaming cursor support
- Updated `MessageArea` from stub to full message list with auto-scroll and greeting empty state
- Updated `ChatWindow` to pass messages state, theme config (showTimestamp, avatarShape), and greeting to MessageArea
- Added `ChatMessage` type to shared types
- Added comprehensive message styles to constructable stylesheet (components.ts)

### Key Decisions
- Used actual CSS variable names from THEME_MAP (`--cw-msg-user-bg`, `--cw-avatar-bot-bg`, etc.) instead of story's placeholder names (`--cw-user-bubble-bg`)
- Timestamp boolean reads from `timestamps.show` (matching API schema), not `timestamps.enabled`
- Avatar shape read from `botAvatar.shape` in theme config
- Greeting message prepended as first bot message (id: `__greeting__`) rather than separate empty state component
- Auto-scroll uses `useRef` for tracking bottom position to avoid re-renders on scroll

### Completion Notes
- All 7 tasks completed with full AC coverage
- Type check, build, and lint all passing
- No backend changes (widget-only, no tests per CLAUDE.md frontend policy)

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| CR-1 | High | `toISOString()` unprotected — crashes if timestamp isn't a valid Date | Wrapped in `safeISOString()` try/catch helper |
| CR-2 | Med | Greeting `new Date()` created on every useMemo recompute — timestamp drifts | Memoized greeting timestamp via `useRef(new Date())` — stable across renders |
| CR-3 | Med | `white-space: pre-wrap` missing on `.cw-msg-text` — host page `nowrap` could break wrapping | Added `white-space: pre-wrap` to `.cw-msg-text` CSS rule |
| CR-4 | Med | No custom avatar image support — spec says "or custom image" | Added `Avatar` component with `<img>` + error fallback, reads `botAvatar.customImageUrl`/`userAvatar.customImageUrl` from theme |
| CR-5 | Med | `aria-modal="true"` on non-modal chat panel — screen reader browse mode can escape | Removed `aria-modal` — chat window is a panel, not a blocking modal |
| CR-6 | Med | Focus trap `activeElement` doesn't traverse nested shadow roots | Added recursive shadow root traversal loop for deepest active element |
| CR-7 | Low | No `overflow: hidden` on `.cw-msg-content` — long unbreakable strings could overflow in older browsers | Added `overflow: hidden` to `.cw-msg-content` |
| CR-8 | Low | Whitespace-only greeting rendered a visible bubble | Added `.trim()` guard before greeting length check |

## Senior Developer Review (AI)

- **Review Date:** 2026-03-26
- **Outcome:** Approved (with fixes applied)
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 8 actionable (10 rejected as noise)
- **Action Items:**
  - [x] High: Wrap `toISOString()` in safe try/catch (CR-1)
  - [x] Med: Memoize greeting timestamp with useRef (CR-2)
  - [x] Med: Add `white-space: pre-wrap` to `.cw-msg-text` (CR-3)
  - [x] Med: Add custom avatar image support with error fallback (CR-4)
  - [x] Med: Remove `aria-modal="true"` from chat window (CR-5)
  - [x] Med: Improve focus trap with nested shadow DOM traversal (CR-6)
  - [x] Low: Add `overflow: hidden` to `.cw-msg-content` (CR-7)
  - [x] Low: Trim greeting before length check (CR-8)

## File List
- `apps/widget/src/components/MessageBubble.tsx` (new)
- `apps/widget/src/components/MessageArea.tsx` (modified)
- `apps/widget/src/components/ChatWindow.tsx` (modified)
- `apps/widget/src/types/index.ts` (modified)
- `apps/widget/src/styles/components.ts` (modified)

## Change Log
- 2026-03-25: Implemented chat message display — MessageBubble component, avatar rendering, auto-scroll, streaming cursor, timestamp support, and full message stylesheet
- 2026-03-26: Fixed 8 code review findings — safe timestamp, greeting memoization, CSS hardening, custom avatar images, aria-modal removal, focus trap improvement
