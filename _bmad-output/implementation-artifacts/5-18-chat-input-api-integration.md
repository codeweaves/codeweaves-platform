# Story 5-18: Chat Input API Integration

Status: pending

## Story

As a **website visitor**,
I want to type a message and receive an AI response,
So that I can have a conversation with the agent through the chat widget.

## Acceptance Criteria

1. **Given** the visitor types a message and presses Enter or clicks Send
   **When** the message is submitted
   **Then** it appears immediately in the message list (optimistic UI) and the input clears

2. **Given** a message has been sent
   **When** the API responds with the bot's reply
   **Then** the reply appears in the message list as a bot message

3. **Given** a message has been sent
   **When** the API call is in progress
   **Then** a typing indicator is displayed and the input is disabled

4. **Given** the backend returns a 429 rate limit response
   **When** the widget handles the response
   **Then** it shows "You're sending messages too quickly. Please wait a moment." and disables input for the cooldown duration

5. **Given** the input is in a loading state
   **When** the visitor tries to type or send another message
   **Then** the input is disabled and no duplicate requests are sent

6. **Given** an API error occurs (network failure, timeout, server error)
   **When** the error is displayed
   **Then** it shows below the input area and auto-dismisses after 5 seconds

7. **Given** conversation starters are configured and the chat has no messages
   **When** the visitor clicks a conversation starter
   **Then** it triggers `sendMessage()` with the starter text (same flow as manual typing)

## Tasks / Subtasks

- [ ] Task 1: Create useChat hook (AC: 1, 2, 3, 5, 6)
  - [ ] Create `apps/widget/src/hooks/useChat.ts`
  - [ ] Define Preact signals: `messages` (array of `ChatMessage`), `isLoading` (boolean), `error` (string | null)
  - [ ] Implement `sendMessage(text: string)` function:
    1. Guard: if `isLoading` is true or `text.trim()` is empty, return early
    2. Set `isLoading` to `true`, clear `error`
    3. Add user message to `messages` array immediately (optimistic UI)
    4. Call `apiClient.sendMessage(agentId, text, sessionId, deviceId)`
    5. On success: add bot message to `messages` array, update session ID via session-manager
    6. On failure: set `error` signal with user-friendly message
    7. Set `isLoading` to `false` in finally block
  - [ ] Implement `clearError()` to reset error signal to null
  - [ ] Accept `agentId` as parameter (from widget config)

- [ ] Task 2: Wire ChatInput component to useChat hook (AC: 1, 5)
  - [ ] Import `useChat` hook in ChatWindow component
  - [ ] On form submit / Enter key press: call `sendMessage(inputText)`
  - [ ] Clear input text field after calling sendMessage (before API response)
  - [ ] Disable input element and send button when `isLoading` is true
  - [ ] Disable input for `retryAfterSeconds` duration on 429 rate limit (use setTimeout to re-enable)
  - [ ] Prevent Shift+Enter from submitting (allow multiline if supported)

- [ ] Task 3: Wire bot response display (AC: 2, 3)
  - [ ] Pass `messages` signal to MessageArea component (Story 5-9)
  - [ ] User messages: role `'user'`, rendered immediately on send
  - [ ] Bot messages: role `'assistant'`, added after API response received
  - [ ] Show typing indicator (Story 5-11 component) when `isLoading` is true and last message is from user
  - [ ] Auto-scroll to bottom on new message (MessageArea already handles this from Story 5-9)

- [ ] Task 4: Wire conversation starters (AC: 7)
  - [ ] Pass `sendMessage` function to ConversationStarters component (Story 5-10)
  - [ ] On starter click: call `sendMessage(starterText)` — identical to manual message flow
  - [ ] Starters component already handles its own fade-out after first message (Story 5-10)
  - [ ] Show starters only when `messages` array is empty (or contains only greeting)

- [ ] Task 5: Implement error display and auto-dismiss (AC: 4, 6)
  - [ ] Render error message below input area when `error` signal is non-null
  - [ ] Style error with `--cw-error-text` CSS variable, small font size, left-aligned
  - [ ] Auto-dismiss: set a 5-second timeout on error display, call `clearError()` after timeout
  - [ ] Clear timeout if user sends a new message before auto-dismiss
  - [ ] Rate limit error: show backend-provided message text, disable input for `retryAfterSeconds`

