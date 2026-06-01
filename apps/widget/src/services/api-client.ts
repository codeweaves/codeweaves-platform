/**
 * Widget API client service (Story 5-15, Tasks 1–3).
 *
 * Centralised HTTP layer for all widget ↔ backend communication.
 * Uses native fetch only (no external HTTP libraries — bundle size constraint).
 *
 * Exports a singleton-style module (functions, not a class) for tree-shaking.
 */

import type { SendMessageResponse } from '../types';
import { getDeviceId } from '../utils/device-id';
import { WidgetApiError, mapResponseError } from './api-errors';
import { fetchWithRetry } from './fetch-utils';
import { getSessionId, updateSession, handleSessionError } from './session-manager';

// ── Internal state ──────────────────────────────────────────────────

let baseUrl = '';

/**
 * Initialise the API client with the backend base URL.
 * Must be called before any API method. Typically called once during widget init
 * with the `apiBaseUrl` from the script tag (already parsed in config-loader).
 */
export function initApiClient(apiBaseUrl: string): void {
  baseUrl = apiBaseUrl.replace(/\/+$/, '');
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildHeaders(deviceId?: string, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Auto-resolve device ID if not explicitly provided (Story 5-16)
  headers['X-Device-Id'] = deviceId ?? getDeviceId();
  if (sessionId) headers['X-Session-Id'] = sessionId;
  return headers;
}

function ensureInit(): void {
  if (!baseUrl) {
    throw new WidgetApiError({
      status: 0,
      userMessage: 'Widget API client not initialised',
      retryable: false,
    });
  }
}

/**
 * Fire-and-forget warmup hint to the backend. Pre-populates OpenAI's prompt
 * cache for this agent so the user's first real message lands on a warm cache
 * (~700-900ms LLM TTFT instead of ~1500-2500ms cold). Combined with the
 * server's `prompt_cache_retention: '24h'`, this benefits every user that
 * opens the widget — even the day's first visitor.
 *
 * Returns immediately. The fetch is sent without awaiting the response — if
 * the backend takes 700ms to fire its LLM call in the background, we don't
 * care, the widget UI shouldn't block. Errors are swallowed.
 */
export function warmupAgent(agentId: string): void {
  if (!baseUrl) return;
  // Use fetch directly (no retry, no error mapping) — this is a hint, not a
  // contract. If it fails, the user just pays the cold-start tax on their
  // first message — same as before this function existed.
  void fetch(`${baseUrl}/api/klivo/v1/public/chat/warmup`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ agentId }),
    keepalive: true, // tolerate page unload races
  }).catch(() => { /* swallow */ });
}

// ── sendMessage (Task 2) ────────────────────────────────────────────

/**
 * Send a chat message (non-streaming) to the backend.
 *
 * POST {baseUrl}/api/klivo/v1/public/chat/send
 */
export async function sendMessage(
  agentId: string,
  message: string,
  sessionId?: string,
  deviceId?: string,
): Promise<SendMessageResponse> {
  ensureInit();

  // Auto-resolve session ID from session manager if not explicitly provided (Story 5-17)
  const resolvedSessionId = sessionId ?? getSessionId() ?? undefined;

  const url = `${baseUrl}/api/klivo/v1/public/chat/send`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(deviceId, resolvedSessionId),
    body: JSON.stringify({ chatInput: message, agentId, sessionId: resolvedSessionId, source: 'WIDGET' }),
  });

  // Session expired — clear stale session and throw (Story 5-17, AC 3)
  if (response.status === 404 || response.status === 410) {
    handleSessionError(agentId, response.status);
    throw await mapResponseError(response);
  }

  // Rate limit — backend returns 200 with { error: true }
  if (response.status === 200) {
    const body = await response.json();
    if (body.error === true) {
      throw new WidgetApiError({
        status: 429,
        userMessage: body.message ?? 'Too many requests. Please wait a moment.',
        retryable: true,
        retryAfterSeconds: body.retryAfterSeconds,
      });
    }
    // Update session with the returned session ID (Story 5-17, Task 7)
    const result = body as SendMessageResponse;
    if (result.sessionId) {
      updateSession(agentId, result.sessionId);
    }
    return result;
  }

  throw await mapResponseError(response);
}

// ── streamMessage (Task 3) ──────────────────────────────────────────

/**
 * Send a chat message and receive a streaming SSE response.
 *
 * POST {baseUrl}/api/klivo/v1/public/chat/stream
 *
 * Returns the raw ReadableStreamDefaultReader for the caller to consume
 * with `parseSSEStream()` from `utils/sse-parser.ts`.
 *
 * NOTE: Session ID update is NOT handled here — the session ID arrives via
 * SSE events in the stream body. The caller (Story 5-19) must call
 * `updateSession()` from `session-manager` when it parses the session ID
 * from the SSE stream.
 */
export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export async function streamMessage(
  agentId: string,
  message: string,
  sessionId?: string,
  deviceId?: string,
  signal?: AbortSignal,
  recentHistory?: ChatHistoryItem[],
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  ensureInit();

  // Auto-resolve session ID from session manager if not explicitly provided (Story 5-17)
  const resolvedSessionId = sessionId ?? getSessionId() ?? undefined;

  const url = `${baseUrl}/api/klivo/v1/public/chat/stream`;
  const headers = buildHeaders(deviceId, resolvedSessionId);
  headers['Accept'] = 'text/event-stream';

  // Send client-held history so the backend can skip its DB lookup for prior
  // messages — saves ~150-450ms per turn. Send the array even when empty
  // (turn 1) so the server takes the in-memory branch (~3ms) instead of the
  // DB findMany branch (~170ms) in context-assembly.
  const body: Record<string, unknown> = {
    chatInput: message,
    agentId,
    sessionId: resolvedSessionId,
    source: 'WIDGET',
    recentHistory: recentHistory ?? [],
  };

  // Use longer timeout for streaming connections (90s) — the initial connection
  // must complete within this window; actual stream reads are unbounded.
  // Disable retry — POST is non-idempotent and server may have already
  // saved the message / triggered the AI pipeline.
  const response = await fetchWithRetry(
    url,
    { method: 'POST', headers, body: JSON.stringify(body), signal },
    90_000,
    false,
  );

  // Session expired — clear stale session and throw (Story 5-17, AC 3)
  if (response.status === 404 || response.status === 410) {
    handleSessionError(agentId, response.status);
    throw await mapResponseError(response);
  }

  if (response.ok && response.body) {
    return response.body.getReader();
  }

  throw await mapResponseError(response);
}
