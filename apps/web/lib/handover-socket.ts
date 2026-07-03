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
 * Realtime is a latency optimisation, never correctness — the Inbox/thread
 * hooks keep a React Query poll fallback. Module-singleton (like the widget's)
 * so any component can watch/emit without prop-drilling a socket instance.
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

/** Ensure a single shared socket for this scope. Idempotent per scope. */
export function ensureHandoverSocket(auth: HandoverAuth): Socket {
  const key = auth.platform ? 'platform' : auth.orgId ?? '';
  if (socket && connectedKey === key) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  connectedKey = key;
  socket = io(API_BASE_URL, {
    auth,
    transports: ['websocket', 'polling'],
    withCredentials: false,
    reconnection: true,
    reconnectionDelayMax: 8000,
  });
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
}