- [ ] Task 6: Implement rate limit cooldown UX (AC: 4)
  - [ ] On 429 `WidgetApiError`: extract `retryAfterSeconds` (default 5s if not provided)
  - [ ] Set `isLoading` to false but add separate `isRateLimited` signal
  - [ ] Disable input with visual indicator (e.g., placeholder text "Please wait...")
  - [ ] Use `setTimeout` to re-enable after cooldown period
  - [ ] Clear cooldown timeout on widget destroy

- [ ] Task 7: Implement empty state and welcome flow (AC: 7)
  - [ ] When `messages` array is empty, show greeting message from config as initial bot message
  - [ ] Show conversation starters below greeting if configured (from `config.agent.starters`)
  - [ ] After first message sent, starters fade out (handled by ConversationStarters component)
  - [ ] If no starters configured, show only the greeting message

## Dev Notes

### Message Flow (Non-Streaming)

```
User types "Hello" → clicks Send
  │
  ├── 1. Add { role: 'user', content: 'Hello', timestamp: now } to messages[]
  ├── 2. Clear input, set isLoading = true
  ├── 3. POST /public/chat/send { chatInput: 'Hello', agentId, sessionId? }
  │
  ├── Success: { sessionId, reply, assistantMessageId }
  │     ├── 4. Add { role: 'assistant', content: reply, timestamp: now } to messages[]
  │     ├── 5. updateSession(agentId, sessionId)
  │     └── 6. isLoading = false
  │
  └── Error: WidgetApiError
        ├── 4. Set error signal with userMessage
        └── 5. isLoading = false (user message stays in list)
```

### Integration Points

This story wires together several previously built components:
- **ChatInput** (Story 5-8): the text input and send button
- **MessageArea / MessageBubble** (Story 5-9): message display with auto-scroll
- **ConversationStarters** (Story 5-10): clickable starter prompts
- **TypingIndicator** (Story 5-11): loading state visual
- **API Client** (Story 5-15): HTTP calls
- **Device ID** (Story 5-16): `X-Device-Id` header
- **Session Manager** (Story 5-17): session ID tracking

### ChatMessage Type

Already defined in Story 5-9 types:
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}
```

### API Response Format

From `ChatService.sendMessage()`:
```typescript
{
  sessionId: string;      // server-assigned session UUID
  messageId: string;      // user message DB ID
  reply: string;          // AI response text
  assistantMessageId: string;
  metadata: { ... };      // timing metadata (not displayed in widget)
}
```

### Rate Limit Response Format

From `PublicChatController.sendMessage()` on 429:
```typescript
{
  error: true;
  message: "You're sending messages too quickly. Please wait a moment.";
  retryAfterSeconds: number;
}
```

Note: The rate limit response is returned as HTTP 200 with `error: true` in the body (not as HTTP 429 status). The API client should check for `response.error === true` in addition to HTTP status codes.

### Performance Considerations

- Optimistic UI: user message renders instantly, no wait for API roundtrip
- Input clears immediately on send — feels responsive
- Messages stored in Preact signals (in-memory) — no persistence yet (Story 5-21)
- Auto-dismiss errors to avoid stale error messages accumulating
- Debounce not needed: the `isLoading` guard prevents double-sends

### Streaming Mode

This story implements non-streaming mode only. Story 5-19 will add streaming support using the SSE stream from `POST /public/chat/stream` and the SSE parser from Story 5-15.

### Project Structure

```
apps/widget/src/
  hooks/
    useChat.ts              <- This story (main hook)
  components/
    ChatWindow.tsx          <- Modified: wire useChat, pass props down
    ChatInput.tsx           <- Modified: connect to sendMessage, disable on loading
    MessageArea.tsx         <- Already built (Story 5-9)
    MessageBubble.tsx       <- Already built (Story 5-9)
    ConversationStarters.tsx <- Modified: receive sendMessage callback
    TypingIndicator.tsx     <- Already built (Story 5-11)
  services/
    api-client.ts           <- Story 5-15
    session-manager.ts      <- Story 5-17
  utils/
    device-id.ts            <- Story 5-16
```

### References

- Backend controller: `apps/api/src/controllers/public/public-chat.controller.ts` — `/public/chat/send` endpoint
- Chat service: `apps/api/src/services/chat.service.ts` — `sendMessage()` return format
- Rate limit service: `apps/api/src/services/message-rate-limit.service.ts` — rate limit thresholds
- Validation schema: `packages/validation/src/chat.ts` — `SendMessageDto` (chatInput, agentId, sessionId)
- Message display: `apps/widget/src/components/MessageBubble.tsx` (Story 5-9)
- Conversation starters: `apps/widget/src/components/ConversationStarters.tsx` (Story 5-10)
