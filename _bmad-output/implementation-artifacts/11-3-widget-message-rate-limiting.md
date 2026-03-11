# Story 11.3: Widget Message Rate Limiting

Status: done

## Story

As a **system**,
I want specific rate limits on chat messages sent through the widget,
so that widget abuse is prevented and the AI backend is protected from excessive message volume.

## Acceptance Criteria

1. **Given** a user sends chat messages via the `/public/chat/send` or `/public/chat/stream` endpoint, **When** they exceed 10 messages per minute, **Then** the message is rejected with a friendly, user-facing error message (not a raw HTTP 429).
2. **Given** a user sends chat messages, **When** they exceed 100 messages per hour, **Then** messages are rejected until the hour window resets, with a friendly error message.
3. **Given** rate limiting is per-device, **When** counting messages, **Then** the key includes the `deviceId` from the `X-Device-ID` request header, falling back to client IP if the header is absent.
4. **Given** rate limiting is per-agent, **When** counting messages, **Then** each agent has independent rate limit counters (a user can chat with multiple agents without cross-contamination).
5. **Given** the per-minute or per-hour limit is exceeded on the `/public/chat/send` endpoint, **When** the endpoint responds, **Then** it returns a JSON response with a user-friendly message like `"You're sending messages too quickly. Please wait a moment."` in the standard chat response format (not a raw 429 status).
6. **Given** the per-minute or per-hour limit is exceeded on the `/public/chat/stream` SSE endpoint, **When** the stream handler runs, **Then** an SSE error event is sent (e.g., `data: {"type":"error","message":"You're sending messages too quickly. Please wait a moment."}`) and the stream is closed gracefully — no HTTP 429 status (since SSE headers are already sent).
7. **Given** tests exist, **Then** unit tests cover: per-minute limit exceeded, per-hour limit exceeded, device+agent compound keying, IP fallback when no `X-Device-ID`, and friendly error format for both send and stream endpoints.

## Tasks / Subtasks

