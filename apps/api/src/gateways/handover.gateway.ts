import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { HandoverState } from '@prisma/client';
import type { Server, Socket } from 'socket.io';

/** Room helpers — one per conversation, one per org. */
const sessionRoom = (id: string) => `session:${id}`;
const orgRoom = (id: string) => `org:${id}`;
/** Shared room for platform admins (no org of their own) — they watch every
 *  org's handovers, so events fan out here too. Content-free pings only. */
const PLATFORM_ROOM = 'platform';

/** Pull a single non-empty string from a handshake auth/query value. */
function pickStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim();
  return undefined;
}

/**
 * The single realtime backbone for live handover (Chatwoot-style): the widget
 * and the dashboard both connect here. The server pushes handover/message events
 * into rooms; clients relay ephemeral "typing" signals to each other. This
 * REPLACES the Supabase-Realtime layer.
 *
 * Rooms:
 *   session:<publicSessionId>  — the widget + the dashboard's open thread
 *   org:<organizationId>       — the dashboard inbox list (flags / new requests)
 *
 * Access: the widget scopes by the unguessable `sessionId` (same bearer model as
 * the public /poll endpoint). Dashboard org-room membership is validated against
 * the agent's Clerk identity when the dashboard client is wired (Phase 3).
 */
@WebSocketGateway({
  // Widget connects cross-origin (customer sites); access is gated by the
  // unguessable sessionId token, not the origin. Tokens ride in the socket
  // auth payload, not cookies, so credentials stay off.
  cors: { origin: true, credentials: false },
})
export class HandoverGateway implements OnGatewayConnection {
  private readonly logger = new Logger(HandoverGateway.name);

  @WebSocketServer() server!: Server;

  handleConnection(client: Socket): void {
    const h = client.handshake;
    const sessionId = pickStr(h.auth?.sessionId) ?? pickStr(h.query?.sessionId);
    const orgId = pickStr(h.auth?.orgId) ?? pickStr(h.query?.orgId);
    // Platform admins have no org — they see every org's inbox, so they join a
    // shared broadcast room instead of a single org room.
    const platform = h.auth?.platform === true || h.query?.platform === 'true';

    if (sessionId) {
      client.data.sessionId = sessionId;
      void client.join(sessionRoom(sessionId));
    }
    if (orgId) {
      client.data.orgId = orgId;
      void client.join(orgRoom(orgId));
    }
    if (platform) {
      client.data.platform = true;
      void client.join(PLATFORM_ROOM);
    }
    // Nothing to scope to → not a valid client.
    if (!sessionId && !orgId && !platform) client.disconnect(true);
  }

  /**
   * Ephemeral typing signal — relayed to the OTHER party in the session room
   * (never persisted, never echoed to the sender). Throttled client-side.
   *
   * The widget is scoped to its own session (`client.data.sessionId`). The
   * dashboard drives many threads over one socket, so it names the target
   * session explicitly in the payload.
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { from?: 'visitor' | 'agent'; sessionId?: string } | undefined,
  ): void {
    const own = client.data.sessionId as string | undefined;
    // Dashboard clients (org/platform-scoped) drive many threads, so they name
    // the target session. A widget is session-scoped and may ONLY signal into
    // its OWN session — it cannot spoof a typing signal into another chat.
    const isDashboard = !!(client.data.orgId || client.data.platform);
    const target = isDashboard ? pickStr(body?.sessionId) ?? own : own;
    if (!target) return;
    const from = body?.from === 'agent' ? 'agent' : 'visitor';
    client.to(sessionRoom(target)).emit('typing', { from, sessionId: target });
  }

  /**
   * Dashboard-only: join/leave a specific session room while a teammate has
   * that thread open, so they receive the visitor's ephemeral typing signal.
   * (message/handover pings already reach the dashboard via the org room — this
   * is only for per-thread typing.)
   *
   * Gated to org-scoped clients so the widget can't watch other sessions.
   * sessionIds are unguessable UUIDs — best-effort scoping, matching the class
   * doc until org↔session validation lands.
   */
  @SubscribeMessage('watch')
  handleWatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string } | undefined,
  ): void {
    if (!client.data.orgId && !client.data.platform) return;
    const sessionId = pickStr(body?.sessionId);
    if (sessionId) void client.join(sessionRoom(sessionId));
  }

  @SubscribeMessage('unwatch')
  handleUnwatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string } | undefined,
  ): void {
    const sessionId = pickStr(body?.sessionId);
    if (sessionId) void client.leave(sessionRoom(sessionId));
  }

  // ── Server-side pushes (used by RealtimeService in place of Supabase) ──────

  /** A handover state change → ping the session (widget/thread), org (inbox),
   *  and the platform room (admins watching all orgs). */
  emitHandover(sessionId: string, orgId: string, handoverState: HandoverState): void {
    const payload = { sessionId, handoverState };
    this.server.to(sessionRoom(sessionId)).emit('handover', payload);
    this.server.to(orgRoom(orgId)).emit('handover', payload);
    this.server.to(PLATFORM_ROOM).emit('handover', payload);
  }

  /** A new message landed → ping the session + org + platform so they refetch. */
  emitMessage(sessionId: string, orgId: string): void {
    const payload = { sessionId };
    this.server.to(sessionRoom(sessionId)).emit('message', payload);
    this.server.to(orgRoom(orgId)).emit('message', payload);
    this.server.to(PLATFORM_ROOM).emit('message', payload);
  }
}
