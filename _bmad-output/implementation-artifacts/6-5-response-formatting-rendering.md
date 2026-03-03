# Story 6.5: Response Formatting & Rendering

Status: done

## Story

As a **demo page visitor**,
I want AI responses to display formatted text (bold, links, lists, etc.),
so that responses are readable and visually structured instead of plain text walls.

## Acceptance Criteria

1. **Given** an AI response contains markdown bold (`**text**`), **when** rendered, **then** the text appears bold in the chat bubble.
2. **Given** an AI response contains markdown italic (`*text*`), **when** rendered, **then** the text appears italicized.
3. **Given** an AI response contains markdown links (`[text](url)`), **when** rendered, **then** clickable links appear that open in a new tab with `rel="noopener noreferrer"`.
4. **Given** an AI response contains markdown lists (ordered or unordered), **when** rendered, **then** they render as properly formatted lists with spacing.
5. **Given** an AI response contains code (inline `` `code` `` or fenced ` ```blocks``` `), **when** rendered, **then** code is displayed in monospace font with appropriate styling.
6. **Given** any rendered HTML, **when** displayed, **then** all dangerous elements are sanitized — no `<script>`, no `onclick` handlers, no XSS vectors.
7. **Given** a response is being streamed (chunks arriving), **when** partial markdown is in the buffer (e.g., `**bold` without closing `**`), **then** the display does not break — partial markdown is shown as plain text until the closing tag arrives, then re-rendered as formatted.
8. **Given** the formatted message component, **when** used, **then** it is a reusable component that can be used for both bot messages on the demo page and future widget.

## Tasks / Subtasks

