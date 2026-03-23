# Story 13.3: n8n Streaming Provider

Status: done

## Story

As a **backend developer**,
I want a streaming provider that reads token-by-token chunks from the agent's webhookUrl (n8n Chat Trigger),
So that the backend can forward real tokens to the frontend via SSE.

## Acceptance Criteria

1. A `streamFromWebhookUrl()` method exists that returns an `AsyncGenerator<N8nStreamChunk>`
2. The method POSTs to the agent's webhookUrl with `{ chatInput, sessionId }` and reads the chunked HTTP response
3. Each chunk is parsed as newline-delimited JSON (`{"type":"begin"|"item"|"end", ...}`)
4. `item` chunks yield their `content` field as individual tokens
5. `begin` and `end` chunk timestamps are captured in the yielded metadata
6. Malformed chunks are skipped without breaking the stream (logged as warnings)
7. A 30-second timeout aborts the request via `AbortSignal.timeout()`
8. Client disconnect aborts the stream via an optional `AbortSignal` parameter
9. Partial chunks spanning TCP read boundaries are buffered correctly
10. An `N8nStreamChunk` interface defines the chunk shape
11. Unit tests cover streaming, timeout, malformed chunks, partial chunk buffering, and abort

## Tasks / Subtasks

- [x] Task 1: Define N8nStreamChunk interface (AC: 10)
  - [x] Create `apps/api/src/services/n8n-stream.interface.ts`
  - [x] Define `N8nStreamChunk` type: `{ type: 'begin'|'item'|'end'; content?: string; metadata?: { timestamp: number; nodeId?: string } }`

- [x] Task 2: Implement `streamFromWebhookUrl()` (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9)
  - [x] Create `apps/api/src/services/n8n-streaming.service.ts`
  - [x] POST to webhookUrl with `{ chatInput, sessionId }` payload
  - [x] Read response body as stream via `response.body.getReader()` + `TextDecoder`
  - [x] Parse each newline-delimited JSON line into `N8nStreamChunk`
  - [x] Yield chunks via `async *` generator
  - [x] Handle partial chunks spanning read boundaries (buffer incomplete lines)
  - [x] Skip malformed JSON with warning log
  - [x] Apply 30s timeout via `AbortSignal.timeout(30_000)`
  - [x] Accept optional `AbortSignal` parameter for client disconnect

- [x] Task 3: Register as NestJS service (AC: 1)
  - [x] Mark class as `@Injectable()`
  - [x] Register in `ChatModule` providers
  - [x] Logger instantiated via `new Logger(N8nStreamingService.name)` (project pattern, no ConfigService needed)

- [x] Task 4: Unit tests (AC: 11)
  - [x] Create `apps/api/test/services/chat/n8n-streaming.service.spec.ts`
  - [x] Test streamFromWebhookUrl: normal multi-chunk stream, single chunk, empty response
  - [x] Test streamFromWebhookUrl: malformed JSON chunk skipped
  - [x] Test streamFromWebhookUrl: partial chunk buffering across reads
  - [x] Test streamFromWebhookUrl: timeout throws
  - [x] Test streamFromWebhookUrl: abort signal cancels stream
  - [x] Mock `global.fetch` following existing pattern from `chat.service.spec.ts`

## Dev Notes

### n8n Chat Trigger Streaming Format (Verified)

The agent's `webhookUrl` points to an n8n Chat Trigger node which returns a chunked HTTP response (NOT SSE). Each chunk is newline-delimited JSON:

```
{"type":"begin","metadata":{"nodeId":"abc123","nodeName":"AI Agent1","timestamp":1774234478437}}
{"type":"item","content":"Hello","metadata":{"nodeId":"abc123","timestamp":1774234478500}}
{"type":"item","content":"!","metadata":{"nodeId":"abc123","timestamp":1774234478510}}
{"type":"item","content":" I","metadata":{"nodeId":"abc123","timestamp":1774234478520}}
{"type":"item","content":" can","metadata":{"nodeId":"abc123","timestamp":1774234478530}}
...
{"type":"end","metadata":{"nodeId":"abc123","timestamp":1774234480792}}
```

