# Story 13.4: Real SSE Streaming for Text Chat

Status: ready-for-dev

## Story

As a **website visitor chatting with an agent**,
I want to see AI responses appear token-by-token in real time,
So that the chat feels responsive and natural instead of seeing fake word-by-word chunking.

## Acceptance Criteria

1. For agents with a `chatTriggerUrl`, the SSE endpoint streams real tokens from n8n Chat Trigger (not simulated word-splitting)
2. Each real token arrives as `data: {"type":"chunk","content":"..."}\n\n` (same format as current)
3. The final event is `data: {"type":"done","sessionId":"...","messageId":"...","metadata":{...}}\n\n`
4. Metadata includes `n8nReceivedAt`, `agentRepliedAt`, `streamingMode: "real"`, `timeToFirstToken`, `totalTokens`
5. The complete AI response is saved to the database after the stream ends
6. For agents WITHOUT a Chat Trigger URL, the existing simulated streaming continues to work unchanged
7. The frontend SSE client requires no changes (same event format)
8. The 30-second stream timeout still applies
9. Client disconnect (SSE `close` event) aborts the n8n request
10. Rate limiting still enforced before streaming begins
11. Unit tests cover both real and simulated streaming paths

## Tasks / Subtasks

- [ ] Task 1: Wire N8nStreamingService into controller (AC: 1, 6)
  - [ ] Inject `N8nStreamingService` and `AgentsService` into `PublicChatController`
  - [ ] In `stream()` method, after rate limit check, resolve agent and check for `chatTriggerUrl`
  - [ ] Branch: if `chatTriggerUrl` → real streaming path, else → existing simulated path

- [ ] Task 2: Implement real streaming path in controller (AC: 1, 2, 3, 4, 5, 8, 9)
  - [ ] Call `n8nStreamingService.streamFromChatTrigger()` to get AsyncGenerator
  - [ ] Iterate generator, writing each `item` chunk as SSE event
  - [ ] Track: `fullResponse` (concatenated text), `n8nBeginTimestamp`, `n8nEndTimestamp`, `firstTokenTime`, `tokenCount`
  - [ ] On stream end: build metadata, save assistant message to DB, send `done` event
  - [ ] On client disconnect (`res.on('close')`): signal abort to stop generator
  - [ ] Timeout still applies (30s from stream start)

- [ ] Task 3: Save user message timing (AC: 5)
  - [ ] Save user message BEFORE starting n8n stream (same as current `streamMessage`)
  - [ ] Save assistant message AFTER stream completes with full text + metadata
  - [ ] Update session `lastMessageAt`

- [ ] Task 4: Keep simulated path working (AC: 6)
  - [ ] Existing code path (`chatService.streamMessage()` + chunk delay loop) remains untouched
  - [ ] Only difference: the `if (chatTriggerUrl)` branch at the top

- [ ] Task 5: Update ChatModule (AC: 1)
  - [ ] Import N8nStreamingService in ChatModule providers (if not done in 13-3)
  - [ ] Ensure AgentsService is accessible (already imported via AgentsModule)

- [ ] Task 6: Unit tests (AC: 11)
  - [ ] Update `apps/api/test/controllers/public/public-chat.controller.spec.ts`
  - [ ] Add test: real streaming path — agent with chatTriggerUrl, mock generator yields chunks
  - [ ] Add test: simulated path still works — agent without chatTriggerUrl
  - [ ] Add test: client disconnect stops streaming
  - [ ] Add test: stream timeout sends error event
  - [ ] Add test: rate limit enforced before streaming starts

## Dev Notes

### Current Controller Code (What Changes)

The `stream()` method in `public-chat.controller.ts` (lines 45-109) currently:
1. Sets SSE headers
2. Checks rate limit
3. Calls `chatService.streamMessage(dto)` — which internally calls n8n webhook, gets full response, chunks it
4. Loops through chunks with 30ms delay, writing SSE events
5. Sends `done` event

**New flow for real streaming:**
1. Sets SSE headers (unchanged)
2. Checks rate limit (unchanged)
3. Resolves agent, checks for `chatTriggerUrl`
4. **If chatTriggerUrl exists:**
   - Saves user message to DB
   - Calls `n8nStreamingService.streamFromChatTrigger(url, message, sessionId)`
   - Iterates AsyncGenerator, writes each token as SSE `chunk` event (NO artificial delay)
   - On stream end: saves assistant message with metadata, sends `done` event
5. **If no chatTriggerUrl:**
   - Falls through to existing `chatService.streamMessage()` path (unchanged)

### Controller Implementation Pattern

```typescript
// In stream() method, after rate limit check:

const agent = await this.chatService.resolveAgent(dto.agentId);
const session = await this.chatService.resolveOrCreateSession(dto.agentId, dto.sessionId);
const chatTriggerUrl = await this.agentsService.getEffectiveChatTriggerUrl(dto.agentId);

if (chatTriggerUrl) {
  // REAL STREAMING PATH
  await this.handleRealStreaming(res, chatTriggerUrl, dto, session, timeout, closed);
} else {
  // LEGACY SIMULATED PATH (existing code, unchanged)
  await this.handleSimulatedStreaming(res, dto, timeout, closed);
}
```

