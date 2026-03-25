# Story 5-19: SSE Streaming Integration

Status: ready-for-dev

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
- [ ] Create stream handler service (AC: #1, #2, #4, #5)
  - [ ] Create `apps/widget/src/services/stream-handler.ts`
  - [ ] Use `fetch()` with `response.body.getReader()` + `TextDecoder` for POST-based SSE (NOT native EventSource — that is GET-only)
  - [ ] POST to `/public/chat/stream` with JSON body: `{ agentId, chatInput, sessionId }`
  - [ ] Parse SSE response line-by-line: split on `\n`, filter empty lines, strip `data: ` prefix, parse JSON
  - [ ] Handle chunk types from backend:
    - `{ type: 'chunk', content: '...' }` — append token to message
    - `{ type: 'done', sessionId, messageId, metadata }` — finalize message
    - `{ type: 'error', message: '...' }` — display error in message bubble
  - [ ] Accept `AbortSignal` parameter for cancellation support
- [ ] Implement progressive message rendering (AC: #1, #2)
  - [ ] On first `chunk`: hide typing indicator, create new bot message bubble with `isStreaming: true`
  - [ ] On each subsequent `chunk`: append `content` to bot message, trigger re-render
  - [ ] On `done`: set `isStreaming: false`, update message metadata (sessionId, messageId)
  - [ ] On `error`: show error text in message bubble, set status to `'error'`
  - [ ] Show blinking cursor animation at end of streaming text (from Story 5-9 cursor keyframe)
- [ ] Implement streaming state signals (AC: #3, #6)
  - [ ] Preact signal: `isStreaming` (boolean) — true while stream is active
  - [ ] Preact signal: `streamingMessageId` (string | null) — ID of message being streamed
  - [ ] Disable chat input and send button while `isStreaming` is true
  - [ ] Show Stop button in place of send button during active stream
- [ ] Implement stream cancellation (AC: #3, #5)
  - [ ] Create `AbortController` per stream request
  - [ ] Stop button calls `abortController.abort()`
  - [ ] On abort: finalize partial message content as-is, set `isStreaming: false`
  - [ ] Re-enable chat input after cancellation
  - [ ] Clean up reader and controller references on cancel
- [ ] Implement timeout and error handling (AC: #4, #5)
  - [ ] Stream inactivity timeout: 60 seconds of no data received = assume dead connection
  - [ ] Use `setTimeout` reset on each chunk received; clear on stream end
  - [ ] On timeout: abort stream, finalize partial message, show "Response timed out" error
  - [ ] Network error during stream: finalize partial message, show error in bubble
  - [ ] Backend error event (`type: 'error'`): display `message` from payload in bubble
- [ ] Wire into chat flow (AC: #1, #6)
  - [ ] Default to streaming mode (non-streaming fallback via `config.streamingEnabled` if needed)
  - [ ] Export `streamMessage(agentId, chatInput, sessionId, signal)` function
  - [ ] On user send: show typing indicator, call `streamMessage()`, handle progressive rendering
  - [ ] On stream complete: store `sessionId` from `done` event for subsequent messages

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
