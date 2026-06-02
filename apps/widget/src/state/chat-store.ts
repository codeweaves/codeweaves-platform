/**
 * Centralized chat store using Preact signals (Story 5-21).
 *
 * All widget state lives here. Components import signals directly —
 * no prop drilling required. Signal reads auto-subscribe the component.
 */

import { signal, computed } from '@preact/signals';
import type { Message } from '../types/message';

// ── Constants ────────────────────────────────────────────────────────

const MAX_MESSAGES = 50;
const GREETING_ID = '__greeting__';

// Pre-existing sessionStorage entries written by earlier widget builds used
// keys like `cw_messages_<agentId>_<sessionId|none>`. We no longer persist
// across reloads — the prefix is kept solely so the init-time cleanup can
// wipe any stale entries left over from older clients.
const LEGACY_STORAGE_PREFIX = 'cw_messages_';

// ── Core signals ─────────────────────────────────────────────────────

/** All chat messages */
export const messages = signal<Message[]>([]);

/** Widget view state */
export const widgetState = signal<'closed' | 'expanded' | 'minimized'>('closed');

/** Waiting for first response token */
export const isLoading = signal(false);

/** Active SSE stream in progress */
export const isStreaming = signal(false);

/** Global error message (null = no error) */
export const error = signal<string | null>(null);

/** Current chat session ID */
export const sessionId = signal<string | null>(null);

/** ID of the message currently being streamed */
export const streamingMessageId = signal<string | null>(null);

/** Rate-limited flag */
export const isRateLimited = signal(false);

// ── Computed signals ─────────────────────────────────────────────────

/** Whether there are any messages */
export const hasMessages = computed(() => messages.value.length > 0);

/** Last message in the array */
export const lastMessage = computed<Message | undefined>(
  () => messages.value[messages.value.length - 1],
);

/** Whether any user messages exist (for starters visibility) */
export const hasUserMessages = computed(
  () => messages.value.some((m) => m.role === 'user'),
);

/** Whether to show conversation starters */
const starterCount = signal(0);
export const showStarters = computed(
  () => !hasUserMessages.value && starterCount.value > 0,
);

/** Whether the user can send a message */
export const canSend = computed(
  () => !isLoading.value && !isStreaming.value && !isRateLimited.value,
);

/** Whether to show the typing indicator */
export const showTyping = computed(
  () =>
    isLoading.value &&
    !isStreaming.value &&
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1]?.role === 'user',
);

/** Set the number of conversation starters (called once from config) */
export function setStarterCount(count: number): void {
  starterCount.value = count;
}

// ── Message operations ───────────────────────────────────────────────

/** Revoke a blob URL from a message if present */
function revokeBlobUrl(msg: Message): void {
  if (msg.audioUrl && msg.audioUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(msg.audioUrl); } catch { /* already revoked */ }
  }
}

/**
 * Append a message. Enforces max 50 messages — drops oldest first,
 * but never drops the greeting message. Revokes blob URLs on evicted messages.
 */
export function addMessage(message: Message): void {
  let next = [...messages.value, message];

  // Enforce cap: drop oldest non-greeting messages
  while (next.length > MAX_MESSAGES) {
    const dropIndex = next.findIndex((m) => m.id !== GREETING_ID);
    if (dropIndex === -1) break;
    revokeBlobUrl(next[dropIndex]!);
    next = [...next.slice(0, dropIndex), ...next.slice(dropIndex + 1)];
  }

  messages.value = next;
}

/** Update fields on an existing message (e.g. streaming content, status change) */
export function updateMessage(id: string, updates: Partial<Message>): void {
  messages.value = messages.value.map((m) =>
    m.id === id ? { ...m, ...updates } : m,
  );
}

/** Atomically append text to a message's content (avoids stale read-then-write race) */
export function appendMessageContent(id: string, text: string): void {
  messages.value = messages.value.map((m) =>
    m.id === id
      ? { ...m, content: m.content ? `${m.content} ${text}` : text }
      : m,
  );
}

/** Remove a message by ID (e.g. failed message cleanup). Revokes blob URL if present. */
export function removeMessage(id: string): void {
  const msg = messages.value.find((m) => m.id === id);
  if (msg) revokeBlobUrl(msg);
  messages.value = messages.value.filter((m) => m.id !== id);
}

/** Clear all messages. Revokes any audio object URLs to free memory. */
export function clearMessages(): void {
  for (const msg of messages.value) {
    revokeBlobUrl(msg);
  }
  messages.value = [];
}

// ── Legacy storage cleanup ───────────────────────────────────────────
//
// Earlier widget builds persisted the last 10 messages to `sessionStorage`
// keyed by `cw_messages_<agent>_<sessionId|none>` so the chat survived a
// reload within the same tab. That contradicts the product rule we settled on
// ("a reload starts a new session"): an orphaned `_none` bucket would surface
// stale messages after the user reloaded.
//
// Persistence is now removed entirely (matches `session-manager.ts`'s
// in-memory-only model). This function nukes any leftover entries written by
// older deployed clients so users on stale state don't see ghost messages.

/** Wipes every legacy `cw_messages_*` entry for this agent from sessionStorage. */
export function clearLegacyPersistedMessages(agentId: string): void {
  const prefix = `${LEGACY_STORAGE_PREFIX}${agentId}_`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    // sessionStorage may be unavailable (iframe sandbox, private mode) — fine,
    // there's nothing to clean up in that case.
  }
}

// ── Utility ──────────────────────────────────────────────────────────

/** Generate a unique message ID with strong randomness */
let idCounter = 0;
export function generateMessageId(prefix: string): string {
  idCounter += 1;
  const random = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36)).join('').slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${idCounter}-${random}`;
}

/** Reset all store state (for widget destroy) */
export function resetStore(): void {
  clearMessages();
  widgetState.value = 'closed';
  isLoading.value = false;
  isStreaming.value = false;
  error.value = null;
  sessionId.value = null;
  streamingMessageId.value = null;
  isRateLimited.value = false;
  starterCount.value = 0;
  idCounter = 0;
}