### Key Concern: resolveAgent and resolveOrCreateSession are Private

`ChatService.resolveAgent()` (line 40) and `resolveOrCreateSession()` (line 51) are **private** methods. The controller currently doesn't call them directly — it calls `chatService.streamMessage()` which handles this internally.

**Options:**
1. Make them public/internal on ChatService
2. Duplicate agent/session resolution in controller
3. Add a new public method on ChatService like `prepareStream(dto)` that returns `{ agent, session }`

**Recommended: Option 1** — Change `resolveAgent` and `resolveOrCreateSession` to public. They're simple lookup methods with no side effects. The controller needs them for the branching decision.

### Metadata Shape (Real Streaming)

```typescript
const metadata = {
  backendReceivedAt: backendReceivedAt.toISOString(),
  n8nReceivedAt: n8nBeginTimestamp ? new Date(n8nBeginTimestamp).toISOString() : null,
  agentRepliedAt: n8nEndTimestamp ? new Date(n8nEndTimestamp).toISOString() : null,
  backendRespondedAt: new Date().toISOString(),
  responseLatencyMs: Date.now() - backendReceivedAt.getTime(),
  streamingMode: 'real',
  timeToFirstToken: firstTokenTime ? firstTokenTime - backendReceivedAt.getTime() : null,
  totalTokens: tokenCount,
  streamDurationMs: n8nEndTimestamp && n8nBeginTimestamp ? n8nEndTimestamp - n8nBeginTimestamp : null,
};
```

For the **simulated path**, metadata remains unchanged (no `streamingMode` field, or add `streamingMode: 'simulated'` for consistency).

### SSE Event Format (Unchanged for Frontend)

```
data: {"type":"chunk","content":"Hello"}\n\n
data: {"type":"chunk","content":"!"}\n\n
data: {"type":"chunk","content":" How"}\n\n
data: {"type":"chunk","content":" can"}\n\n
...
data: {"type":"done","sessionId":"uuid","messageId":"uuid","metadata":{...}}\n\n
```

The frontend consumes `type: "chunk"` and `type: "done"` events. Real streaming sends single tokens per chunk (vs 3-word chunks in simulated mode). Frontend doesn't care — it just appends `content` to the message. **No frontend changes needed.**

### Client Disconnect Handling

Current code (line 71-74):
```typescript
let closed = false;
res.on('close', () => {
  closed = true;
});
```

For real streaming, also need to abort the n8n fetch. Pass an `AbortController` to `streamFromChatTrigger()`:
```typescript
const abortController = new AbortController();
res.on('close', () => {
  closed = true;
  abortController.abort();
});
// Pass abortController.signal to streamFromChatTrigger
```

This requires `streamFromChatTrigger()` to accept an optional `AbortSignal` parameter (coordinate with Story 13-3 or add here).

### DB Operations Timing

| Operation | When | What |
|-----------|------|------|
| Save user message | Before stream starts | `chatMessage.create({ role: 'USER', content: dto.chatInput })` |
| Save assistant message | After stream ends | `chatMessage.create({ role: 'ASSISTANT', content: fullResponse, metadata })` |
| Update session | After stream ends | `chatSession.update({ lastMessageAt })` |

Same as current `streamMessage()` — user message saved first (may orphan on failure), assistant message saved after full response.

### Dependencies

- **Story 13-1**: `agentsService.getEffectiveChatTriggerUrl()` must exist
- **Story 13-3**: `N8nStreamingService.streamFromChatTrigger()` must exist
- Stories 13-1 and 13-3 must be complete before this story

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/api/src/controllers/public/public-chat.controller.ts` | MODIFY — add real streaming branch in `stream()`, inject new dependencies |
| `apps/api/src/services/chat.service.ts` | MODIFY — make `resolveAgent()` and `resolveOrCreateSession()` public |
| `apps/api/src/modules/chat.module.ts` | MODIFY — ensure N8nStreamingService registered (may be done in 13-3) |
| `apps/api/test/controllers/public/public-chat.controller.spec.ts` | MODIFY — add tests for real streaming path |
| `apps/api/test/services/chat/chat.service.spec.ts` | MODIFY — update if method visibility changes |

### References

- [Source: architecture.md#Section 12.1.1] — Full SSE controller implementation spec with real streaming
- [Source: architecture.md#Section 12.3] — Metadata extraction from streaming chunks
- [Source: public-chat.controller.ts#45-109] — Current stream() method (entire implementation)
- [Source: chat.service.ts#160-212] — Current streamMessage() with simulated chunking
- [Source: chat.service.ts#252-317] — callN8nWebhook() for reference
- [Source: public-chat.controller.spec.ts] — Existing test patterns (mock service, mock Response)

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
