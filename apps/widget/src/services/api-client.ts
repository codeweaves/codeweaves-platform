/**
 * Widget API client service (Story 5-15, Tasks 1–3).
 *
 * Centralised HTTP layer for all widget ↔ backend communication.
 * Uses native fetch only (no external HTTP libraries — bundle size constraint).
 *
 * Exports a singleton-style module (functions, not a class) for tree-shaking.
 */

import type { SendMessageResponse } from '../types';
import { WidgetApiError, mapResponseError } from './api-errors';
import { fetchWithRetry } from './fetch-utils';

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
  if (deviceId) headers['X-Device-Id'] = deviceId;
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

// ── sendMessage (Task 2) ────────────────────────────────────────────

/**
 * Send a chat message (non-streaming) to the backend.
 *
 * POST {baseUrl}/api/public/chat/send
 */
export async function sendMessage(
  agentId: string,
  message: string,
  sessionId?: string,
  deviceId?: string,
): Promise<SendMessageResponse> {
  ensureInit();

  const url = `${baseUrl}/api/public/chat/send`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(deviceId, sessionId),
    body: JSON.stringify({ chatInput: message, agentId, sessionId }),
  });

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
    return body as SendMessageResponse;
  }

  throw await mapResponseError(response);
}

// ── streamMessage (Task 3) ──────────────────────────────────────────

/**
 * Send a chat message and receive a streaming SSE response.
 *
 * POST {baseUrl}/api/public/chat/stream
 *
 * Returns the raw ReadableStreamDefaultReader for the caller to consume
 * with `parseSSEStream()` from `utils/sse-parser.ts`.
 */
export async function streamMessage(
  agentId: string,
  message: string,
  sessionId?: string,
  deviceId?: string,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  ensureInit();

  const url = `${baseUrl}/api/public/chat/stream`;
  const headers = buildHeaders(deviceId, sessionId);
  headers['Accept'] = 'text/event-stream';

  // Disable retry for streaming — POST is non-idempotent and server may
  // have already saved the message / triggered the AI pipeline.
  const response = await fetchWithRetry(
    url,
    { method: 'POST', headers, body: JSON.stringify({ chatInput: message, agentId, sessionId }) },
    undefined,
    false,
  );

  if (response.status === 200 && response.body) {
    return response.body.getReader();
  }

  throw await mapResponseError(response);
}