- [x] **Task 1: Create MessageRateLimitService** (AC: #1, #2, #3, #4)
  - [x] Create `apps/api/src/services/message-rate-limit.service.ts`
  - [x] Inject `RateLimiterService` from RedisModule
  - [x] Implement `checkMessageRateLimit(deviceId: string, agentPublicId: string): Promise<MessageRateLimitResult>`
  - [x] Two-tier check logic:
    1. Check minute limit: key `msg_rate:{deviceId}:{agentPublicId}:minute`, limit 10, window 60000ms
    2. Check hour limit: key `msg_rate:{deviceId}:{agentPublicId}:hour`, limit 100, window 3600000ms
    3. Both must pass — if either fails, return the rejection result
  - [x] Return type: `{ allowed: boolean; message?: string; retryAfterSeconds?: number }`
  - [x] Friendly messages:
    - Per-minute exceeded: `"You're sending messages too quickly. Please wait a moment."`
    - Per-hour exceeded: `"You've sent too many messages. Please try again later."`

- [x] **Task 2: Create helper to extract device identifier** (AC: #3)
  - [x] Add a `getDeviceIdentifier(request: Request): string` utility method (in the service or as a helper)
  - [x] Priority: `X-Device-ID` header > `request.ip` > `x-forwarded-for` header > `'unknown'`

- [x] **Task 3: Integrate rate limiting into PublicChatController** (AC: #1, #2, #5, #6)
  - [x] Modify `apps/api/src/controllers/public/public-chat.controller.ts`
  - [x] Inject `MessageRateLimitService` into the controller
  - [x] **`sendMessage` endpoint:** Before calling `chatService.sendMessage()`, check rate limit. If rejected, return a 200 response (not 429) with the friendly error in chat response format: `{ error: true, message: "..." }`
  - [x] **`stream` endpoint:** Before calling `chatService.streamMessage()`, check rate limit. If rejected, write an SSE error event and close the stream:
    ```
    data: {"type":"error","message":"You're sending messages too quickly. Please wait a moment."}
    ```
  - [x] Extract `deviceId` from `X-Device-ID` header, extract `agentPublicId` from the request body DTO
  - [x] This is an additional check on top of the general API rate limit (Story 11-2) — both apply

- [x] **Task 4: Register MessageRateLimitService** (AC: #1)
  - [x] Add `MessageRateLimitService` as a provider in `ChatModule` (`apps/api/src/modules/chat.module.ts`)
  - [x] Ensure `RedisModule` is available (it's global from Story 11-1)

- [x] **Task 5: Unit tests** (AC: #7)
  - [x] Create `apps/api/test/services/chat/message-rate-limit.service.spec.ts`
  - [x] Test: messages within minute limit — `allowed: true`
  - [x] Test: messages exceeding minute limit — `allowed: false` with per-minute friendly message
  - [x] Test: messages within minute limit but exceeding hour limit — `allowed: false` with per-hour friendly message
  - [x] Test: compound key uses `deviceId` + `agentPublicId`
  - [x] Test: IP fallback when `X-Device-ID` header is absent
  - [x] Create `apps/api/test/controllers/public/public-chat.controller.spec.ts` (or update if exists)
  - [x] Test: `sendMessage` returns friendly error JSON when rate limited (not 429)
  - [x] Test: `stream` sends SSE error event when rate limited
  - [x] Mock `RateLimiterService` — do NOT connect to real Redis

## Dev Notes

### Architecture Compliance

**This is separate from and additional to the general API rate limit (Story 11-2).** The general `RateLimitGuard` (APP_GUARD) runs first and enforces broad per-IP limits (30/min for public endpoints). This story adds a second, tighter, domain-specific check inside the chat controller for message-level rate limiting. Both checks must pass for a message to go through.

**The chat endpoints are `@Public()`.** There is no authenticated user — widget visitors don't log in. Rate limiting must be based on device ID (from `X-Device-ID` header already used for session tracking) combined with the agent's public ID. This gives per-device-per-agent granularity.

**Friendly errors, not HTTP 429.** The widget displays chat messages, not HTTP errors. For the `send` endpoint, return a normal HTTP 200 with an error payload so the widget can display it as a system message. For the `stream` endpoint, SSE headers are already written, so HTTP status can't change — send an SSE error event instead.

### Existing Patterns to Follow

**Chat controller pattern** — The existing `PublicChatController` (`apps/api/src/controllers/public/public-chat.controller.ts`) already handles errors gracefully in the stream endpoint by writing SSE error events. Follow this same pattern for rate limit errors.

**SSE error event format** — Follow the existing pattern:
```typescript
res.write(`data: ${JSON.stringify({ type: 'error', message: 'friendly message' })}\n\n`);
res.end();
```

**Service injection in controller** — Follow the existing `ChatService` injection pattern:
```typescript
constructor(
  private readonly chatService: ChatService,
  private readonly messageRateLimitService: MessageRateLimitService,
) {}
```

**DTO access** — The `sendMessageSchema` DTO (from `@repo/validation`) contains the `agentPublicId` field needed for the compound rate limit key.

### What This Story Does NOT Include

- **Redis infrastructure** — That's Story 11-1
- **General API rate limit guard** — That's Story 11-2
- **Configurable rate limits** — Limits are hardcoded constants (10/min, 100/hour); admin-configurable limits are a future feature
- **Rate limit UI feedback in the widget** — The widget already handles `type: 'error'` events; no widget changes needed
- **IP-based ban list** — Persistent abuse blocking is a future security enhancement
- **Rate limit analytics/monitoring** — Not in scope for this story

### Project Structure Notes

New files to create:
```
apps/api/src/services/message-rate-limit.service.ts                # Two-tier message rate limiting
apps/api/test/services/chat/message-rate-limit.service.spec.ts     # Service unit tests
apps/api/test/controllers/public/public-chat.controller.spec.ts    # Controller unit tests
```

Files to modify:
```
apps/api/src/controllers/public/public-chat.controller.ts   # Add rate limit checks before proxying
apps/api/src/modules/chat.module.ts                         # Register MessageRateLimitService
```

### Testing Approach

Mock `RateLimiterService` to control rate limit outcomes:

```typescript
const mockRateLimiterService = {
  checkRateLimit: jest.fn(),
};

// Simulate minute limit exceeded
mockRateLimiterService.checkRateLimit
  .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 45000, resetMs: Date.now() + 45000 });

// Simulate both limits passing
mockRateLimiterService.checkRateLimit
  .mockResolvedValueOnce({ allowed: true, remaining: 5, retryAfterMs: 0, resetMs: Date.now() + 60000 })
  .mockResolvedValueOnce({ allowed: true, remaining: 50, retryAfterMs: 0, resetMs: Date.now() + 3600000 });
```

For the controller tests, mock the Express `Response` object to verify SSE error events are written:

```typescript
const mockResponse = {
  setHeader: jest.fn(),
  write: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md -- Security Layer 5: Rate Limiting]
- [Source: _bmad-output/planning-artifacts/prd.md -- FR109: Sliding window algorithm, FR110: Client blocking]
- [Source: apps/api/src/controllers/public/public-chat.controller.ts -- Existing chat controller with SSE pattern]
- [Source: apps/api/src/modules/chat.module.ts -- ChatModule registration]
- [Source: _bmad-output/implementation-artifacts/11-1-rate-limiting-infrastructure-redis.md -- Redis infrastructure prerequisite]
- [Source: _bmad-output/implementation-artifacts/11-2-api-rate-limit-guard.md -- General API rate limit prerequisite]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed existing test file `test/controllers/chat/public-chat.controller.spec.ts` — added `MessageRateLimitService` mock provider and updated `sendMessage`/`stream` call signatures to include `req` parameter
- Fixed timeout test with fake timers — needed `await Promise.resolve()` to let rate limit mock resolve before advancing timers

### Completion Notes List
- Task 1+2: Created `MessageRateLimitService` with two-tier rate limiting (10/min, 100/hr) and `getDeviceIdentifier()` helper in a single service file. Uses compound key `msg_rate:{deviceId}:{agentId}:{window}` for per-device-per-agent granularity.
- Task 3: Integrated rate limit checks into both `sendMessage` (returns `{ error: true, message }` on rejection) and `stream` (sends SSE error event on rejection) endpoints. Added `@Req()` decorator to extract device identifier.
- Task 4: Registered `MessageRateLimitService` as provider in `ChatModule`. `RateLimiterService` available globally via `RedisModule`.
- Task 5: Created 11 service tests (checkMessageRateLimit + getDeviceIdentifier) and 17 controller tests (consolidated). 53 suites, 973 total passes, 0 failures.
- Code review fixes: [M1] Reversed check order (hour first) to minimize phantom ZADD on minute counter. [M2] Added empty-string IP fallback test. [M3] Consolidated duplicate controller test files into `test/controllers/public/`. [L1] Surfaced `retryAfterSeconds` in send endpoint response. [L2] Added Logger with warn-level logging on rate limit hits.

### File List
- `apps/api/src/services/message-rate-limit.service.ts` (new)
- `apps/api/src/controllers/public/public-chat.controller.ts` (modified)
- `apps/api/src/modules/chat.module.ts` (modified)
- `apps/api/test/services/chat/message-rate-limit.service.spec.ts` (new)
- `apps/api/test/controllers/public/public-chat.controller.spec.ts` (new — consolidated from legacy + new)
- `apps/api/test/controllers/chat/public-chat.controller.spec.ts` (deleted — consolidated into public/)