**Key details from real testing (47 chunks observed):**
- Content-Type: `application/json` (NOT `text/event-stream`)
- Transfer-Encoding: `chunked`
- Time to first chunk: ~701ms
- Average interval between chunks: ~54ms
- No `data:` prefix — raw JSON per line (NOT SSE format)

### Request Payload

Same as existing webhook but uses `chatInput` field (n8n Chat Trigger convention):
```typescript
{
  chatInput: message,        // User's message text
  sessionId: sessionId,      // Session ID for conversation continuity
}
```

n8n Chat Trigger uses `chatInput` (not `message` or `text`). This is a fixed convention.

### Partial Chunk Handling

TCP chunks don't align with JSON lines. A single `reader.read()` call may return:
- Multiple complete lines
- A line split across two reads
- An empty read

Buffer strategy:
```typescript
let buffer = '';
// In the read loop:
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split('\n');
buffer = lines.pop() || ''; // Last element may be incomplete — keep in buffer
for (const line of lines) {
  if (!line.trim()) continue;
  // Parse JSON...
}
```

### Existing Chat Service — Do NOT Modify

The existing `chat.service.ts` has `callN8nWebhook()` (lines 252-317) and `streamMessage()` (lines 160-212). **Do NOT modify these** in this story. The new streaming service is a separate service. Story 13-4 will wire it into the controller and replace the simulated streaming path.

### HMAC Consideration

The existing webhook HMAC verification (`chat.service.ts`, lines 288-290) verifies a signature over the full response body. For streaming, the full body isn't available until the stream ends. **Skip HMAC for streaming** — the webhookUrl is encrypted in AgentSecret. This is a known, accepted trade-off.

### Service Structure

```typescript
// apps/api/src/services/n8n-streaming.service.ts
@Injectable()
export class N8nStreamingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  async *streamFromWebhookUrl(
    webhookUrl: string,
    message: string,
    sessionId: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<N8nStreamChunk> {
    // POST to webhookUrl → read chunked response → yield N8nStreamChunk per line
    // Buffer partial chunks spanning TCP read boundaries
  }
}
```

### Test Patterns

