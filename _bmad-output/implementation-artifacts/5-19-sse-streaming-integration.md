# Story 5-19: SSE Streaming Integration

Status: done

## Story
As a **website visitor**, I want to see AI responses appear word-by-word in real time, so that I get immediate feedback and the conversation feels natural.

## Acceptance Criteria
1. AI response tokens appear progressively in real-time as they stream
2. Typing indicator shows until first token arrives, then hides
3. User can cancel an active stream with a Stop button
4. Stream timeout (60s with no data) is handled gracefully
5. Partial messages are preserved on error or cancellation
6. Chat input is re-enabled after stream completes or is cancelled

## Tasks / Subtasks
- [x] Create stream handler service (AC: #1, #2, #4, #5)
  - [x] Create `apps/widget/src/services/stream-handler.ts`
  - [x] Use `fetch()` with `response.body.getReader()` + `TextDecoder` for POST-based SSE (NOT native EventSource — that is GET-only)
  - [x] POST to `/public/chat/stream` with JSON body: `{ agentId, chatInput, sessionId }`
  - [x] Parse SSE response line-by-line: split on `\n`, filter empty lines, strip `data: ` prefix, parse JSON
  - [x] Handle chunk types from backend:
    - `{ type: 'chunk', content: '...' }` — append token to message
    - `{ type: 'done', sessionId, messageId, metadata }` — finalize message
    - `{ type: 'error', message: '...' }` — display error in message bubble
  - [x] Accept `AbortSignal` parameter for cancellation support
- [x] Implement progressive message rendering (AC: #1, #2)
  - [x] On first `chunk`: hide typing indicator, create new bot message bubble with `isStreaming: true`
  - [x] On each subsequent `chunk`: append `content` to bot message, trigger re-render
  - [x] On `done`: set `isStreaming: false`, update message metadata (sessionId, messageId)
  - [x] On `error`: show error text in message bubble, set status to `'error'`
  - [x] Show blinking cursor animation at end of streaming text (from Story 5-9 cursor keyframe)
- [x] Implement streaming state signals (AC: #3, #6)
  - [x] Preact signal: `isStreaming` (boolean) — true while stream is active
  - [x] Preact signal: `streamingMessageId` (string | null) — ID of message being streamed
  - [x] Disable chat input and send button while `isStreaming` is true
  - [x] Show Stop button in place of send button during active stream
- [x] Implement stream cancellation (AC: #3, #5)
  - [x] Create `AbortController` per stream request
  - [x] Stop button calls `abortController.abort()`
  - [x] On abort: finalize partial message content as-is, set `isStreaming: false`
  - [x] Re-enable chat input after cancellation
  - [x] Clean up reader and controller references on cancel
- [x] Implement timeout and error handling (AC: #4, #5)
  - [x] Stream inactivity timeout: 60 seconds of no data received = assume dead connection
  - [x] Use `setTimeout` reset on each chunk received; clear on stream end
  - [x] On timeout: abort stream, finalize partial message, show "Response timed out" error
  - [x] Network error during stream: finalize partial message, show error in bubble
  - [x] Backend error event (`type: 'error'`): display `message` from payload in bubble
- [x] Wire into chat flow (AC: #1, #6)
  - [x] Default to streaming mode (non-streaming fallback via `config.streamingEnabled` if needed)
  - [x] Export `streamMessage(agentId, chatInput, sessionId, signal)` function
  - [x] On user send: show typing indicator, call `streamMessage()`, handle progressive rendering
  - [x] On stream complete: store `sessionId` from `done` event for subsequent messages

## Dev Notes

### Backend SSE Format
The backend at `POST /public/chat/stream` returns SSE-formatted response with `Content-Type: text/event-stream`. Each event is a `data:` line followed by `\n\n`:

```
data: {"type":"chunk","content":"Hello"}\n\n
data: {"type":"chunk","content":" world"}\n\n
data: {"type":"done","sessionId":"...","messageId":"...","metadata":{...}}\n\n
```

Error events:
```
data: {"type":"error","message":"Stream timeout - response took too long"}\n\n
data: {"type":"error","message":"Rate limit exceeded"}\n\n
```

### POST-based SSE Pattern
```ts
const response = await fetch('/public/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId, chatInput, sessionId }),
  signal: abortController.signal,
});
const reader = response.body!.getReader();
const decoder = new TextDecoder();
```

Parse each chunk:
```ts
const text = decoder.decode(value, { stream: true });
// Split on \n, filter empty, strip "data: " prefix, JSON.parse
```

### Request Body
Uses the same `sendMessageSchema` as non-streaming endpoint:
```ts
{ agentId: string, chatInput: string, sessionId?: string }
```

### Streaming State
- `isStreaming` signal disables input and shows Stop button
- `streamingMessageId` tracks which message is actively being streamed
- On first chunk: create message with `isStreaming: true` and `status: 'sending'`
- On done: update message with `isStreaming: false` and `status: 'sent'`

### Timeout Strategy
- Backend has its own 30s timeout (`STREAM_TIMEOUT_MS` in controller)
- Widget uses a longer 60s inactivity timeout (reset on each chunk) as a safety net
- If backend timeout fires first, widget receives `type: 'error'` event

### Component Structure
- **File**: `apps/widget/src/services/stream-handler.ts`
- Preact component: use `class` attribute (not `className`), import hooks from `preact/hooks`
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- CSS variables: `--cw-*` namespace

### References
- Backend streaming endpoint: `apps/api/src/controllers/public/public-chat.controller.ts` (`POST /public/chat/stream`)
- N8n streaming service: `apps/api/src/services/n8n-streaming.service.ts`
- SSE chunk format: `apps/api/src/services/n8n-stream.interface.ts`
- Streaming cursor animation: Story 5-9 (`@keyframes` in `apps/widget/src/styles/components.ts`)
- Typing indicator: Story 5-11 (`apps/widget/src/components/TypingIndicator.tsx`)

## Dev Agent Record

### Implementation Plan
- Created `stream-handler.ts` service that orchestrates SSE streaming via callbacks (onFirstChunk, onChunk, onDone, onError)
- Rewrote `useChat` hook to use streaming by default instead of non-streaming `sendMessage`
- Added `isStreaming`, `stopStream` to useChat return interface
- Updated `ChatInput` with conditional Stop button (red square icon) during active streaming
- Updated `ChatWindow` to wire streaming state: typing indicator hides on first chunk, input disabled during stream
- Added AbortSignal support to `streamMessage` in api-client and composed it with timeout in `fetchWithTimeout`
- Added 60s inactivity timeout in stream-handler (resets on each chunk received)
- Structured rate limit detection via WidgetApiError status (not text matching)

### Completion Notes
- All 6 tasks and all subtasks completed
- Stream handler uses callback pattern for clean separation from UI state
- AbortController per stream request enables both user cancellation and timeout abort
- Partial messages preserved on cancel/error (AC #5) — `isStreaming` flag cleared, content stays
- Session ID from `done` event stored via `updateSession()` for subsequent messages
- Existing SSE parser (`sse-parser.ts`) and streaming cursor (`cw-msg-cursor`) from prior stories reused
- Stop button styled with `--cw-stop-bg/--cw-stop-hover-bg` CSS variables for theme customization

## Senior Developer Review (AI)

- **Review Date:** 2026-03-27
- **Outcome:** Changes Requested → Fixed
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3 parallel layers)
- **Total Findings:** 17 raw → 9 actionable (8 rejected as noise)
- **Action Items:**
  - [x] **High** — P1: Stream ends without done event leaves UI stuck permanently. Fix: added fallback `onError('Stream ended unexpectedly')` after for-await loop.
  - [x] **Med** — P2: No guard against concurrent streams. Fix: abort existing `streamHandleRef` before starting new stream.
  - [x] **Med** — P3: `onDone` replaces message ID mid-render. Fix: keep stable client-side ID, don't swap to server ID.
  - [x] **Med** — P4: Rate limit detection via fragile text matching. Fix: structured `WidgetApiError` status 429 detection in stream-handler, passed via `StreamErrorOptions`.
  - [x] **Low** — P5: `streamingMessageId` tracked but unused by any component. Fix: removed dead state.
  - [x] **Low** — P6: `onDone` callback drops metadata parameter. Fix: accepted metadata in signature (available for future use).
  - [x] **Low** — P7: Empty first chunk creates empty bot bubble. Fix: skip chunks with falsy content.
  - [x] **Low** — D1: SSE parser silently swallows malformed JSON. Fix: added `console.warn` for debugging.
  - [x] **Low** — D2: Cursor keyframe verified as reuse from Story 5-9 (already in widget styles). No fix needed.

## Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | High | Stream ending without done/error event leaves UI permanently stuck (isLoading=true, input disabled) | Added `receivedDone` flag + fallback `onError('Stream ended unexpectedly')` after for-await loop in stream-handler.ts |
| P2 | Med | Concurrent stream starts overwrite streamHandleRef without aborting previous | Added explicit abort of existing stream handle before starting new one in sendMessage |
| P3 | Med | onDone replaces client-generated message ID with server ID, potential render-batch race | Kept stable client-side ID, removed ID swap in onDone |
| P4 | Med | Rate limit detection relied on regex text matching of error message strings | Added structured `StreamErrorOptions` with `rateLimited` flag, detected via `WidgetApiError.status === 429` in stream-handler catch |
| P5 | Low | `streamingMessageId` state maintained and returned but never consumed by any component | Removed dead state from useChat and ChatWindow |
| P6 | Low | `onDone` callback silently dropped `metadata` parameter from StreamCallbacks | Accepted full signature (sessionId, messageId, metadata) in onDone |
| P7 | Low | Empty content chunk (`""`) creates empty bot message bubble | Added `if (!event.content) break` guard in handleEvent |
| D1 | Low | SSE parser JSON parse failures silently returned null with no diagnostic output | Added `console.warn('[cw-widget] Failed to parse SSE data:', ...)` in catch block |

## File List
- `apps/widget/src/services/stream-handler.ts` (new)
- `apps/widget/src/hooks/useChat.ts` (modified)
- `apps/widget/src/services/api-client.ts` (modified — added signal param to streamMessage)
- `apps/widget/src/services/fetch-utils.ts` (modified — composed external signal with timeout)
- `apps/widget/src/components/ChatInput.tsx` (modified — Stop button)
- `apps/widget/src/components/ChatWindow.tsx` (modified — streaming state wiring)
- `apps/widget/src/styles/components.ts` (modified — Stop button CSS)
- `apps/widget/src/utils/sse-parser.ts` (modified — console.warn on parse failures)

## Change Log
- 2026-03-27: Implemented SSE streaming integration (Story 5-19) — stream handler, progressive rendering, Stop button, timeout/cancellation, chat flow wiring
- 2026-03-27: Addressed code review findings — 8 items fixed (1 High, 3 Med, 4 Low)