- [x] Task 1: Create ChatMessageContent component (AC: #1, #2, #3, #4, #5, #8)
  - [x] Create `apps/web/components/features/chat/chat-message-content.tsx`
  - [x] Accept props: `content: string`, `isStreaming?: boolean`
  - [x] Use a lightweight markdown renderer (react-markdown or a custom minimal parser)
  - [x] Support: bold, italic, links, unordered lists, ordered lists, inline code, code blocks
  - [x] Links: render as `<a>` with `target="_blank" rel="noopener noreferrer"` and blue styling
  - [x] Code blocks: monospace background, padding, border-radius

- [x] Task 2: Add HTML sanitization (AC: #6)
  - [x] Sanitize rendered output to prevent XSS
  - [x] If using react-markdown: it escapes HTML by default (safe)
  - [x] If using dangerouslySetInnerHTML: use DOMPurify or similar to strip `<script>`, event handlers, etc.
  - [x] Verify: no raw HTML injection possible through markdown

- [x] Task 3: Handle streaming partial markdown (AC: #7)
  - [x] During streaming (isStreaming=true), render content through markdown parser on each update
  - [x] react-markdown handles partial markdown gracefully — unclosed tags render as plain text
  - [x] Test edge cases: `**bold` mid-stream, `` `code `` mid-stream, `[link](` mid-stream
  - [x] When streaming completes (isStreaming=false), final render ensures all markdown is properly parsed

- [x] Task 4: Integrate into demo page (AC: #8)
  - [x] Replace plain text `{msg.content}` in demo-page-client.tsx with `<ChatMessageContent content={msg.content} isStreaming={isStreamingMsg} />`
  - [x] Apply to bot messages only — user messages remain plain text
  - [x] Ensure styling works within the existing chat bubble layout (rounded corners, padding)

- [x] Task 5: Style the formatted content
  - [x] Bold/italic: inherit font, use standard weights
  - [x] Links: blue text, underline on hover
  - [x] Lists: proper indentation, bullet/number markers, spacing between items
  - [x] Code inline: gray background, monospace, slight padding
  - [x] Code blocks: dark background, light text, monospace, horizontal scroll if overflow
  - [x] Ensure all styles work with the existing white bot message bubble

## Dev Notes

- **Library choice:** `react-markdown` is the recommended approach — it's lightweight (~5KB gzipped), renders markdown to React components (no dangerouslySetInnerHTML), and handles partial markdown gracefully during streaming. Install: `bun add react-markdown` in apps/web.
- **Do NOT use `remark-gfm`** unless we need tables/strikethrough. Keep dependencies minimal.
- **XSS safety:** react-markdown does NOT render raw HTML by default — it escapes it. This is the safest approach. Do NOT enable the `rehype-raw` plugin.
- **Streaming considerations:** react-markdown re-renders efficiently on content changes. During streaming, the component receives updated content on each chunk. Unclosed markdown tags (like `**bold` without closing `**`) simply render as plain text with the asterisks visible, which is the expected behavior during streaming. Once the closing tag arrives in a subsequent chunk, it renders correctly.
- **Component reusability:** This component will be reused in the future Preact widget (Epic 5). Keep it framework-agnostic in terms of styling — use Tailwind classes that can be mapped to the widget's styling system later.
- **No frontend tests** per project convention.

### Project Structure Notes

- `apps/web/components/features/chat/chat-message-content.tsx` — new component
- `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` — modify to use new component
- `apps/web/package.json` — add react-markdown dependency

### References

- [Source: apps/web/app/agents/demo/[agentId]/demo-page-client.tsx] — current plain text rendering (line 222: `{msg.content}`)
- [Source: apps/web/components/features/agents/agent-editor/chat-widget-surface.tsx] — existing chat bubble styling patterns
- react-markdown: https://github.com/remarkjs/react-markdown

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A — no issues encountered during implementation.

### Completion Notes List
- Installed `react-markdown@10.1.0` in `apps/web` — lightweight markdown-to-React renderer (~5KB gzipped), no dangerouslySetInnerHTML
- Created reusable `ChatMessageContent` component with `memo()` for efficient re-renders during streaming
- Custom `Components` map renders: bold (`font-semibold`), italic, links (`target="_blank" rel="noopener noreferrer"`), ordered/unordered lists with proper indentation, inline code (gray bg, monospace), code blocks (dark bg, light text, monospace, overflow scroll)
- XSS safety: react-markdown escapes raw HTML by default — no `rehype-raw` plugin enabled, no `dangerouslySetInnerHTML` used
- Streaming: react-markdown gracefully handles partial markdown — unclosed tags render as plain text until closing arrives. Component is memoized and receives updated `content` on each SSE chunk
- Integration: bot messages in `demo-page-client.tsx` now render through `ChatMessageContent`; user messages remain plain text
- `isStreaming` prop passed to component using explicit `streamingMsgIdRef` tracking (not last-message assumption)
- All validations pass: lint, type-check, build, 745/745 tests
- **Code Review Fixes (2026-03-01):** 6 issues resolved (3H, 2M, 1L):
  - H1: Fixed code block detection — moved block styling to `pre` component so language-less fenced blocks render correctly
  - H2: Cleaned up unused `isStreaming` destructuring in component inner function
  - H3/M2: Simplified memo usage, removed unused prop from destructuring
  - M1: Removed dead `prose-sm` class (`@tailwindcss/typography` not installed)
  - M3: Replaced fragile last-message streaming detection with explicit `streamingMsgIdRef` tracking
  - L1: Removed unused `chat-message-content` CSS class from wrapper div

### Post-Story Fixes (PR #51 — fix/chat-streaming-fixes)

The following fixes and enhancements were added after the story was completed:

**1. Client-side typewriter animation for streaming responses**
- Added a character-by-character typewriter effect on the frontend for bot messages
- SSE chunks from the backend are buffered in `typewriterBufferRef` and dripped out 2 characters every 12ms via `setInterval`
- Constants: `TYPEWRITER_MS = 12`, `TYPEWRITER_CHARS = 2`
- Three new callbacks: `startTypewriter`, `stopTypewriter`, `flushTypewriterBuffer`
- Buffer is flushed immediately when the stream ends (`done` event) so no text is lost
- Abort/unmount cleanup stops the interval to prevent memory leaks

**2. Fix `sessionId: null` validation error on first message**
- Frontend was sending `sessionId: null` in the request body on the first message (no session yet)
- Zod `.optional()` allows `undefined` but rejects `null`, causing a 400 validation error
- Fixed by conditionally omitting the field: `...(sessionIdRef.current && { sessionId: sessionIdRef.current })`

**3. Fix missing spaces between SSE chunks (`chunkText`)**
- `ChatService.chunkText()` splits the full n8n response into word groups but was not adding trailing spaces between chunks
- Frontend concatenation produced "HowmayI" instead of "How may I"
- Fixed by appending a trailing space to all non-last chunks: `chunks.push(i + chunkSize < words.length ? chunk + ' ' : chunk)`
- Updated all related backend tests (746 total, all passing)

### File List
- `apps/web/components/features/chat/chat-message-content.tsx` — NEW
- `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` — MODIFIED (import + bot message rendering + typewriter animation + sessionId fix)
- `apps/web/package.json` — MODIFIED (added react-markdown dependency)
- `apps/api/src/services/chat.service.ts` — MODIFIED (chunkText trailing space fix)
- `apps/api/test/services/chat/chat.service.spec.ts` — MODIFIED (updated chunkText test expectations + new concatenation test)
- `bun.lock` — MODIFIED (lockfile updated)
