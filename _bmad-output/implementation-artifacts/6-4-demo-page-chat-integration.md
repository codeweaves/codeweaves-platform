# Story 6.4: Demo Page Chat Integration

Status: done

## Story

As a **demo page visitor**,
I want to chat with a real AI agent on the demo page,
so that I can experience the agent's capabilities with actual AI-powered responses.

## Acceptance Criteria

1. **Given** I open the demo page and send a message, **when** the message is submitted, **then** it is sent to `POST /api/codeweaves/v1/public/chat/stream` and the AI response streams in word by word.
2. **Given** I send my first message, **when** no session exists, **then** a new session is created automatically and the sessionId is stored in component state for subsequent messages.
3. **Given** I send follow-up messages, **when** a sessionId exists, **then** the same sessionId is included in the request so n8n maintains conversation context.
4. **Given** the backend is streaming a response, **when** chunks arrive via SSE, **then** the bot message bubble updates incrementally — text appears word by word.
5. **Given** I send a message, **when** waiting for the first chunk, **then** a typing indicator (animated dots) is shown. Once streaming starts, the typing indicator is replaced by the growing message bubble.
6. **Given** the input field, **when** a response is streaming, **then** the input is disabled and the send button is not clickable.
7. **Given** the input field, **when** the stream completes (done event), **then** the input is re-enabled and focused for the next message.
8. **Given** an error event from SSE, **when** displayed, **then** a system error message appears in the chat (styled differently from bot messages) and the input is re-enabled.
9. **Given** I click a conversation starter, **when** it triggers, **then** the starter text is sent as a message through the same streaming flow.
10. **Given** multiple messages in the chat, **when** new content arrives (user message or streaming chunk), **then** the chat area auto-scrolls to show the latest content.

## Tasks / Subtasks

- [x] Task 1: Add session state management (AC: #2, #3)
  - [x] Add `sessionId` state (initially null) in DemoPageClient
  - [x] On first message send, sessionId is null → backend creates session → extract sessionId from `done` event response → store in state
  - [x] On subsequent messages, include sessionId in request body

- [x] Task 2: Replace simulated responses with SSE streaming (AC: #1, #4, #5)
  - [x] Remove the simulated bot response code (setTimeout + hardcoded message)
  - [x] Implement `sendMessageToBackend(content: string)` function using `fetch` with POST to `/public/chat/stream`
  - [x] Read the SSE response using `response.body.getReader()` and `TextDecoder`
  - [x] Parse each SSE line: extract `data:` payload, parse JSON, handle `type: chunk | done | error`
  - [x] On `chunk` events: append content to a growing bot message in state
  - [x] On `done` event: finalize message, extract sessionId, re-enable input
  - [x] Transition: typing indicator → first chunk arrives → growing message bubble

- [x] Task 3: Handle streaming message state (AC: #4, #6, #7)
  - [x] Add `streamingMessageId` state to track the currently streaming bot message
  - [x] When streaming starts: create a new bot message entry with empty content, set isTyping=false, set isStreaming=true
  - [x] As chunks arrive: update the message content by appending chunk text
  - [x] When done: clear streamingMessageId, set isStreaming=false, focus input
  - [x] Input disabled when `isTyping || isStreaming`

- [x] Task 4: Error handling (AC: #8)
  - [x] On SSE `error` event: display error message as a system message (e.g., gray background, italic text)
  - [x] On fetch failure (network error): display "Unable to connect. Please check your connection and try again."
  - [x] Re-enable input on any error
  - [x] Do NOT crash the chat — user should be able to retry

- [x] Task 5: Conversation starters integration (AC: #9)
  - [x] Wire `handleStarterClick` to use the new `sendMessageToBackend` function
  - [x] Hide starters after first message (existing behavior)

- [x] Task 6: Auto-scroll behavior (AC: #10)
  - [x] Existing scrollIntoView on messages change is retained
  - [x] Ensure auto-scroll triggers on streaming chunk updates (not just new messages)
  - [x] Use `messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })` in effect that watches messages array changes

## Dev Notes

- **SSE via fetch (NOT EventSource):** We're using `POST` for the stream endpoint, and the browser's `EventSource` API only supports `GET`. So we use `fetch()` with response body streaming:
  ```typescript
  const res = await fetch(apiUrl('/public/chat/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: agent.id, chatInput: content, sessionId }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  // Read chunks in a loop, parse SSE lines
  ```
- **SSE line parsing:** Each SSE event is `data: {...}\n\n`. When reading from the stream reader, chunks may contain partial lines or multiple lines. Buffer and split on `\n\n`, then parse each `data:` line.
- **Message state pattern:** Messages array contains `{ id, role, content, timestamp }`. During streaming, we create the bot message with empty content and update it in place as chunks arrive. Use functional state update: `setMessages(prev => prev.map(m => m.id === streamingId ? { ...m, content: m.content + chunk } : m))`.
- **No localStorage for sessionId** — just component state. If user refreshes the page, a new session starts. Persistent sessions are a future concern (widget/device ID from Epic 5).
- **Existing demo page:** `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` — this is the file to modify. The simulated bot response is in the `sendMessage` function (lines 71-98).
- **No frontend tests** per project convention — manual testing only for apps/web.

### Project Structure Notes

- `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` — modify existing file
- `apps/web/config/api.ts` — existing apiUrl helper (already used)

### References

- [Source: apps/web/app/agents/demo/[agentId]/demo-page-client.tsx] — current demo page with simulated responses
- [Source: apps/web/config/api.ts] — apiUrl function with /api/codeweaves/v1 prefix
- [Source: apps/api/src/controllers/public/public-chat.controller.ts] — SSE stream endpoint from Story 6.3

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
N/A

### Completion Notes List
- Replaced simulated bot response with real SSE streaming via `POST /public/chat/stream`
- Added `sessionIdRef` — null on first message, extracted from `done` SSE event, reused on subsequent messages
- Added `isStreaming` state to track in-flight bot message
- SSE parsing: buffer-based `\n\n` splitting, handles partial chunks, parses `data:` JSON lines
- Typing indicator shown while waiting for first chunk, then transitions to growing message bubble
- Input + send button + starters disabled when `isTyping || isStreaming` (`isBusy` shorthand)
- Input auto-focused after stream completes or error via `inputRef`
- System messages (role: `system`) styled distinctly: centered, gray bg, italic — for SSE errors and network failures
- Network errors caught in catch block: removes empty bot message shell if streaming hadn't started
- Auto-scroll retained via existing `useEffect` on `[messages, isTyping]` — messages array updates on every chunk, triggering scroll
- No frontend tests per project convention — manual testing only
- All ACs (#1–#10) satisfied

### Code Review Fixes (2026-03-01)
- [HIGH] Replaced `sessionId` state with `sessionIdRef` for stable `sendMessageToBackend` callback identity (no unnecessary re-renders)
- [MEDIUM] Added `AbortController` — aborts in-flight stream on unmount, prevents state updates on unmounted component
- [MEDIUM] Added client-side `AbortSignal.timeout(45s)` — shows "Request timed out" message on timeout
- [MEDIUM] SSE `error` event now cleans up empty bot message (same logic as catch block)
- [MEDIUM] Replaced `void sendMessage()` with `.catch(() => {})` — explicit unhandled-rejection prevention
- [LOW] Removed dead `streamingMessageIdRef` (unused ref)
- [LOW] Added `reader.releaseLock()` in finally block for proper stream cleanup

### File List
- `apps/web/app/agents/demo/[agentId]/demo-page-client.tsx` — modified (SSE streaming, session state, error handling, system messages)
