import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { HandoverState } from '@prisma/client';
import type { Server, Socket } from 'socket.io';

import { WsAuthService } from '../common/ws/ws-auth.service';

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
 * Access (enforced in a handshake middleware — see {@link afterInit}):
 *   - Widget → presents an unguessable `sessionId` (same bearer model as the
 *     public /poll endpoint); joins ONLY its own `session:<id>`. No login.
 *   - Dashboard → presents a verified Clerk token; the org/platform room is
 *     derived from the DB user, so a client can never self-assign into another
 *     org's room. Client-supplied `orgId`/`platform` handshake flags are ignored.
 *   - Anything else is rejected before it can join a room.
 */
@WebSocketGateway({
  // Widget connects cross-origin (customer sites); access is gated by the
  // unguessable sessionId token, not the origin. Tokens ride in the socket
  // auth payload, not cookies, so credentials stay off.
  cors: { origin: true, credentials: false },
})
export class HandoverGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(HandoverGateway.name);

  @WebSocketServer() server!: Server;

  constructor(private readonly wsAuth: WsAuthService) {}

  /**
   * Authenticate EVERY socket during the handshake, before it connects. The
   * middleware resolves the trusted scope (org/platform from a verified Clerk
   * token, or a widget's session bearer) and stashes it on `socket.data`;
   * a handshake that resolves to no scope is rejected here and never reaches
   * {@link handleConnection}. This is the single tenant-isolation chokepoint
   * for the realtime layer — client-supplied `orgId`/`platform` are ignored.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.wsAuth
        .resolveScope(socket.handshake)
        .then((scope) => {
          if (!scope) {
            next(new Error('unauthorized'));
            return;
          }
          socket.data.sessionId = scope.sessionId;
          socket.data.orgId = scope.orgId;
          socket.data.platform = scope.platform ?? false;
          next();
        })
        .catch((err) =>
          next(err instanceof Error ? err : new Error('unauthorized')),
        );
    });
  }

  handleConnection(client: Socket): void {
    // socket.data was populated by the trusted handshake middleware (afterInit).
    // We only ever join rooms the client is actually entitled to.
    const sessionId = client.data.sessionId as string | undefined;
    const orgId = client.data.orgId as string | undefined;
    const platform = client.data.platform as boolean | undefined;

    if (sessionId) void client.join(sessionRoom(sessionId));
    if (orgId) void client.join(orgRoom(orgId));
    if (platform) void client.join(PLATFORM_ROOM);

    // No trusted scope resolved → not a valid client (defensive; the middleware
    // already rejects these).
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

  /**
   * A dashboard notification (bell + toast + sound + browser popup).
   *
   * Org room + platform room, matching {@link emitHandover} and the Inbox
   * itself: platform staff (ADMIN/SUPER_ADMIN with no org of their own) already
   * see EVERY organization's handovers in the Inbox, so notifying only the org
   * left them able to see a waiting conversation but never be told about it.
   *
   * The volume concern for platform staff is real but belongs in their own
   * hands, not here: sound and browser popups are per-device toggles they
   * control, and the bell is a list they choose to open.
   *
   * `title` is composed server-side from a fixed format string and never
   * carries visitor message text, so this stays inside the gateway's
   * content-free contract while still giving the toast something to render.
   */
  emitNotification(
    orgId: string,
    payload: {
      id: string;
      type: string;
      severity: string;
      title: string;
      entityType?: string;
      entityId?: string;
      createdAt: string;
    },
  ): void {
    this.server.to(orgRoom(orgId)).emit('notification', payload);
    this.server.to(PLATFORM_ROOM).emit('notification', payload);
  }
}
