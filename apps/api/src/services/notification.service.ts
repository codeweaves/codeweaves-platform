import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationSeverity, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { NotificationMailerService } from './notification-mailer.service';
import type { EmailTemplateKey } from './email-template.registry';
import { AppLogger } from '../common/logger/app-logger';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { isOrgScoped } from '../utils/tenant-filter';

/** Hard cap on a bell page — keeps an unbounded `limit` from becoming a scan. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export interface EmitNotificationInput {
  organizationId: string;
  agentId?: string | null;
  type: NotificationType;
  severity?: NotificationSeverity;
  /** Server-composed. MUST NOT contain visitor message text — it goes over the
   *  socket and into a toast, and the gateway is content-free by design. */
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  email?: {
    enabled: boolean;
    recipients: string[];
    templateKey: EmailTemplateKey;
    /**
     * Template variables MINUS `conversationUrl` — that one is filled in by
     * {@link NotificationService.emit} itself, because it links by the
     * notification id and only emit knows it. See the note there on why the
     * link must not carry a session id.
     */
    vars: Record<string, string>;
  };
}

/**
 * The single entry point producers use to raise a dashboard notification.
 *
 * One call fans out to three places — the bell (durable row), the live socket
 * (toast/sound/browser popup), and email (if the producer asked for it). A
 * producer never talks to a channel directly, so adding a channel later touches
 * only this class.
 *
 * FIRE-AND-FORGET CONTRACT: `emit` never throws. Callers on a hot path (the
 * chat request that raised a handover) must not fail because a notification
 * could not be written or delivered.
 */
