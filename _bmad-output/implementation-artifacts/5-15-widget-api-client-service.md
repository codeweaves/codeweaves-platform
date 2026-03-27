# Story 5-15: Widget API Client Service

Status: done

## Story

As a **website visitor**,
I want the widget to communicate reliably with the backend API,
So that my messages are sent and responses are received without errors or hangs.

## Acceptance Criteria

1. **Given** any API call from the widget
   **When** the request is made
   **Then** it goes through the centralized API client with consistent headers (`Content-Type`, `X-Device-Id`, `X-Session-Id`)

2. **Given** the backend returns a 429 rate limit response
   **When** the widget processes the response
   **Then** it shows a user-friendly "Please wait" message with the retry duration

3. **Given** a network failure occurs on an API call
   **When** the widget handles the error
   **Then** it retries once with exponential backoff before showing an error to the user

4. **Given** an API call exceeds the configured timeout
   **When** the timeout triggers
   **Then** the request is aborted via AbortController and an error is surfaced to the UI

5. **Given** the widget makes any HTTP request
   **When** no external HTTP library is used
   **Then** only native `fetch` API is used (bundle size constraint)

## Tasks / Subtasks

- [x] Task 1: Create API client module with base configuration (AC: 1)
  - [x] Create `apps/widget/src/services/api-client.ts`
  - [x] Read base URL from script tag `data-api-url` attribute (already parsed in Story 5-4 config-loader)
  - [x] Define default headers: `Content-Type: application/json`
  - [x] Accept `deviceId` and `sessionId` as parameters to attach as `X-Device-Id` and `X-Session-Id` headers
  - [x] Export a singleton-style module (not a class) for tree-shaking friendliness

- [x] Task 2: Implement `sendMessage()` method (AC: 1, 2, 5)
  - [x] Signature: `sendMessage(agentId: string, message: string, sessionId?: string, deviceId?: string): Promise<SendMessageResponse>`
  - [x] POST to `{baseUrl}/public/chat/send` with body `{ chatInput: message, agentId, sessionId }`
  - [x] Attach `X-Device-Id` header from `deviceId` parameter
  - [x] Parse response JSON and return typed `SendMessageResponse`
  - [x] Handle 429: extract `retryAfterSeconds` from response body, throw `WidgetApiError` with retryable flag and user message
  - [x] Handle 404: throw `WidgetApiError` with "Agent not found" message
  - [x] Handle 5xx: throw `WidgetApiError` with retryable flag

- [x] Task 3: Implement `streamMessage()` method (AC: 1, 2, 5)
  - [x] Signature: `streamMessage(agentId: string, message: string, sessionId?: string, deviceId?: string): Promise<ReadableStreamDefaultReader>`
  - [x] POST to `{baseUrl}/public/chat/stream` with body `{ chatInput: message, agentId, sessionId }`
  - [x] Return `response.body.getReader()` for the caller to consume SSE chunks
  - [x] NOTE: Cannot use native `EventSource` — it only supports GET requests; this endpoint is POST-based
  - [x] Handle 429 rate limit the same as `sendMessage()`
  - [x] Include SSE-specific headers if needed (Accept: text/event-stream)

- [x] Task 4: Implement SSE response parser utility (AC: 5)
  - [x] Create `parseSSEStream(reader: ReadableStreamDefaultReader)` async generator
  - [x] Decode `Uint8Array` chunks with `TextDecoder`
  - [x] Buffer partial lines, split on `\n\n` boundaries
  - [x] Parse `data: {...}` lines into typed objects: `{ type: 'chunk', content }`, `{ type: 'done', sessionId, messageId, metadata }`, `{ type: 'error', message }`
  - [x] Yield parsed events to the consumer

- [x] Task 5: Implement fetch timeout wrapper (AC: 4)
  - [x] Create `fetchWithTimeout(url, options, timeoutMs)` wrapper
  - [x] Use `AbortController` with `setTimeout` to abort after timeout
  - [x] Default timeout: 30000ms for chat endpoints, configurable per call
  - [x] Clear timeout on successful response to prevent leaking timers
  - [x] On abort, throw `WidgetApiError` with message "Request timed out"

- [x] Task 6: Implement retry logic (AC: 3)
  - [x] Wrap fetch calls with retry handler: 1 retry on 5xx or network error
  - [x] Exponential backoff: first retry after 1000ms
  - [x] Do NOT retry on 4xx (client errors are not retryable)
  - [x] Do NOT retry on timeout (already waited long enough)
  - [x] Track retry count to avoid infinite loops

- [x] Task 7: Define error types and error mapping (AC: 2, 3, 4)
  - [x] Create `WidgetApiError` class extending `Error` with properties: `status: number`, `userMessage: string`, `retryable: boolean`, `retryAfterSeconds?: number`
  - [x] Map HTTP 404 -> "Agent not found or inactive"
  - [x] Map HTTP 429 -> use `message` from response body (backend provides user-friendly text)
  - [x] Map HTTP 5xx -> "Something went wrong. Please try again."
  - [x] Map network error -> "Unable to connect. Please check your internet connection."
  - [x] Map timeout -> "Request timed out. Please try again."

## Dev Notes

### API Endpoints

The backend endpoints are defined in `apps/api/src/controllers/public/public-chat.controller.ts`:

- **POST `/public/chat/send`** — Non-streaming message send
  - Request body: `{ chatInput: string, agentId: string (UUID), sessionId?: string }`
  - Success response: `{ sessionId, messageId, reply, assistantMessageId, metadata }`
  - Rate limited response: `{ error: true, message: string, retryAfterSeconds: number }`

