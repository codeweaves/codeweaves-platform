/**
 * Widget session management.
 *
 * Stores the current chat session ID in module-local memory only. NO
 * `sessionStorage` or `localStorage` — a session ends the moment the page
 * is reloaded or the tab is closed, by design:
 *   • aligns with the product rule "every visit is a new conversation"
 *   • web sessions therefore have at most one tab's worth of lifetime
 *   • a hard 6h cap on the SERVER side (see chat.service.ts SESSION_LIFETIME_MS)
 *     catches the long-running-tab case where the visitor keeps chatting
 *
 * Session creation happens server-side — this module just holds the id
 * the backend returned on the first message, so subsequent messages can
 * include it in the request body.
 */

// ── Internal state ──────────────────────────────────────────────────

let currentSessionId: string | null = null;
let sessionActive = false;

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialise session state for the given agent.
 *
 * Resets the in-memory state — we deliberately don't restore from any
 * persistent store, so each page-load / tab-open starts fresh.
 */
export function initSession(agentId: string): void {
  void agentId; // reserved for future per-agent state; signature kept stable for callers
  currentSessionId = null;
  sessionActive = false;
}

/**
 * Returns the current session ID, or null if no session exists yet.
 * Used by the API client to include session ID in request bodies.
 */
export function getSessionId(): string | null {
  return currentSessionId;
}

/**
 * Returns whether a session is currently active.
 */
export function isSessionActive(): boolean {
  return sessionActive;
}

/**
 * Update the session ID after receiving it from an API response.
 *
 * Called after sendMessage/streamMessage returns a session ID from the backend.
 * Held only in memory; lost on reload / tab close by design.
 */
export function updateSession(agentId: string, newSessionId: string): void {
  void agentId; // reserved for future per-agent state; signature kept stable for callers
  currentSessionId = newSessionId;
  sessionActive = true;
}

/**
 * Handle session-related API errors.
 *
 * On 404 or 410 (expired/invalid session), clears the stale session.
 * The next message send will omit sessionId, triggering server-side
 * session creation transparently.
 */
export function handleSessionError(agentId: string, statusCode: number): void {
  if (statusCode === 404 || statusCode === 410) {
    clearSession(agentId);
  }
}

/**
 * Clear in-memory session state for the given agent.
 */
function clearSession(agentId: string): void {
  void agentId; // reserved for future per-agent state
  currentSessionId = null;
  sessionActive = false;
}

/**
 * Manually reset the current session.
 *
 * Used for an explicit "new conversation" affordance (if the UI exposes one).
 */
export function resetSession(agentId: string): void {
  clearSession(agentId);
}

/**
 * Full cleanup called from widget destroy() lifecycle.
 */
export function destroySession(agentId: string): void {
  clearSession(agentId);
}
