# Story 6.3: SSE Streaming Response

Status: done

## Story

As a **demo page user**,
I want to see the AI response appear word by word,
so that the chat feels responsive and natural even though n8n returns the full response at once.

## Acceptance Criteria

1. **Given** a user sends a message, **when** the backend receives the n8n response, **then** the response is streamed to the frontend via Server-Sent Events (SSE) with content-type `text/event-stream`.
2. **Given** the SSE stream, **when** chunks are sent, **then** each chunk is a `data:` event containing a JSON payload `{ "type": "chunk", "content": "word or phrase" }`.
3. **Given** the full response has been streamed, **when** the last chunk is sent, **then** a final event `data: { "type": "done", "sessionId": "xxx", "messageId": "xxx" }` is sent and the connection closes.
4. **Given** an error occurs during processing (n8n timeout, network error), **when** the error is caught, **then** an error event `data: { "type": "error", "message": "user-friendly error" }` is sent and the connection closes.
5. **Given** the SSE connection, **when** 30 seconds pass without completion, **then** the connection times out and sends an error event.
6. **Given** the simulated streaming, **when** the n8n response text is chunked, **then** chunks are split at word boundaries (not mid-word) with a configurable delay between chunks (~30-50ms per chunk) to simulate natural typing speed.
7. **Given** the endpoint, **when** called as `POST /api/codeweaves/v1/public/chat/stream`, **then** it accepts the same payload as the send endpoint (agentId, chatInput, sessionId) and returns an SSE stream.

## Tasks / Subtasks

- [x] Task 1: Create SSE streaming endpoint (AC: #1, #7)
  - [x] Add `POST /stream` route in PublicChatController
  - [x] Use NestJS `@Sse()` decorator or manual Response object with `text/event-stream` headers
  - [x] Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (for nginx/proxy)
  - [x] Validate request body using same `sendMessageSchema`

- [x] Task 2: Implement chunking logic (AC: #2, #6)
  - [x] Create `chunkText(text: string, chunkSize?: number): string[]` utility that splits text at word boundaries
  - [x] Default chunk size: 2-4 words per chunk for natural feel
  - [x] Respect sentence boundaries where possible (don't break mid-sentence if short)
  - [x] Add configurable delay between chunks (default 30ms)

- [x] Task 3: Implement stream orchestration (AC: #1, #2, #3, #4, #5)
  - [x] In ChatService, add `streamMessage(agentId, chatInput, sessionId?, source?)` method
  - [x] Call `callN8nWebhook()` from Story 6.2 to get full response
  - [x] Chunk the agentReply text
  - [x] Yield chunks as SSE events with delay between each
  - [x] Send `done` event with sessionId and messageId after all chunks sent
  - [x] On error, send `error` event with friendly message
  - [x] Set overall 30s timeout on the entire stream

- [x] Task 4: Store messages (same as 6.2 but from stream path) (AC: #3)
  - [x] Reuse session creation / message storage logic from Story 6.2
  - [x] Store user message BEFORE calling n8n
  - [x] Store AI message AFTER full response received (before streaming starts)
  - [x] Timestamps tracked same as Story 6.2

- [x] Task 5: Write unit tests
  - [x] Test: SSE response has correct content-type headers
  - [x] Test: chunks are split at word boundaries
  - [x] Test: done event contains sessionId and messageId
  - [x] Test: error event sent on n8n timeout
  - [x] Test: 30s overall connection timeout

## Dev Notes

- **Why simulated streaming?** n8n webhooks return the full response as JSON (not SSE). We receive the complete `agentReply` text, then chunk it into SSE events with small delays to create a typing effect. This gives a much better UX than showing the full response after a 2-3s wait.
- NestJS supports SSE via `@Sse()` decorator returning an `Observable<MessageEvent>`, or via raw Response streaming. The raw Response approach gives more control for our use case:
  ```typescript
  @Post('stream')
  async stream(@Body() body: SendMessageDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // ... write events with res.write() and res.end()
  }
  ```
- The `/stream` endpoint replaces the `/send` endpoint for the demo page flow. The `/send` endpoint from Story 6.2 remains available for non-streaming consumers (API integrations, testing, etc.).
- Chunk size tuning: 2-4 words per chunk at 30ms delay ≈ a comfortable reading pace. For a typical 50-word response, that's ~15-25 chunks over ~0.5-0.75s of streaming. Combined with the 2-3s n8n wait, total time is ~3-3.5s with the streaming portion feeling responsive.
- CORS: The demo page is on the same origin, so no CORS issues. Future widget will need CORS headers added.

### Project Structure Notes

- `apps/api/src/controllers/public/public-chat.controller.ts` — add POST /stream route
- `apps/api/src/services/chat.service.ts` — add streamMessage method, chunkText utility
- `apps/api/test/chat/chat.service.spec.ts` — add streaming tests

### References

- [Source: apps/api/src/controllers/public/public-chat.controller.ts] — controller from Story 6.1/6.2
- [Source: apps/api/src/services/chat.service.ts] — callN8nWebhook from Story 6.2
- NestJS SSE docs: https://docs.nestjs.com/techniques/server-sent-events

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
No issues encountered during implementation.

### Completion Notes List
- Extracted `resolveAgent` and `resolveOrCreateSession` private helpers from `sendMessage` to share with `streamMessage` — zero behavioral change, all 28 existing tests pass
- Added `chunkText(text, chunkSize=3)` static method on ChatService — splits at word boundaries, never mid-word, configurable chunk size
- Added `streamMessage(dto)` method — stores user message before n8n call, stores assistant message after response, chunks reply, returns structured result for controller SSE writing
- Added `POST /stream` endpoint on PublicChatController — sets SSE headers, writes chunk/done/error events with 30ms delay, 30s overall timeout, handles client disconnect via `res.on('close')`
- 34 new tests added (10 chunkText + 13 streamMessage + 11 controller stream)
- Total: 62 chat tests passing (28 existing + 34 new), 745 full suite passing
- chat.service.ts at 100% statement coverage

### Code Review Fixes Applied
- [L1] Renamed `wordsPerChunk` → `chunkSize` for consistency with method doc
- [L2] Made `chunkText` a `static` method — pure function, no instance state needed
- [L3] Extracted `buildMetadata()` private helper — replaced duplicated metadata construction in both `sendMessage` and `streamMessage`
- [M1] Added 30s timeout test with `jest.useFakeTimers()` to controller spec
- [M2] Removed misleading `@ApiResponse({ status: 404/502 })` from stream endpoint — SSE errors go through SSE events, not HTTP status codes
- [M3] Added orphaned user message test for `streamMessage` — verifies user msg stored before n8n call, and no assistant msg/session update on n8n failure

### File List
- `apps/api/src/services/chat.service.ts` — added `resolveAgent`, `resolveOrCreateSession`, `chunkText` (static), `streamMessage`, `buildMetadata`
- `apps/api/src/controllers/public/public-chat.controller.ts` — added `POST /stream` SSE endpoint
- `apps/api/test/services/chat/chat.service.spec.ts` — added chunkText (10) + streamMessage (13) tests
- `apps/api/test/controllers/chat/public-chat.controller.spec.ts` — added stream endpoint (11) tests

## Change Log
- 2026-03-01: Implemented SSE streaming response — endpoint, chunking, orchestration, message storage, and 32 unit tests
- 2026-03-01: Code review fixes — 3 MEDIUM + 3 LOW issues resolved, 2 new tests added, total 62 chat tests / 745 suite
