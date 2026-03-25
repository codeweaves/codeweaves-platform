# Story 5-21: Message History & State Management

Status: ready-for-dev

## Story
As a **website visitor**, I want my conversation history to persist within a session and the widget to manage state cleanly, so that I don't lose context when navigating between pages.

## Acceptance Criteria
1. All widget state managed through centralized Preact signals
2. Messages array capped at 50 (oldest dropped when exceeded)
3. Audio and text messages coexist with proper typing
4. Widget state transitions (closed/expanded/minimized) managed centrally
5. Last 10 messages restored from sessionStorage on page refresh (same session)
6. All components reactive to signal changes (no prop drilling)

## Tasks / Subtasks
- [ ] Create centralized chat store (AC: #1, #4, #6)
  - [ ] Create `apps/widget/src/state/chat-store.ts`
  - [ ] Use `@preact/signals` for reactive state (lightweight ~1KB, no Redux/Zustand needed)
  - [ ] Signal: `messages` — `Signal<Message[]>` array of all chat messages
  - [ ] Signal: `widgetState` — `Signal<'closed' | 'expanded' | 'minimized'>`
  - [ ] Signal: `isLoading` — `Signal<boolean>` (waiting for non-streaming response)
  - [ ] Signal: `isStreaming` — `Signal<boolean>` (active stream in progress)
  - [ ] Signal: `error` — `Signal<string | null>` (global error message)
  - [ ] Signal: `sessionId` — `Signal<string | null>` (current chat session ID)
  - [ ] Signal: `streamingMessageId` — `Signal<string | null>` (ID of message being streamed)
- [ ] Define Message types (AC: #3)
  - [ ] Create `apps/widget/src/types/message.ts`
  - [ ] `MessageType`: `'text' | 'audio' | 'system'`
  - [ ] `MessageRole`: `'user' | 'assistant'`
  - [ ] `MessageStatus`: `'sending' | 'sent' | 'error'`
  - [ ] `Message` interface:
    - `id: string` — unique message ID (UUID or backend-provided)
    - `role: MessageRole`
    - `type: MessageType`
    - `content: string` — text content (for text messages) or empty string (for audio messages)
    - `timestamp: Date`
    - `status: MessageStatus`
    - `isStreaming?: boolean` — true while message is being streamed
    - `audioUrl?: string` — object URL or server URL for audio playback
    - `audioDuration?: number` — duration in milliseconds
    - `audioBlob?: Blob` — raw audio blob for user recordings (not serialized to sessionStorage)
    - `errorMessage?: string` — error details for status: 'error'
- [ ] Implement message operations (AC: #1, #2)
  - [ ] `addMessage(message: Message): void` — append to `messages` array, enforce max 50 messages (drop oldest when exceeded, but never drop the greeting message if present)
  - [ ] `updateMessage(id: string, updates: Partial<Message>): void` — for streaming content append, status changes, audio URL updates
  - [ ] `removeMessage(id: string): void` — for failed message cleanup
  - [ ] `clearMessages(): void` — on session reset, also revoke all audio object URLs
  - [ ] All operations create new array references (signals detect changes via referential equality)
- [ ] Implement computed signals (AC: #1, #6)
  - [ ] `hasMessages: ReadonlySignal<boolean>` — computed from `messages.value.length > 0`
  - [ ] `lastMessage: ReadonlySignal<Message | undefined>` — computed from last item in messages array
  - [ ] `showStarters: ReadonlySignal<boolean>` — computed from `!hasMessages.value && conversationStarters.length > 0`
  - [ ] `canSend: ReadonlySignal<boolean>` — computed from `!isLoading.value && !isStreaming.value`
- [ ] Implement sessionStorage persistence (AC: #5)
  - [ ] On each `addMessage` / `updateMessage`: debounced save to sessionStorage (300ms debounce)
  - [ ] Save only last 10 messages (exclude audio blobs — not serializable)
  - [ ] Storage key: `cw_messages_{agentId}_{sessionId}`
  - [ ] On widget init: attempt restore from sessionStorage if matching `agentId` + `sessionId`
  - [ ] Restored audio messages show "Audio unavailable" state (blobs are not persisted)
  - [ ] Wrap all sessionStorage access in try/catch (storage may be full, disabled, or unavailable in iframes)
  - [ ] Clear stored messages on `clearMessages()` call
- [ ] Wire existing components to centralized store (AC: #1, #4, #6)
  - [ ] `ChatWindow`: read `widgetState` signal for open/close/minimize state
  - [ ] `MessageArea` / `MessageBubble`: read `messages` signal for message list
  - [ ] `ChatInput`: read `isLoading`, `isStreaming`, `canSend` for input disable state
  - [ ] `ConversationStarters`: read `showStarters` computed signal
  - [ ] `TypingIndicator`: read `isLoading` signal (show when waiting for first token)
  - [ ] Remove local `useState` / prop drilling for state that moves to the store

## Dev Notes

### Preact Signals
Preact signals (`@preact/signals`) provide fine-grained reactivity:
```ts
import { signal, computed } from '@preact/signals';

export const messages = signal<Message[]>([]);
export const isStreaming = signal(false);
export const hasMessages = computed(() => messages.value.length > 0);
```

Components that read `messages.value` automatically re-render when it changes. No manual subscriptions needed.

### Message Array Immutability
Signals detect changes via referential equality. All mutations must create new arrays:
```ts
// Correct
messages.value = [...messages.value, newMessage];
// Wrong — signal won't detect change
messages.value.push(newMessage);
```

### Max Messages Cap
- Cap at 50 messages to prevent memory bloat on long conversations
- When adding message 51, remove the oldest message (index 0)
- Exception: never remove the greeting message (id: `__greeting__`)

### SessionStorage Serialization
- Serialize: `JSON.stringify()` with `Date` -> ISO string, omit `audioBlob` field
- Deserialize: parse ISO strings back to `Date` objects, set `audioUrl` to `undefined` for audio messages (blob URLs are invalid after page reload)
- Key format: `cw_messages_{agentId}_{sessionId}` — scoped to both agent and session
- Max serialized size: ~50KB for 10 messages (well within sessionStorage 5MB limit)

### Audio Message Handling
- Audio messages store `audioUrl` (object URL for local recordings, server URL for bot responses)
- `audioBlob` is kept in memory for user recordings but NOT persisted to sessionStorage
- On session restore: audio messages appear with "Audio unavailable" placeholder
- On `clearMessages()`: revoke all object URLs via `URL.revokeObjectURL()`

### Component Structure
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- CSS variables: `--cw-*` namespace
- Preact components use `class` attribute (not `className`)

### References
- Existing message state: `apps/widget/src/components/ChatWindow.tsx` (currently uses local `useState`)
- Message type: `apps/widget/src/types/index.ts` (`ChatMessage` type)
- ConversationStarters: `apps/widget/src/components/ConversationStarters.tsx`
- Preact signals docs: https://preactjs.com/guide/v10/signals/