Follow `chat.service.spec.ts` patterns:
- Mock `global.fetch` with `createMockResponse()` helper
- Use `ReadableStream` to simulate chunked responses:
```typescript
function createChunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}
```
- Consume async generator with `for await` loop in tests
- Test timeout by not resolving fetch within 30s (use jest.useFakeTimers if needed)

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/api/src/services/n8n-stream.interface.ts` | CREATE — N8nStreamChunk interface |
| `apps/api/src/services/n8n-streaming.service.ts` | CREATE — streaming service (single `streamFromWebhookUrl` method) |
| `apps/api/src/modules/chat.module.ts` | MODIFY — register N8nStreamingService |
| `apps/api/test/services/chat/n8n-streaming.service.spec.ts` | CREATE — unit tests |

### References

- [Source: architecture.md#ADR-013] — Streaming pipeline decision
- [Source: architecture.md#Section 12.1] — n8n Chat Trigger streaming format (verified chunk structure)
- [Source: architecture.md#Section 13.2] — streamFromChatTrigger and streamFromWebhook AsyncGenerator specs
- [Source: chat.service.ts#252-317] — Existing callN8nWebhook for reference (do not modify)
- [Source: chat.service.spec.ts] — Test patterns (fetch mocking, Response helpers)
- [Source: scripts/test-n8n-streaming.js] — Real streaming test script showing chunk format

## Senior Developer Review (AI)

**Review Date:** 2026-03-23
**Review Outcome:** Changes Requested
**Reviewer:** Claude Opus 4.6 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor)

### Action Items

- [x] **[High]** Abort signal not wired to `reader.read()` — client disconnect during active streaming won't cancel (AC 7, 8)
- [x] **[Med]** No runtime validation of parsed chunks — `as N8nStreamChunk` trusts any JSON, unknown types pass through
- [x] **[Med]** Missing `ConfigService` injection per dev notes spec — timeout hardcoded
- [x] **[Med]** `metadata` optional on begin/end chunks but AC 5 says timestamps "are captured" — no validation
- [x] **[Med]** Unbounded buffer growth — no max buffer size cap
- [x] **[Med]** Mid-stream abort/timeout errors in read loop unhandled — propagate as unhandled exceptions
- [x] **[Low]** `getReader()` call outside try/finally — potential reader lock leak
- [x] **[Low]** Non-OK responses don't read error body for diagnostics
- [ ] **[Defer]** SSRF risk on webhookUrl — pre-existing, URL comes from encrypted AgentSecret set by admin
- [ ] **[Defer]** sessionId log injection — pre-existing pattern across chat.service.ts
- [ ] **[Defer]** Plain `Error` instead of NestJS `HttpException` — consumer (13-4) will map errors
- [ ] **[Defer]** No content accumulation for DB persistence — 13-4 handles this at controller level
- [ ] **[Defer]** n8n workflow error behavior during streaming unknown — to be tested after Epic 13 completion

### Resolution Summary

All 8 actionable items (High + Med + Low) resolved in same session. 5 items deferred to future stories. 21 tests passing, 1205 total suite green.

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- Task 1: Created `N8nStreamChunk` interface with `N8nStreamChunkType`, `N8nStreamChunkMetadata`, and `VALID_CHUNK_TYPES` set for runtime validation. `begin.metadata.timestamp` → n8nReceivedAt, `end.metadata.timestamp` → agentRepliedAt.
- Task 2: Implemented `streamFromWebhookUrl()` async generator with all review fixes:
  - POSTs `{ chatInput, sessionId }` to webhookUrl
  - Reads chunked response via `ReadableStream.getReader()`, buffers partial lines across TCP boundaries
  - Runtime validation: verifies `type` field is `begin|item|end`, skips unknown types with warning
  - Validates metadata.timestamp presence on begin/end chunks (warns if missing, still yields)
  - Skips malformed JSON with warning
  - Configurable timeout via `ConfigService` (`N8N_STREAM_TIMEOUT_MS`, default 30s)
  - Client disconnect via optional `AbortSignal` combined with `AbortSignal.any()`
  - Mid-stream abort: wired `combinedSignal` abort listener to `reader.cancel()` for proper cleanup
  - Mid-stream timeout/abort errors caught in read loop and handled gracefully
  - Buffer size cap (1MB) prevents unbounded memory growth from malformed upstream
  - Error body reading on non-OK responses for better diagnostics
  - Extracted `parseChunk()` and `safeReadErrorBody()` private methods
- Task 3: Registered `N8nStreamingService` as `@Injectable()` in `ChatModule` providers and exports. Injects `ConfigService` for configurable timeout.
- Task 4: 21 unit tests covering: multi-chunk stream, single chunk, empty response, malformed JSON skip, partial chunk buffering, final chunk without trailing newline, timeout during fetch, abort during fetch, mid-stream abort, mid-stream timeout, HTTP 404 error with JSON body, HTTP 502 error with HTML body, network error, no body, multiple lines in single TCP chunk, empty line skipping, unknown chunk type filtering, missing type field filtering, begin/end missing metadata warning, buffer overflow, configurable timeout.

### Change Log
- 2026-03-23: Implemented story 13-3 — N8nStreamingService with 13 passing tests, all 1197 tests green.
- 2026-03-23: Code review fixes — abort signal wired to reader, runtime chunk validation, ConfigService injection, buffer cap, error body reading, 8 new tests (21 total, 1205 suite total).

### File List
- `apps/api/src/services/n8n-stream.interface.ts` (CREATE)
- `apps/api/src/services/n8n-streaming.service.ts` (CREATE)
- `apps/api/src/modules/chat.module.ts` (MODIFY)
- `apps/api/test/services/chat/n8n-streaming.service.spec.ts` (CREATE)
