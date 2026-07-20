'use client';

import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/config/api';

/**
 * Shared dashboard connection to the self-hosted Socket.io handover gateway
 * (replaces the Supabase-Realtime browser client). Scoped to the logged-in user:
 *
 *   - CLIENT → joins `org:<orgId>` → every message/handover ping for their org
 *   - SUPER_ADMIN/ADMIN (no org) → joins the shared `platform` room → all orgs
 *   - `watch(sessionId)` joins a session room while a thread is open → that
 *     visitor's ephemeral "typing…" signal
 *   - `emitAgentTyping(sessionId)` relays the teammate's typing to the visitor
 *
 * Realtime is a latency optimisation, never correctness — while the socket is
 * connected the Inbox/thread queries stop their 30s poll and rely on pushes
 * (with a catch-up refetch on reconnect); if the socket drops, the poll resumes
 * as the real fallback. Module-singleton (like the widget's) so any component
 * can watch/emit without prop-drilling a socket instance.
 */
export type HandoverAuth = { orgId?: string; platform?: boolean };

/**
 * Socket scope for the logged-in user: their org (CLIENT) or the platform room
 * (SUPER_ADMIN/ADMIN, who have no org but watch every org's Inbox). null when
 * the profile can't be scoped yet — the caller then skips the socket (poll only).
 */
export function profileHandoverAuth(
  profile: { role?: string; organization?: { id?: string | null } | null } | null | undefined,
): HandoverAuth | null {
  if (!profile) return null;
  if (profile.organization?.id) return { orgId: profile.organization.id };
  if (profile.role === 'SUPER_ADMIN' || profile.role === 'ADMIN') return { platform: true };
  return null;
}

let socket: Socket | null = null;
let connectedKey: string | null = null;
let lastAgentTypingAt = 0;

const AGENT_TYPING_THROTTLE_MS = 1500;

// ── Connection-state store ────────────────────────────────────────────────
// Lets React gate the reconcile poll on socket health: when the socket is
// connected, the handover queries stop their 30s poll (the socket pushes
// updates instead); when it drops, the poll resumes as the real fallback.
// Exposed via useSyncExternalStore (see useHandoverSocketConnected).
let socketConnected = false;
const connectedListeners = new Set<() => void>();

function setSocketConnected(value: boolean): void {
  if (socketConnected === value) return;
  socketConnected = value;
  connectedListeners.forEach((l) => l());
}

export function subscribeHandoverConnected(listener: () => void): () => void {
  connectedListeners.add(listener);
  return () => connectedListeners.delete(listener);
}

export function getHandoverConnected(): boolean {
  return socketConnected;
}

/**
 * Ensure a single shared socket for this scope. Idempotent per scope.
 *
 * `getToken` returns a fresh Clerk `klivo-api` token — the gateway verifies it
 * and derives the org/platform room from the DB user (the `scope` we pass is
 * only a client-side hint for the singleton key; the server ignores it). We
 * pass `auth` as a FUNCTION so socket.io re-fetches a live token on every
 * (re)connect — Clerk tokens are short-lived, so a captured token would fail
 * the handshake after a reconnect.
 */
export function ensureHandoverSocket(
  scope: HandoverAuth,
  getToken: () => Promise<string | null>,
): Socket {
  const key = scope.platform ? 'platform' : scope.orgId ?? '';
  if (socket && connectedKey === key) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  setSocketConnected(false);
  connectedKey = key;
  socket = io(API_BASE_URL, {
    auth: (cb) => {
      void getToken()
        .then((token) => cb({ token: token ?? undefined }))
        .catch(() => cb({}));
    },
    transports: ['websocket', 'polling'],
    withCredentials: false,
    reconnection: true,
    reconnectionDelayMax: 8000,
  });
  // Drive the connection-state store so the queries can pause/resume polling.
  socket.on('connect', () => setSocketConnected(true));
  socket.on('disconnect', () => setSocketConnected(false));
  return socket;
}

export function getHandoverSocket(): Socket | null {
  return socket;
}

/** Start receiving a session's ephemeral signals (visitor typing). */
export function watchSession(sessionId: string): void {
  socket?.emit('watch', { sessionId });
}

/** Stop receiving that session's signals. */
export function unwatchSession(sessionId: string): void {
  socket?.emit('unwatch', { sessionId });
}

/** Tell the visitor the teammate is typing (throttled). No-op if disconnected. */
export function emitAgentTyping(sessionId: string): void {
  if (!socket?.connected) return;
  const now = Date.now();
  if (now - lastAgentTypingAt < AGENT_TYPING_THROTTLE_MS) return;
  lastAgentTypingAt = now;
  socket.emit('typing', { from: 'agent', sessionId });
}

/** Tear down (sign-out / org switch). */
export function teardownHandoverSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  connectedKey = null;
  lastAgentTypingAt = 0;
  setSocketConnected(false);
}
