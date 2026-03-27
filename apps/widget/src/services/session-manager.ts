/**
 * Widget session management (Story 5-17).
 *
 * Manages chat session IDs scoped per-tab using sessionStorage.
 * Session creation happens server-side — this module only stores/retrieves
 * the session ID returned by the backend after the first message.
 *
 * Storage: sessionStorage (tab-scoped, cleared on tab close).
 * Fallback: in-memory only when sessionStorage is unavailable.
 */

// ── Internal state ──────────────────────────────────────────────────

let currentSessionId: string | null = null;
let sessionActive = false;

// ── Storage key ─────────────────────────────────────────────────────

function storageKey(agentId: string): string {
  return `cw_session_${agentId}`;
}

// ── sessionStorage helpers (Task 2) ─────────────────────────────────

function readSessionStorage(agentId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(agentId));
  } catch {
    return null;
  }
}

function writeSessionStorage(agentId: string, sessionId: string): boolean {
  try {
    sessionStorage.setItem(storageKey(agentId), sessionId);
    return true;
  } catch {
    return false;
  }
}

function removeSessionStorage(agentId: string): void {
  try {
    sessionStorage.removeItem(storageKey(agentId));
  } catch {
    // Ignore — storage may be unavailable (private browsing, iframe restrictions)
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialise session state for the given agent (Task 1, 3).
 *
 * Checks sessionStorage for an existing session ID. If found, restores it
 * into module state. If not found, leaves sessionId as null — session
 * creation will happen server-side on the first message send.
 */
export function initSession(agentId: string): void {
  const stored = readSessionStorage(agentId);
  if (stored) {
    currentSessionId = stored;
    sessionActive = true;
  } else {
    currentSessionId = null;
    sessionActive = false;
  }
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
 * Update the session ID after receiving it from an API response (Task 4).
 *
 * Called after sendMessage/streamMessage returns a session ID from the backend.
 * Persists to sessionStorage and updates module state.
 */
export function updateSession(agentId: string, newSessionId: string): void {
  currentSessionId = newSessionId;
  sessionActive = true;
  writeSessionStorage(agentId, newSessionId);
}

/**
 * Handle session-related API errors (Task 5).
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
 * Clear session state and storage for the given agent.
 */
function clearSession(agentId: string): void {
  currentSessionId = null;
  sessionActive = false;
  removeSessionStorage(agentId);
}

/**
 * Manually reset the current session (Task 6).
 *
 * Clears sessionStorage entry and resets module state. Useful for
 * "new conversation" functionality.
 */
export function resetSession(agentId: string): void {
  clearSession(agentId);
}

/**
 * Full cleanup called from widget destroy() lifecycle (Task 6).
 *
 * Clears storage and resets all module state to initial values.
 */
export function destroySession(agentId: string): void {
  clearSession(agentId);
}