- **POST `/public/chat/stream`** — SSE streaming response
  - Request body: same as `/send`
  - SSE events:
    - `data: { "type": "chunk", "content": "..." }` — streamed token
    - `data: { "type": "done", "sessionId": "...", "messageId": "...", "metadata": {...} }` — stream complete
    - `data: { "type": "error", "message": "..." }` — error during stream

### Rate Limiting

Backend `MessageRateLimitService` extracts device ID from `X-Device-Id` header (falls back to IP).
- 10 messages per minute per device per agent
- 100 messages per hour per device per agent
- Rate limit response includes `retryAfterSeconds` for cooldown duration

### POST-based SSE

Native `EventSource` only supports GET requests. The streaming endpoint uses POST (to send the message body), so we must use `fetch()` with `response.body.getReader()` and manually parse the SSE text protocol (`data: ...\n\n` lines).

### Bundle Size Constraint

No external HTTP libraries (axios, ky, etc.). The widget must use only native `fetch`. This keeps the bundle minimal for embedding on third-party sites.

### Project Structure

```
apps/widget/src/
  services/
    api-client.ts       <- This story (main API client)
  utils/
    sse-parser.ts       <- SSE stream parser (or inline in api-client)
  types/
    index.ts            <- Add SendMessageResponse, StreamEvent types
```

### References

- Backend controller: `apps/api/src/controllers/public/public-chat.controller.ts`
- Chat service: `apps/api/src/services/chat.service.ts`
- Rate limit service: `apps/api/src/services/message-rate-limit.service.ts`
- Validation schema: `packages/validation/src/chat.ts` — `SendMessageDto`
- Config loader (base URL): `apps/widget/src/services/config-loader.ts` (Story 5-4)
- Device ID: Story 5-16
- Session management: Story 5-17
- Chat input integration: Story 5-18

## Senior Developer Review (AI)

- **Review Date:** 2026-03-27
- **Outcome:** Approved with changes
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Total Findings:** 11 raised, 3 patched, 3 deferred, 8 rejected
- **Action Items:**
  - [x] P1 (Med): Retry logic uses fragile string matching for timeout detection — Fixed: now checks `error instanceof WidgetApiError && !error.retryable`
  - [x] P2 (High): `streamMessage()` retries POST on 5xx risking duplicate messages — Fixed: added `retry: false` parameter for streaming calls
  - [x] P3 (Med): SSE parser only handles `\n\n`, not `\r\n\r\n` — Fixed: normalize `\r\n` and `\r` to `\n` before buffering

## Dev Agent Record

### Implementation Plan
- Built bottom-up: error types first, then fetch utils (timeout + retry), SSE parser, and finally the API client module
- Used singleton-style module pattern (exported functions) for tree-shaking friendliness
- Separated concerns into 3 files: api-errors.ts (error types), fetch-utils.ts (timeout + retry), api-client.ts (main client)
- SSE parser placed in utils/sse-parser.ts as a reusable async generator
- Added SendMessageResponse and RateLimitErrorBody types to existing types/index.ts

### Debug Log
- All 7 tasks implemented across 4 new files + 1 modified types file
- check-types: PASS
- lint: PASS (0 warnings)
- build: PASS
- bundle size: 19.58 KB gzipped (within 150 KB budget)

### Completion Notes
- Implemented centralized API client with consistent headers (Content-Type, X-Device-Id, X-Session-Id) — AC1
- Rate limit (429) handling extracts retryAfterSeconds and user message from response body — AC2
- Single retry with 1000ms backoff on 5xx/network errors; no retry on 4xx or timeout — AC3
- AbortController-based 30s timeout with clean timer cleanup — AC4
- Zero external HTTP dependencies; native fetch only — AC5
- SSE parser handles partial chunks, \n\n boundaries, and yields typed events

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | Med | Retry logic used fragile string matching (`error.message === '...'`) to detect timeouts | Changed to `error instanceof WidgetApiError && !error.retryable` |
| P2 | High | `streamMessage()` auto-retried POST on 5xx, risking duplicate DB records and AI invocations | Added `retry` parameter to `fetchWithRetry`; stream calls pass `retry: false` |
| P3 | Med | SSE parser only handled `\n\n` delimiter; `\r\n\r\n` from proxies would cause buffer to grow unbounded | Normalize `\r\n` and `\r` to `\n` before buffering |

## File List

- `apps/widget/src/services/api-client.ts` (new) — Main API client with sendMessage() and streamMessage()
- `apps/widget/src/services/api-errors.ts` (new) — WidgetApiError class and HTTP-to-error mapping
- `apps/widget/src/services/fetch-utils.ts` (new) — fetchWithTimeout and fetchWithRetry wrappers
- `apps/widget/src/utils/sse-parser.ts` (new) — SSE stream parser async generator
- `apps/widget/src/types/index.ts` (modified) — Added SendMessageResponse, RateLimitErrorBody types
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — Status updated
- `_bmad-output/implementation-artifacts/5-15-widget-api-client-service.md` (modified) — Story file updated

## Change Log

- 2026-03-27: Implemented widget API client service with all 7 tasks (error types, timeout, retry, SSE parser, API client with send/stream methods)
- 2026-03-27: Code review — 3 patches applied (fragile string matching, stream retry safety, SSE \r\n handling)
