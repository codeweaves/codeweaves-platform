/**
 * Human-handover realtime socket (Socket.io).
 *
 * Connects ONLY to OUR backend gateway, scoped by the unguessable `sessionId`
 * (the same bearer model as the /poll endpoint) — never a DB/Supabase
 * credential. Opened only while a conversation is escalated, to:
 *   - receive the agent's "typing…" signal → show it to the visitor
 *   - receive content-free `message`/`handover` pings → trigger an immediate
 *     refetch (the poll loop stays as a slower reconcile fallback)
 *   - send the visitor's "typing…" signal (throttled) so the agent sees it
 *
 * Realtime is a latency optimisation, never the source of truth: if the socket
 * can't connect (locked-down network) the poll fallback still delivers replies,
 * just less instantly. socket.io negotiates websocket→long-poll transparently,
 * which already covers most "WebSocket blocked" cases.
 */
import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-client';

let socket: Socket | null = null;
let lastVisitorTypingAt = 0;

/** Don't spam the wire — one "visitor typing" ping per this window at most. */
const VISITOR_TYPING_THROTTLE_MS = 1500;

export interface HandoverSocketHandlers {
  /** Agent started/continued typing → show "agent is typing" (caller auto-clears). */
  onAgentTyping: () => void;
  /** A `message`/`handover` ping landed → refetch now (poke the poller). */
  onPing: () => void;
}

/** Open the handover socket for this session. No-op if already open. */
export function connectHandoverSocket(sessionId: string, handlers: HandoverSocketHandlers): void {
  if (socket) return;
  const base = getApiBaseUrl();
  if (!base) return;
  socket = io(base, {
    // sessionId IS the bearer token — the gateway joins us to session:<id>.
    auth: { sessionId },
    // WS first, long-poll fallback for networks that block raw WebSockets.
    transports: ['websocket', 'polling'],
    withCredentials: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  socket.on('typing', (p: { from?: string } | undefined) => {
    if (p?.from === 'agent') handlers.onAgentTyping();
  });
  socket.on('message', () => handlers.onPing());
  socket.on('handover', () => handlers.onPing());
}

/** Tell the agent the visitor is typing (throttled). Silent if disconnected. */
export function emitVisitorTyping(): void {
  if (!socket?.connected) return;
  const now = Date.now();
  if (now - lastVisitorTypingAt < VISITOR_TYPING_THROTTLE_MS) return;
  lastVisitorTypingAt = now;
  socket.emit('typing', { from: 'visitor' });
}

export function isHandoverSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/** Tear down (handover resolved / widget destroyed). */
export function disconnectHandoverSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  lastVisitorTypingAt = 0;
}
