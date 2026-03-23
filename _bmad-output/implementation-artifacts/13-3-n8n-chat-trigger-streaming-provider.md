# Story 13.3: n8n Chat Trigger Streaming Provider

Status: ready-for-dev

## Story

As a **backend developer**,
I want an n8n provider that streams tokens from the Chat Trigger URL,
So that the backend can forward real tokens to the frontend via SSE.

## Acceptance Criteria

1. A `streamFromChatTrigger()` method exists that returns an `AsyncGenerator<N8nStreamChunk>`
2. The method POSTs to the Chat Trigger URL with `{ chatInput, sessionId }` and reads the chunked HTTP response
3. Each chunk is parsed as newline-delimited JSON (`{"type":"begin"|"item"|"end", ...}`)
4. `item` chunks yield their `content` field as individual tokens
5. `begin` and `end` chunk timestamps are captured in the yielded metadata
6. Malformed chunks are skipped without breaking the stream (logged as warnings)
7. A 30-second timeout aborts the request via `AbortSignal.timeout()`
8. A fallback `streamFromWebhook()` AsyncGenerator wraps the existing non-streaming webhook response into the same `N8nStreamChunk` interface
9. An `N8nStreamChunk` interface unifies both streaming modes
10. HMAC verification is supported for Chat Trigger responses (if agent has `hmacEnabled`)
11. Unit tests cover both streaming modes, timeout, malformed chunks, and HMAC verification

## Tasks / Subtasks

- [ ] Task 1: Define N8nStreamChunk interface (AC: 9)
  - [ ] Create `apps/api/src/services/n8n-stream.interface.ts`
  - [ ] Define `N8nStreamChunk` type: `{ type: 'begin'|'item'|'end'; content?: string; metadata?: { timestamp: number; nodeId?: string } }`

- [ ] Task 2: Implement `streamFromChatTrigger()` (AC: 1, 2, 3, 4, 5, 6, 7, 10)
  - [ ] Create `apps/api/src/services/n8n-streaming.service.ts`
  - [ ] POST to chatTriggerUrl with `{ chatInput, sessionId }` payload
  - [ ] Read response body as stream via `response.body.getReader()` + `TextDecoder`
  - [ ] Parse each newline-delimited JSON line into `N8nStreamChunk`
  - [ ] Yield chunks via `async *` generator
  - [ ] Handle partial chunks spanning read boundaries (buffer incomplete lines)
  - [ ] Skip malformed JSON with warning log
  - [ ] Apply 30s timeout via `AbortSignal.timeout(30_000)`
  - [ ] Support HMAC verification on full response (collect body for verification)

- [ ] Task 3: Implement `streamFromWebhook()` fallback (AC: 8)
  - [ ] Add method to same service
  - [ ] Call existing `callN8nWebhook()` logic (full HTTP request, wait for response)
  - [ ] Wrap response into `N8nStreamChunk` sequence: `begin` → single `item` with full text → `end`
  - [ ] Preserve existing metadata (n8nReceivedAt, agentRepliedAt) in begin/end chunks

- [ ] Task 4: Register as NestJS service (AC: 1)
  - [ ] Mark class as `@Injectable()`
  - [ ] Register in `ChatModule` providers
  - [ ] Inject dependencies: ConfigService, AgentsService, Logger

- [ ] Task 5: Unit tests (AC: 11)
  - [ ] Create `apps/api/test/services/chat/n8n-streaming.service.spec.ts`
  - [ ] Test streamFromChatTrigger: normal multi-chunk stream, single chunk, empty response
  - [ ] Test streamFromChatTrigger: malformed JSON chunk skipped
  - [ ] Test streamFromChatTrigger: timeout throws
  - [ ] Test streamFromWebhook: wraps full response into begin/item/end sequence
  - [ ] Test HMAC verification pass/fail
  - [ ] Mock `global.fetch` following existing pattern from `chat.service.spec.ts`

## Dev Notes

### n8n Chat Trigger Streaming Format (Verified)

The Chat Trigger URL returns a chunked HTTP response (NOT SSE). Each chunk is newline-delimited JSON:

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

The existing `chat.service.ts` has `callN8nWebhook()` (lines 252-317) and `streamMessage()` (lines 160-212). **Do NOT modify these** in this story. The new streaming service is a separate service. Story 13-4 will wire it into the controller.

### HMAC Consideration

The existing webhook HMAC verification (`chat.service.ts`, lines 288-290) verifies a signature over the full response body. For streaming, the full body isn't available until the stream ends. Options:
1. **Skip HMAC for Chat Trigger** — streaming responses can't be verified mid-stream
2. **Verify after stream completes** — collect full body, verify at end, but defeats streaming purpose

**Recommended approach:** Skip HMAC for Chat Trigger streaming. The Chat Trigger URL itself is encrypted and secret. If HMAC is critical, agents should use the webhook URL (non-streaming mode). Document this as a known trade-off.

### Service Structure

```typescript
// apps/api/src/services/n8n-streaming.service.ts
@Injectable()
export class N8nStreamingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  async *streamFromChatTrigger(
    chatTriggerUrl: string,
    message: string,
    sessionId: string,
  ): AsyncGenerator<N8nStreamChunk> {
    // POST → read chunked response → yield N8nStreamChunk per line
  }

  async *streamFromWebhook(
    webhookResponse: { agentReply: string; n8nReceivedAt?: string; agentRepliedAt?: string },
  ): AsyncGenerator<N8nStreamChunk> {
    // Wrap full response into begin → item → end sequence
    yield { type: 'begin', metadata: { timestamp: Date.parse(webhookResponse.n8nReceivedAt) } };
    yield { type: 'item', content: webhookResponse.agentReply };
    yield { type: 'end', metadata: { timestamp: Date.parse(webhookResponse.agentRepliedAt) } };
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
| `apps/api/src/services/n8n-streaming.service.ts` | CREATE — streaming provider |
| `apps/api/src/modules/chat.module.ts` | MODIFY — register N8nStreamingService |
| `apps/api/test/services/chat/n8n-streaming.service.spec.ts` | CREATE — unit tests |

### References

- [Source: architecture.md#ADR-013] — Streaming pipeline decision
- [Source: architecture.md#Section 12.1] — n8n Chat Trigger streaming format (verified chunk structure)
- [Source: architecture.md#Section 13.2] — streamFromChatTrigger and streamFromWebhook AsyncGenerator specs
- [Source: chat.service.ts#252-317] — Existing callN8nWebhook for reference (do not modify)
- [Source: chat.service.spec.ts] — Test patterns (fetch mocking, Response helpers)
- [Source: scripts/test-n8n-streaming.js] — Real streaming test script showing chunk format

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
