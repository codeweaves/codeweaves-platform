import { Injectable } from '@nestjs/common';
import type { HandoverState } from '@prisma/client';
import { HandoverGateway } from '../gateways/handover.gateway';
import { AppLogger } from '../common/logger/app-logger';

/**
 * Thin wrapper over the self-hosted Socket.io {@link HandoverGateway} for the
 * live-handover layer. Replaced the old Supabase-Realtime broadcaster — every
 * realtime event now flows through OUR gateway:
 *
 *   - secure: the widget authenticates with the unguessable session token, never
 *     a DB/Supabase credential (RLS is off, so an anon key = full DB access).
 *   - cheap: single instance fans out in-memory (zero Redis); Redis is opt-in
 *     (SOCKET_IO_REDIS) only when running multiple instances.
 *
 * The service keeps the same `emitHandover(ctx, state)` / `emitMessage(ctx)`
 * surface the callers already use, so nothing upstream changed.
 *
 * PING-ONLY: emits carry NO chat content — only "session X changed" (+ the
 * non-sensitive handoverState flag so the widget can switch UI mode without a
 * round-trip). Clients re-fetch the actual data from the authenticated API.
 *
 * Fail-open by design: realtime is a delivery optimisation, never a source of
 * truth. Every emit is best-effort and swallowed on error — the DB write is
 * already durable and clients reconcile via a light refetch (widget poll
 * fallback / dashboard React Query poll).
 */
@Injectable()
export class RealtimeService {
  private readonly log = new AppLogger(RealtimeService.name);

  constructor(private readonly gateway: HandoverGateway) {}

  /**
   * A handover state change (requested / taken-over / resolved). Pings the org
   * Inbox (refresh the list + flag) and the session room (so the widget can
   * react, e.g. show "you're now chatting with a human").
   */
  async emitHandover(
    ctx: { organizationId: string; publicSessionId: string },
    handoverState: HandoverState,
  ): Promise<void> {
    try {
      this.gateway.emitHandover(ctx.publicSessionId, ctx.organizationId, handoverState);
    } catch (err) {
      // best-effort — realtime never breaks the hot path
      this.log.warn('emitHandover', 'handover emit failed (ignored)', {
        organizationId: ctx.organizationId,
        handoverState,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * A new message landed in a handover conversation. Pure ping — no content.
   * The Inbox + the open thread (and the widget) re-fetch on receipt.
   */
  async emitMessage(ctx: { organizationId: string; publicSessionId: string }): Promise<void> {
    try {
      this.gateway.emitMessage(ctx.publicSessionId, ctx.organizationId);
    } catch (err) {
      // best-effort
      this.log.warn('emitMessage', 'message emit failed (ignored)', {
        organizationId: ctx.organizationId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * A dashboard notification for one organization — drives the bell badge, the
   * toast, the sound and the browser popup. Org room only (see
   * {@link HandoverGateway.emitNotification}).
   *
   * Same fail-open contract as the other emitters: the notification row is
   * already durable and the bell reconciles on its next fetch, so a socket
   * problem must never surface to the caller.
   */
  async emitNotification(
    organizationId: string,
    payload: {
      id: string;
      type: string;
      severity: string;
      title: string;
      entityType?: string;
      entityId?: string;
      createdAt: string;
    },
  ): Promise<void> {
    try {
      this.gateway.emitNotification(organizationId, payload);
    } catch (err) {
      this.log.warn('emitNotification', 'notification emit failed (ignored)', {
        organizationId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
