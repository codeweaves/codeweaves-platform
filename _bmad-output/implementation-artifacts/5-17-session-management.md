# Story 5-17: Widget Session Management

Status: pending

## Story

As a **website visitor**,
I want my chat conversation to persist within a browser tab,
So that I can close and reopen the widget without losing my conversation context.

## Acceptance Criteria

1. **Given** the visitor opens the widget and sends a message
   **When** they close and reopen the widget within the same tab
   **Then** the session ID is preserved and the conversation continues

2. **Given** no session exists yet
   **When** the visitor sends their first message
   **Then** a new session is created server-side and the returned session ID is stored

3. **Given** a stored session has expired server-side (6-hour inactivity timeout)
   **When** the widget sends a message with the expired session ID
   **Then** the backend returns 404, the widget clears the stale session, and a new session is created transparently

4. **Given** the visitor closes the browser tab
   **When** they open a new tab with the same page
   **Then** a fresh session starts (sessionStorage is tab-scoped)

5. **Given** the widget's `destroy()` method is called
   **When** cleanup runs
   **Then** the session ID is cleared from sessionStorage

## Tasks / Subtasks

- [ ] Task 1: Create session manager module (AC: 1, 2)
  - [ ] Create `apps/widget/src/services/session-manager.ts`
  - [ ] Create Preact signal: `sessionId` of type `Signal<string | null>`, initialized to `null`
  - [ ] Create Preact signal: `sessionActive` of type `Signal<boolean>`, initialized to `false`
  - [ ] Export `initSession(agentId: string)` to load session from storage on widget init

- [ ] Task 2: Implement session storage (AC: 1, 4)
  - [ ] Use `sessionStorage` (not localStorage) — scoped to tab, cleared on tab close
  - [ ] Storage key: `cw_session_{agentId}` — one session per agent per tab
  - [ ] Wrap all sessionStorage access in try/catch (private browsing, iframe restrictions)
  - [ ] On sessionStorage failure, fall back to in-memory signal only (no persistence)

- [ ] Task 3: Implement session initialization and resumption (AC: 1, 2)
  - [ ] `initSession(agentId)`: check sessionStorage for `cw_session_{agentId}`
  - [ ] If found, set `sessionId` signal to stored value and `sessionActive` to `true`
  - [ ] If not found, leave `sessionId` as `null` — session will be created on first message
  - [ ] Session creation happens server-side via `ChatService.resolveOrCreateSession()` when first message is sent

- [ ] Task 4: Implement session ID update from API response (AC: 2, 3)
  - [ ] Export `updateSession(agentId: string, newSessionId: string)` function
  - [ ] Called after API response returns a session ID (from `sendMessage` or `streamMessage` response)
  - [ ] Update `sessionId` signal and persist to sessionStorage
  - [ ] Set `sessionActive` to `true`

- [ ] Task 5: Implement session expiry handling (AC: 3)
  - [ ] Export `handleSessionError(agentId: string, statusCode: number)` function
  - [ ] On 404 or 410 response for session: call `clearSession(agentId)`
  - [ ] Clear `sessionId` signal to `null`, set `sessionActive` to `false`
  - [ ] Remove `cw_session_{agentId}` from sessionStorage
  - [ ] Next message send will omit `sessionId`, triggering server-side session creation

- [ ] Task 6: Implement session reset and cleanup (AC: 5)
  - [ ] Export `resetSession(agentId: string)` for manual session clear
  - [ ] Clear sessionStorage entry and reset signals
  - [ ] Export `destroySession(agentId: string)` called from widget `destroy()` lifecycle
  - [ ] `destroySession` clears storage and resets all signals to initial state

- [ ] Task 7: Wire session ID into API client (AC: 1, 2, 3)
  - [ ] Session manager exposes `getSessionId()` for API client to read current session ID
  - [ ] API client (Story 5-15) includes session ID in request body `{ sessionId }` field per `SendMessageDto` schema
  - [ ] After each API response, call `updateSession()` with the returned session ID

## Dev Notes

### Backend Session Handling

The backend `ChatService.resolveOrCreateSession()` in `apps/api/src/services/chat.service.ts`:
- If `sessionId` is provided: looks up active session, throws 404 if not found
- If `sessionId` is omitted: creates a new `ChatSession` with a server-generated UUID
- Session has `status: 'ACTIVE'` and `lastMessageAt` timestamp updated on each message
- Backend enforces 6-hour inactivity timeout (sessions with no activity become inactive)

### Session ID Flow

```
Widget init
  ├── Check sessionStorage for cw_session_{agentId}
  │     ├── Found → set sessionId signal
  │     └── Not found → sessionId stays null
  │
User sends first message
  ├── sessionId is null → omit from request body
  │     └── Backend creates new session → response includes sessionId
  │           └── Widget stores sessionId in sessionStorage + signal
  ├── sessionId exists → include in request body
  │     ├── Backend finds active session → continues conversation
  │     └── Backend returns 404 → session expired
  │           └── Widget clears session → next send creates new one
```

### sessionStorage vs localStorage

- `sessionStorage`: tab-scoped, cleared on tab close — ideal for chat sessions
- `localStorage`: persists across tabs/sessions — used for device ID (Story 5-16) and config cache (Story 5-4)
- Chat sessions should NOT persist across tab closes because the backend session may have expired

### SendMessageDto Schema

From `packages/validation/src/chat.ts`:
```typescript
{
  chatInput: string,        // message text (1-4000 chars)
  agentId: string,          // UUID
  sessionId?: string,       // optional, max 128 chars
}
```

The session ID is sent in the request body (not a header), matching the Zod validation schema.

### Project Structure

```
apps/widget/src/
  services/
    session-manager.ts    <- This story
    api-client.ts         <- Story 5-15 (consumer)
    config-loader.ts      <- Story 5-4 (provides agentId)
```

### References

- Backend session logic: `apps/api/src/services/chat.service.ts` — `resolveOrCreateSession()`
- Backend controller: `apps/api/src/controllers/public/public-chat.controller.ts` — uses session from dto
- Validation schema: `packages/validation/src/chat.ts` — `sendMessageSchema` with optional `sessionId`
- Device ID: Story 5-16 (separate concern, stored in localStorage)
- API client: Story 5-15 (sends session ID in request body)
- Chat input integration: Story 5-18 (triggers session creation on first message)
