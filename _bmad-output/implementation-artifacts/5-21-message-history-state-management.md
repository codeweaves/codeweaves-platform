# Story 5-21: Message History & State Management

Status: done

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
- [x] Create centralized chat store (AC: #1, #4, #6)
  - [x] Create `apps/widget/src/state/chat-store.ts`
  - [x] Use `@preact/signals` for reactive state (lightweight ~1KB, no Redux/Zustand needed)
  - [x] Signal: `messages` — `Signal<Message[]>` array of all chat messages
  - [x] Signal: `widgetState` — `Signal<'closed' | 'expanded' | 'minimized'>`
  - [x] Signal: `isLoading` — `Signal<boolean>` (waiting for non-streaming response)
  - [x] Signal: `isStreaming` — `Signal<boolean>` (active stream in progress)
  - [x] Signal: `error` — `Signal<string | null>` (global error message)
  - [x] Signal: `sessionId` — `Signal<string | null>` (current chat session ID)
  - [x] Signal: `streamingMessageId` — `Signal<string | null>` (ID of message being streamed)
- [x] Define Message types (AC: #3)
  - [x] Create `apps/widget/src/types/message.ts`
  - [x] `MessageType`: `'text' | 'audio' | 'system'`
  - [x] `MessageRole`: `'user' | 'assistant'`
  - [x] `MessageStatus`: `'sending' | 'sent' | 'error'`
  - [x] `Message` interface:
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
- [x] Implement message operations (AC: #1, #2)
  - [x] `addMessage(message: Message): void` — append to `messages` array, enforce max 50 messages (drop oldest when exceeded, but never drop the greeting message if present)
  - [x] `updateMessage(id: string, updates: Partial<Message>): void` — for streaming content append, status changes, audio URL updates
  - [x] `removeMessage(id: string): void` — for failed message cleanup
  - [x] `clearMessages(): void` — on session reset, also revoke all audio object URLs
  - [x] All operations create new array references (signals detect changes via referential equality)
- [x] Implement computed signals (AC: #1, #6)
  - [x] `hasMessages: ReadonlySignal<boolean>` — computed from `messages.value.length > 0`
  - [x] `lastMessage: ReadonlySignal<Message | undefined>` — computed from last item in messages array
  - [x] `showStarters: ReadonlySignal<boolean>` — computed from `!hasMessages.value && conversationStarters.length > 0`
  - [x] `canSend: ReadonlySignal<boolean>` — computed from `!isLoading.value && !isStreaming.value`
- [x] Implement sessionStorage persistence (AC: #5)
  - [x] On each `addMessage` / `updateMessage`: debounced save to sessionStorage (300ms debounce)
  - [x] Save only last 10 messages (exclude audio blobs — not serializable)
  - [x] Storage key: `cw_messages_{agentId}_{sessionId}`
  - [x] On widget init: attempt restore from sessionStorage if matching `agentId` + `sessionId`
  - [x] Restored audio messages show "Audio unavailable" state (blobs are not persisted)
  - [x] Wrap all sessionStorage access in try/catch (storage may be full, disabled, or unavailable in iframes)
  - [x] Clear stored messages on `clearMessages()` call
- [x] Wire existing components to centralized store (AC: #1, #4, #6)
  - [x] `ChatWindow`: read `widgetState` signal for open/close/minimize state
  - [x] `MessageArea` / `MessageBubble`: read `messages` signal for message list
  - [x] `ChatInput`: read `isLoading`, `isStreaming`, `canSend` for input disable state
  - [x] `ConversationStarters`: read `showStarters` computed signal
  - [x] `TypingIndicator`: read `isLoading` signal (show when waiting for first token)
  - [x] Remove local `useState` / prop drilling for state that moves to the store

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

## Dev Agent Record

### Implementation Plan
- Installed `@preact/signals@2.9.0` as widget dependency
- Created `types/message.ts` with `Message`, `MessageType`, `MessageRole`, `MessageStatus` types
- Updated `types/index.ts` to re-export `Message` as `ChatMessage` for backward compatibility
- Created `state/chat-store.ts` with all signals, message operations, computed signals, sessionStorage persistence
- Refactored `useChat` hook to use store signals instead of local `useState` — keeps streaming orchestration, voice helpers, timer management
- Updated `Widget.tsx` to use `widgetState` from store, initialize persistence on config load, restore messages
- Updated `ChatWindow.tsx` to read state from store signals directly, eliminated `onClose/onMinimize/onExpand` prop drilling
- Updated `MessageArea.tsx` to read `messages` and `showTyping` from store
- Updated `ConversationStarters.tsx` to read `showStarters` from store
- Updated `TypingIndicator.tsx` to read `showTyping` from store

### Code Review Bugs/Errors Found & Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| P1 | High | `appendBotMessageText` used stale read-then-write pattern causing race condition | Added atomic `appendMessageContent` to store — single map operation avoids stale reads |
| P2 | High | `setVoiceLoading(true)` not syncing `loadingRef.current` — guard in sendMessage bypassed | Sync `loadingRef.current = loading` in both directions inside `setVoiceLoading` |
| P3 | High | `restoreMessages` accepted any parsed JSON with no validation — corrupt data crashes widget | Added `isValidMessageEntry` type guard, skip corrupt entries, validate Date parsing |
| P4 | Medium | Blob URL leak on `removeMessage` and message eviction in `addMessage` cap logic | Added `revokeBlobUrl` helper, called on both eviction (addMessage) and explicit removal |
| P5 | Medium | Storage key orphaning when sessionId changes (e.g. "none" → actual session ID) | Added `lastPersistedKey` tracker, clean up old key in `persistMessages` on key change |
| P6 | Medium | `clearMessages` didn't cancel pending debounced persist — stale data re-persisted after clear | Cancel `debounceTimer` at start of `clearMessages` before revoking URLs |
| P7 | Low | `NON_SERIALIZABLE_FIELDS` exported from message.ts but never used | Removed dead code |
| D1 | Medium | Multiple Widget instances share module-level store signals — silent corruption | Added `widgetMounted` singleton guard with dev warning, reset local signals on cleanup |
| D2 | Medium | `generateMessageId` used only `Math.random` — weak entropy, collision risk | Added `crypto.getRandomValues` primary + monotonic counter fallback |
| D3 | Medium | Late stream callbacks mutate store after abort/unmount | Added `streamAbortedRef` guard on all `onFirstChunk`/`onChunk`/`onDone`/`onError` callbacks |
| D4 | Low | Restored audio messages showed empty content — no indication audio unavailable | Audio messages without blob get `[Audio unavailable]` content on restore |
| D5 | Low | Stream abort on widget close — potential orphaned stream | Already covered by useChat cleanup effect + streamAbortedRef guard (no change needed) |

### Debug Log
- Lint caught 3 unused vars in ChatWindow (removed unused `messages`, `showTyping`, `startersVisible` signal reads that were no longer needed since child components read from store directly)

### Completion Notes
- All 6 acceptance criteria satisfied
- All tasks and subtasks completed
- TypeScript check-types passes cleanly
- ESLint passes with 0 warnings
- Build succeeds for all packages
- No backend changes — frontend-only story (no test:cov needed)

## File List
- `apps/widget/package.json` — added `@preact/signals` dependency
- `apps/widget/src/types/message.ts` — NEW: Message types (MessageType, MessageRole, MessageStatus, Message)
- `apps/widget/src/types/index.ts` — MODIFIED: re-export Message as ChatMessage
- `apps/widget/src/state/chat-store.ts` — NEW: centralized signal-based store
- `apps/widget/src/hooks/useChat.ts` — MODIFIED: refactored to use store signals
- `apps/widget/src/components/Widget.tsx` — MODIFIED: uses widgetState from store, init persistence
- `apps/widget/src/components/ChatWindow.tsx` — MODIFIED: reads state from store, simplified props
- `apps/widget/src/components/MessageArea.tsx` — MODIFIED: reads messages/showTyping from store
- `apps/widget/src/components/ConversationStarters.tsx` — MODIFIED: reads showStarters from store
- `apps/widget/src/components/TypingIndicator.tsx` — MODIFIED: reads showTyping from store

## Senior Developer Review (AI)
- **Review Date**: 2026-03-27
- **Outcome**: PASS (with fixes applied)
- **Reviewers**: 3-layer adversarial review (Security/Correctness, Performance/UX, Architecture/Maintainability)
- **Total Findings**: 12 (7 patches, 5 defers)
- **Action Items**:
  - [x] P1 (High): Fix `appendBotMessageText` stale read-then-write race — added atomic `appendMessageContent`
  - [x] P2 (High): Fix `setVoiceLoading` not syncing `loadingRef` — sync in both directions
  - [x] P3 (High): Add validation to `restoreMessages` — type guard + corrupt entry skip + Date validation
  - [x] P4 (Medium): Fix blob URL leak on eviction/removal — added `revokeBlobUrl` helper
  - [x] P5 (Medium): Fix storage key orphaning on sessionId change — `lastPersistedKey` tracker
  - [x] P6 (Medium): Cancel debounce timer in `clearMessages` — prevent stale re-persist
  - [x] P7 (Low): Remove dead `NON_SERIALIZABLE_FIELDS` export
  - [x] D1 (Medium): Add singleton guard for multi-instance safety — `widgetMounted` flag with warning
  - [x] D2 (Medium): Strengthen `generateMessageId` — `crypto.getRandomValues` + monotonic counter
  - [x] D3 (Medium): Guard late stream callbacks — `streamAbortedRef` on all callbacks
  - [x] D4 (Low): Mark restored audio messages as `[Audio unavailable]`
  - [x] D5 (Low): Verify stream abort on widget close — already covered (no change needed)

## Change Log
- 2026-03-27: Implemented centralized Preact signals store, Message types, sessionStorage persistence, and wired all widget components to store
- 2026-03-27: Fixed 12 code review findings (P1-P7, D1-D5) — race conditions, memory leaks, validation, singleton safety, collision resistance
