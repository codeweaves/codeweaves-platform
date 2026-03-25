# Story 5-15: Widget API Client Service

Status: pending

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

- [ ] Task 1: Create API client module with base configuration (AC: 1)
  - [ ] Create `apps/widget/src/services/api-client.ts`
  - [ ] Read base URL from script tag `data-api-url` attribute (already parsed in Story 5-4 config-loader)
  - [ ] Define default headers: `Content-Type: application/json`
  - [ ] Accept `deviceId` and `sessionId` as parameters to attach as `X-Device-Id` and `X-Session-Id` headers
  - [ ] Export a singleton-style module (not a class) for tree-shaking friendliness

- [ ] Task 2: Implement `sendMessage()` method (AC: 1, 2, 5)
  - [ ] Signature: `sendMessage(agentId: string, message: string, sessionId?: string, deviceId?: string): Promise<SendMessageResponse>`
  - [ ] POST to `{baseUrl}/public/chat/send` with body `{ chatInput: message, agentId, sessionId }`
  - [ ] Attach `X-Device-Id` header from `deviceId` parameter
  - [ ] Parse response JSON and return typed `SendMessageResponse`
  - [ ] Handle 429: extract `retryAfterSeconds` from response body, throw `WidgetApiError` with retryable flag and user message
  - [ ] Handle 404: throw `WidgetApiError` with "Agent not found" message
  - [ ] Handle 5xx: throw `WidgetApiError` with retryable flag

- [ ] Task 3: Implement `streamMessage()` method (AC: 1, 2, 5)
  - [ ] Signature: `streamMessage(agentId: string, message: string, sessionId?: string, deviceId?: string): Promise<ReadableStreamDefaultReader>`
  - [ ] POST to `{baseUrl}/public/chat/stream` with body `{ chatInput: message, agentId, sessionId }`
  - [ ] Return `response.body.getReader()` for the caller to consume SSE chunks
  - [ ] NOTE: Cannot use native `EventSource` — it only supports GET requests; this endpoint is POST-based
  - [ ] Handle 429 rate limit the same as `sendMessage()`
  - [ ] Include SSE-specific headers if needed (Accept: text/event-stream)

- [ ] Task 4: Implement SSE response parser utility (AC: 5)
  - [ ] Create `parseSSEStream(reader: ReadableStreamDefaultReader)` async generator
  - [ ] Decode `Uint8Array` chunks with `TextDecoder`
  - [ ] Buffer partial lines, split on `\n\n` boundaries
  - [ ] Parse `data: {...}` lines into typed objects: `{ type: 'chunk', content }`, `{ type: 'done', sessionId, messageId, metadata }`, `{ type: 'error', message }`
  - [ ] Yield parsed events to the consumer

- [ ] Task 5: Implement fetch timeout wrapper (AC: 4)
  - [ ] Create `fetchWithTimeout(url, options, timeoutMs)` wrapper
  - [ ] Use `AbortController` with `setTimeout` to abort after timeout
  - [ ] Default timeout: 30000ms for chat endpoints, configurable per call
  - [ ] Clear timeout on successful response to prevent leaking timers
  - [ ] On abort, throw `WidgetApiError` with message "Request timed out"

- [ ] Task 6: Implement retry logic (AC: 3)
  - [ ] Wrap fetch calls with retry handler: 1 retry on 5xx or network error
  - [ ] Exponential backoff: first retry after 1000ms
  - [ ] Do NOT retry on 4xx (client errors are not retryable)
  - [ ] Do NOT retry on timeout (already waited long enough)
  - [ ] Track retry count to avoid infinite loops

- [ ] Task 7: Define error types and error mapping (AC: 2, 3, 4)
  - [ ] Create `WidgetApiError` class extending `Error` with properties: `status: number`, `userMessage: string`, `retryable: boolean`, `retryAfterSeconds?: number`
  - [ ] Map HTTP 404 -> "Agent not found or inactive"
  - [ ] Map HTTP 429 -> use `message` from response body (backend provides user-friendly text)
  - [ ] Map HTTP 5xx -> "Something went wrong. Please try again."
  - [ ] Map network error -> "Unable to connect. Please check your internet connection."
  - [ ] Map timeout -> "Request timed out. Please try again."

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
