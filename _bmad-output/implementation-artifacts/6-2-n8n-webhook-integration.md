# Story 6.2: n8n Webhook Integration

Status: done

## Story

As a **demo page user**,
I want my messages sent to n8n for AI processing and the response stored,
so that I get real AI-powered replies instead of simulated ones.

## Acceptance Criteria

1. **Given** a user sends a message via `POST /api/codeweaves/v1/public/chat/send`, **when** the request includes a valid agentId and chatInput, **then** the message is forwarded to the agent's n8n webhook URL.
2. **Given** no sessionId is provided, **when** the message is the first in a conversation, **then** a new ChatSession is created with a generated sessionId and source=DEMO, and the sessionId is returned.
3. **Given** a sessionId is provided, **when** the session exists and is ACTIVE, **then** the message is added to the existing session.
4. **Given** the n8n webhook is called, **when** the request is sent, **then** the payload includes `{ chatInput, sessionId }` and Content-Type is `application/json`.
5. **Given** n8n responds, **when** the response is received, **then** the `agentReply` field is extracted from the response JSON.
6. **Given** both user message and AI response, **when** they are processed, **then** both are stored as ChatMessage records (role USER and ASSISTANT respectively).
7. **Given** the full round-trip, **when** timestamps are captured, **then** metadata stores: `backendReceivedAt` (t1), `n8nReceivedAt` (t2 from n8n response), `agentRepliedAt` (t3 from n8n response), `backendRespondedAt` (t4), and calculated `responseLatencyMs`.
8. **Given** the n8n webhook does not respond within 10 seconds, **when** timeout occurs, **then** a friendly error message is returned and the error is logged.
9. **Given** the n8n webhook returns an error or is unreachable, **when** the error is caught, **then** a user-friendly error response is returned with appropriate HTTP status code.
10. **Given** an agent has no webhook URL configured, **when** a message is sent, **then** the DEFAULT_WEBHOOK_URL environment variable is used as fallback.

## Tasks / Subtasks

