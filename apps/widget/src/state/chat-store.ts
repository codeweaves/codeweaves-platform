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
const PERSIST_COUNT = 10;
const DEBOUNCE_MS = 300;

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
  schedulePersist();
}

/** Update fields on an existing message (e.g. streaming content, status change) */
export function updateMessage(id: string, updates: Partial<Message>): void {
  messages.value = messages.value.map((m) =>
    m.id === id ? { ...m, ...updates } : m,
  );
  schedulePersist();
}

/** Atomically append text to a message's content (avoids stale read-then-write race) */
export function appendMessageContent(id: string, text: string): void {
  messages.value = messages.value.map((m) =>
    m.id === id
      ? { ...m, content: m.content ? `${m.content} ${text}` : text }
      : m,
  );
  schedulePersist();
}

/** Remove a message by ID (e.g. failed message cleanup). Revokes blob URL if present. */
export function removeMessage(id: string): void {
  const msg = messages.value.find((m) => m.id === id);
  if (msg) revokeBlobUrl(msg);
  messages.value = messages.value.filter((m) => m.id !== id);
  schedulePersist();
}

/** Clear all messages. Revokes any audio object URLs to free memory. */
export function clearMessages(): void {
  // Cancel any pending debounced persist
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const msg of messages.value) {
    revokeBlobUrl(msg);
  }
  messages.value = [];
  clearPersistedMessages();
}

// ── SessionStorage persistence ───────────────────────────────────────

let persistAgentId = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Track last persisted key to clean up orphaned entries when sessionId changes */
let lastPersistedKey: string | null = null;

/** Initialise persistence scope (called once on widget init) */
export function initPersistence(agentId: string): void {
  persistAgentId = agentId;
}

function storageKey(): string {
  return `cw_messages_${persistAgentId}_${sessionId.value ?? 'none'}`;
}

function schedulePersist(): void {
  if (!persistAgentId) return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(persistMessages, DEBOUNCE_MS);
}

function persistMessages(): void {
  debounceTimer = null;
  if (!persistAgentId) return;

  const currentKey = storageKey();

  // Clean up orphaned key if sessionId changed (e.g. "none" → actual session ID)
  if (lastPersistedKey && lastPersistedKey !== currentKey) {
    try { sessionStorage.removeItem(lastPersistedKey); } catch { /* ignore */ }
  }

  const last10 = messages.value.slice(-PERSIST_COUNT);

  // Serialize: convert Date to ISO string, omit audioBlob
  const serializable = last10.map((m) => ({
    id: m.id,
    role: m.role,
    type: m.type,
    content: m.content,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    status: m.status,
    isStreaming: false, // never persist streaming state
    audioUrl: m.audioUrl?.startsWith('blob:') ? undefined : m.audioUrl,
    audioDuration: m.audioDuration,
    errorMessage: m.errorMessage,
    // audioBlob intentionally omitted — not serializable
  }));

  try {
    sessionStorage.setItem(currentKey, JSON.stringify(serializable));
    lastPersistedKey = currentKey;
  } catch {
    // Storage may be full, disabled, or unavailable in iframes
  }
}

/** Validate a parsed message entry has the minimum required fields */
function isValidMessageEntry(m: unknown): m is Record<string, unknown> {
  if (typeof m !== 'object' || m === null) return false;
  const rec = m as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    (rec.role === 'user' || rec.role === 'assistant') &&
    typeof rec.content === 'string' &&
    rec.timestamp != null
  );
}

/** Restore messages from sessionStorage on widget init. Returns true if messages were restored. */
export function restoreMessages(agentId: string, currentSessionId: string | null): boolean {
  const key = `cw_messages_${agentId}_${currentSessionId ?? 'none'}`;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed) || parsed.length === 0) return false;

    const restored: Message[] = [];
    for (const m of parsed) {
      if (!isValidMessageEntry(m)) continue; // skip corrupt entries

      const ts = new Date(m.timestamp as string);
      if (isNaN(ts.getTime())) continue; // skip invalid timestamps

      const isAudio = m.type === 'audio';
      restored.push({
        id: m.id as string,
        role: m.role as Message['role'],
        type: (m.type as Message['type']) ?? 'text',
        // Audio messages without blob show "Audio unavailable"
        content: isAudio && !m.audioUrl ? '[Audio unavailable]' : (m.content as string),
        timestamp: ts,
        status: (m.status as Message['status']) ?? 'sent',
        isStreaming: false,
        audioUrl: m.audioUrl as string | undefined,
        audioDuration: m.audioDuration as number | undefined,
        // audioBlob not available after restore
        errorMessage: m.errorMessage as string | undefined,
      });
    }

    if (restored.length === 0) return false;
    messages.value = restored;
    return true;
  } catch {
    return false;
  }
}

function clearPersistedMessages(): void {
  if (!persistAgentId) return;
  try {
    sessionStorage.removeItem(storageKey());
  } catch {
    // ignore
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
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
  clearMessages();
  widgetState.value = 'closed';
  isLoading.value = false;
  isStreaming.value = false;
  error.value = null;
  sessionId.value = null;
  streamingMessageId.value = null;
  isRateLimited.value = false;
  starterCount.value = 0;
  persistAgentId = '';
  lastPersistedKey = null;
  idCounter = 0;
}