@Injectable()
export class NotificationService {
  private readonly log = new AppLogger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mailer: NotificationMailerService,
    private readonly config: ConfigService,
  ) {}

  async emit(input: EmitNotificationInput): Promise<void> {
    let notificationId: string | null = null;

    // 1. Durable row — the bell. Failing here still lets the live push happen,
    //    but there is nothing to link to, so the socket emit is skipped below.
    try {
      const row = await this.prisma.notification.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId ?? null,
          type: input.type,
          severity: input.severity ?? 'INFO',
          title: input.title.slice(0, 300),
          body: input.body?.slice(0, 1000) ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
        select: { id: true, createdAt: true },
      });
      notificationId = row.id;

      // 2. Live push — org room only. RealtimeService already swallows its own
      //    errors, but keep it inside the try so an unexpected throw can't skip
      //    the email below.
      await this.realtime.emitNotification(input.organizationId, {
        id: row.id,
        type: input.type,
        severity: input.severity ?? 'INFO',
        title: input.title,
        entityType: input.entityType ?? undefined,
        entityId: input.entityId ?? undefined,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (err) {
      this.log.warn('emit', 'notification write/push failed (ignored)', {
        organizationId: input.organizationId,
        type: input.type,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Email — independent of the row above on purpose. If the DB write blew
    //    up but the customer asked to be emailed about a waiting visitor, the
    //    email is the part that actually matters.
    //
    //    The mailer already swallows its own failures, but this call is wrapped
    //    anyway: `emit` promises never to throw, and that promise must hold even
    //    if the mailer is ever changed (or mocked) to propagate.
    if (input.email?.enabled) {
      try {
        await this.mailer.send({
          organizationId: input.organizationId,
          templateKey: input.email.templateKey,
          vars: {
            ...input.email.vars,
            conversationUrl: this.deepLink(notificationId),
          },
          recipients: input.email.recipients,
          tagType: input.type,
        });
      } catch (err) {
        this.log.warn('emit', 'notification email failed (ignored)', {
          organizationId: input.organizationId,
          type: input.type,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (notificationId) {
      this.log.info('emit', 'notification raised', {
        organizationId: input.organizationId,
        type: input.type,
        notificationId,
      });
    }
  }

  /**
   * The link we put in an outbound email.
   *
   * SECURITY: this deliberately links by NOTIFICATION id, never by
   * `publicSessionId`. A publicSessionId is a bearer credential — it alone
   * authenticates the unauthenticated `GET /public/chat/:sessionId/poll`
   * endpoint (and the widget's socket handshake), so anyone holding it can read
   * the whole visitor transcript with no login. Email is a lower-trust channel
   * that we do not control once sent: it lands in shared inboxes, aliases,
   * ticket archives and third-party mail providers, and `handoverEmailRecipients`
   * lets a customer point it at an address that has no dashboard access at all.
   *
   * A notification id grants nothing on its own — every `/notifications` route
   * requires a verified Clerk token and is scoped to the caller's organization,
   * so the dashboard resolves it to a conversation behind auth.
   *
   * Falls back to the plain Inbox when there is no row to link to (the DB write
   * failed), which is still useful: the team lands on the waiting conversation.
   */
  private deepLink(notificationId: string | null): string {
    const base = this.config.get<string>('DASHBOARD_URL', 'http://localhost:3000');
    return notificationId
      ? `${base}/dashboard/inbox?n=${encodeURIComponent(notificationId)}`
      : `${base}/dashboard/inbox`;
  }

  // ---------------------------------------------------------------------------
  // Read side (bell UI)
  // ---------------------------------------------------------------------------

  /**
   * The tenant filter for every read route, derived ONLY from the authenticated
   * user — never from a request parameter.
   *
   * Two shapes, mirroring `HandoverService.agentScope` so the bell and the Inbox
   * can never disagree about what someone is allowed to see:
   *
   *   - CLIENT (and any role that has an org)  → `{ organizationId }`
   *     Scoped to their own org. A CLIENT with no org gets `null` (see below),
   *     never the unscoped branch.
   *   - ADMIN/SUPER_ADMIN with NO org (platform staff) → `{}`
   *     Every org, because that is already exactly what they see in the Inbox.
   *
   * Returns null when the caller has no legitimate scope at all, and callers
   * must treat that as "empty", not as "everything".
   */
  private scopeFor(user: CurrentUserData): Prisma.NotificationWhereInput | null {
    if (user.organizationId) return { organizationId: user.organizationId };
    // Platform scope only. An ORG account without an org is a misconfigured
    // account, not a superuser — it must NOT fall through to the unscoped branch.
    //
    // Reads accessScope, not the deprecated `role`: an account demoted to ORG via
    // `PATCH /users/:id/scope` keeps its old `role`, and returning `{}` for it
    // would show that person EVERY organization's notifications.
    if (!isOrgScoped(user)) return {};
    return null;
  }

  /**
   * One notification by id, org-scoped. Backs the `?n=<id>` email deep link:
   * the Inbox resolves the id to its conversation behind auth, so the email
   * never has to carry a session bearer.
   */
  async get(
    user: CurrentUserData,
    notificationId: string,
  ): Promise<{
    id: string;
    type: NotificationType;
    entityType: string | null;
    entityId: string | null;
  }> {
    const scope = this.scopeFor(user);
    if (!scope) throw new NotFoundException('Notification not found');

    const row = await this.prisma.notification.findFirst({
      where: { ...scope, id: notificationId },
      select: { id: true, type: true, entityType: true, entityId: true },
    });
    if (!row) throw new NotFoundException('Notification not found');
    return row;
  }

  /**
   * A page of notifications the caller is entitled to — their own org, or every
   * org for platform staff. See {@link scopeFor}.
   */
  async list(
    user: CurrentUserData,
    opts: { limit?: number; cursor?: string },
  ): Promise<{
    items: Array<{
      id: string;
      type: NotificationType;
      severity: NotificationSeverity;
      title: string;
      body: string | null;
      entityType: string | null;
      entityId: string | null;
      createdAt: Date;
      read: boolean;
    }>;
    nextCursor: string | null;
  }> {
    const where = this.scopeFor(user);
    if (!where) return { items: [], nextCursor: null };

    const take = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1, // one extra to detect "has more" without a second count
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        body: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        // Per-item read state for THIS user only.
        reads: { where: { userId: user.id }, select: { userId: true }, take: 1 },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      items: page.map(({ reads, ...n }) => ({ ...n, read: reads.length > 0 })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Badge number: notifications in scope newer than my `notificationsSeenAt`
   * cursor. Deliberately not a join against notification_reads, because this is
   * hit on every page load — org-scoped callers ride the
   * (organizationId, createdAt) index, platform staff ride (createdAt).
   */
  async unreadCount(user: CurrentUserData): Promise<{ count: number }> {
    const scope = this.scopeFor(user);
    if (!scope) return { count: 0 };

    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationsSeenAt: true },
    });

    const count = await this.prisma.notification.count({
      where: {
        ...scope,
        ...(me?.notificationsSeenAt ? { createdAt: { gt: me.notificationsSeenAt } } : {}),
      },
    });
    return { count };
  }

  /** Opening the bell panel clears the badge. */
  async markSeen(user: CurrentUserData): Promise<{ seenAt: Date }> {
    const seenAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { notificationsSeenAt: seenAt },
    });
    return { seenAt };
  }

  /**
   * Mark one item read for this user.
   *
   * The existence check is scoped: without it, an org user could mark (and so
   * confirm the existence of) another organization's notification id.
   */
  async markRead(user: CurrentUserData, notificationId: string): Promise<{ ok: boolean }> {
    const scope = this.scopeFor(user);
    if (!scope) return { ok: false };

    const exists = await this.prisma.notification.findFirst({
      where: { ...scope, id: notificationId },
      select: { id: true },
    });
    if (!exists) return { ok: false };

    await this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId: user.id } },
      create: { notificationId, userId: user.id },
      update: {},
    });
    return { ok: true };
  }
}