- [x] Task 1: Implement send message endpoint (AC: #1, #2, #3)
  - [x] Add `POST /send` route in PublicChatController
  - [x] Validate request body using `sendMessageSchema` from packages/validation
  - [x] Resolve agent by agentId (verify ACTIVE status, not deleted)
  - [x] If no sessionId: create new ChatSession (generate UUID sessionId, set source=DEMO)
  - [x] If sessionId provided: look up existing ChatSession, verify it belongs to the agent
  - [x] Store user message as ChatMessage (role=USER)
  - [x] Return sessionId + messageId in response

- [x] Task 2: Implement n8n webhook caller (AC: #4, #5, #8, #9, #10)
  - [x] Create private method `callN8nWebhook(webhookUrl, chatInput, sessionId)` in ChatService
  - [x] Use `fetch` with POST, Content-Type: application/json, body: `{ chatInput, sessionId }`
  - [x] Set AbortController timeout at 10 seconds
  - [x] Get webhook URL via `AgentsService.getEffectiveWebhookUrl(agentId)` (handles decryption + DEFAULT_WEBHOOK_URL fallback)
  - [x] Parse response: extract `agentReply` from response JSON (handle both `response.agentReply` and `response[0].agentReply` formats, and `response.output` / `response[0].output` as fallback)
  - [x] Handle errors: timeout → "Response is taking too long, please try again", network error → "Unable to connect, please try again", parse error → "Unexpected response format"

- [x] Task 3: Store AI response and track timestamps (AC: #6, #7)
  - [x] Record `backendReceivedAt` (t1) at start of endpoint handler
  - [x] Extract `n8nReceivedAt` (t2) and `agentRepliedAt` (t3) from n8n response JSON
  - [x] Record `backendRespondedAt` (t4) after n8n response received
  - [x] Calculate `responseLatencyMs = t4 - t1`
  - [x] Store AI response as ChatMessage (role=ASSISTANT, metadata: all timestamps + latency)
  - [x] Update ChatSession.lastMessageAt

- [x] Task 4: Write unit tests
  - [x] Test: successful message send + n8n call + response storage
  - [x] Test: new session creation when no sessionId provided
  - [x] Test: existing session reuse when sessionId provided
  - [x] Test: n8n timeout handling (10s)
  - [x] Test: n8n network error handling
  - [x] Test: agent not found / inactive error
  - [x] Test: missing webhook URL fallback to DEFAULT_WEBHOOK_URL
  - [x] Test: response format parsing (array vs object, agentReply vs output)

## Dev Notes

- The webhook URL is stored encrypted in AgentSecret table. Use `AgentsService.getWebhookUrl(agentId)` which handles decryption and falls back to `DEFAULT_WEBHOOK_URL` env var. Do NOT access AgentSecret directly.
- n8n response format (from Edit Fields node):
  ```json
  {
    "agentReply": "AI response text",
    "sessionId": "the-session-id",
    "n8nReceivedAt": "2026-02-28T05:23:36.500Z",
    "agentRepliedAt": "2026-02-28T05:23:37.855Z"
  }
  ```
  The response may also come as an array `[{...}]` — handle both.
  Fallback field: `output` (from n8n Chat Trigger path).
- The `sessionId` we generate is a UUID string that n8n uses for its conversation memory (Window Buffer Memory node). Same sessionId = same conversation thread in n8n.
- Use native `fetch` (available in Node 18+) for the webhook call. No need for axios.
- This endpoint is public (no auth) since demo page users are anonymous. Rate limiting will be added in a future story.
- The send endpoint returns the full response synchronously (not streaming). SSE streaming is handled in Story 6.3.

### Project Structure Notes

- `apps/api/src/controllers/public/public-chat.controller.ts` — add POST /send route
- `apps/api/src/services/chat.service.ts` — add sendMessage, callN8nWebhook methods
- `apps/api/test/chat/chat.service.spec.ts` — unit tests
- `apps/api/test/chat/public-chat.controller.spec.ts` — controller tests

### References

- [Source: apps/api/src/services/agents.service.ts#getWebhookUrl] — webhook URL retrieval + decryption + fallback
- [Source: apps/api/src/common/crypto/crypto.service.ts] — encryption/decryption service
- [Source: apps/api/scripts/test-n8n-webhook.ts] — tested n8n payload format and response structure
- [Source: docs/test workflow.json] — n8n workflow definition showing Edit Fields response mapping

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References

### Completion Notes List
- Task 1: Added `POST /send` route to PublicChatController with ZodValidationPipe(sendMessageSchema) validation. ChatService.sendMessage() resolves agent (ACTIVE, not deleted), creates new ChatSession with UUID sessionId (source=DEMO) when no sessionId provided, or looks up existing ACTIVE session belonging to the agent. Stores user message as ChatMessage (role=USER). Returns sessionId + messageId + reply.
- Task 2: Implemented private `callN8nWebhook()` method using native `fetch` with AbortSignal.timeout(10s). Uses `AgentsService.getEffectiveWebhookUrl()` for URL resolution (handles decryption + DEFAULT_WEBHOOK_URL fallback). Parses both object and array response formats, with `agentReply` primary and `output` fallback field. Error handling: TimeoutError → "Response is taking too long", network error → "Unable to connect", parse error → "Unexpected response format". All errors return BadGatewayException (502).
- Task 3: Records `backendReceivedAt` (t1) at handler start, extracts `n8nReceivedAt` (t2) and `agentRepliedAt` (t3) from n8n response, records `backendRespondedAt` (t4) after response, calculates `responseLatencyMs = t4 - t1`. Stores AI response as ChatMessage (role=ASSISTANT) with full timestamp metadata. Updates ChatSession.lastMessageAt.
- Task 4: 27 unit tests (24 service, 3 controller) covering all acceptance criteria. Service tests: successful flow, new session creation, session reuse, session not found, agent not found/inactive, n8n timeout, network error, non-ok status, webhook URL resolution, response parsing (object/array, agentReply/output fallback, missing fields, invalid JSON, missing timestamps). Controller tests: delegation to service, dto passthrough.
- Removed unused CryptoService injection from ChatService and CryptoModule import from ChatModule (using AgentsService.getEffectiveWebhookUrl instead of direct decryption).
- All validations pass: lint, check-types, build, test:cov (40 suites, 710 tests, 0 failures). chat.service.ts coverage: 100% statements/functions/lines, 88.88% branches.
- Code review fixes (3M, 3L): [M1] Moved webhook call before message storage + wrapped DB writes in $transaction to prevent orphaned messages on failure. [M2] Added @ApiResponse for 502 BadGatewayException. [M3] Extracted shared metadata object to avoid duplication. [L1] Added explicit ChatSession type annotation. [L2] Removed unused LoggerModule import. [L3] Truncated logged response body to 500 chars.
- Post-review validations pass: lint, check-types, build, test:cov (40 suites, 711 tests, 0 failures).

### Change Log
- 2026-03-01: Implemented story 6-2 — n8n webhook integration with send message endpoint, webhook caller, timestamp tracking, and comprehensive unit tests.
- 2026-03-01: Code review fixes — 6 issues resolved (3 Medium, 3 Low). Transaction-based message storage, Swagger 502 docs, metadata dedup, type safety, cleanup.

### File List
- `apps/api/src/controllers/public/public-chat.controller.ts` — POST /send route with validation and 502 Swagger docs
- `apps/api/src/services/chat.service.ts` — sendMessage() with transaction, callN8nWebhook(), typed session, truncated logging
- `apps/api/src/modules/chat.module.ts` — minimal imports (PrismaModule, AgentsModule only)
- `apps/api/test/services/chat/chat.service.spec.ts` — 25 service tests (incl. transaction and orphan prevention tests)
- `apps/api/test/controllers/chat/public-chat.controller.spec.ts` — 3 controller tests
