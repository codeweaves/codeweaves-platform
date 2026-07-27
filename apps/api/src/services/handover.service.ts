import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, type HandoverReason, type HandoverState } from '@prisma/client';
import { tool, jsonSchema } from 'ai';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { NotificationService } from './notification.service';
import { PiiDetectionService } from '../modules/pii/pii-detection.service';
import { WhatsappOutboundService } from '../modules/whatsapp/whatsapp-outbound.service';
import { AppLogger } from '../common/logger/app-logger';
import { InternalEventLogger } from '../common/events/internal.logger';
import { TracerService } from '../common/tracer/tracer.service';
import type { CurrentUserData } from '../decorators/current-user.decorator';

/**
 * Matches an explicit "I want a human" intent. Cheap + synchronous — runs on
 * the chat hot-path with zero LLM cost, so it never adds reply latency.
 * Extend cautiously: false positives escalate chats that didn't need it.
 */
const HUMAN_REQUEST_RE =
  /\b(?:(?:talk|speak|chat|connect)\s+(?:me\s+|us\s+)?(?:to|with)\s+(?:a\s+|an\s+|the\s+)?(?:human|person|agent|someone|somebody|representative|rep|operator|advisor|team\s*member|manager))\b|\b(?:human|live|real|actual)\s+(?:agent|person|support|representative|rep|operator)\b|\b(?:real|actual)\s+person\b|\bcustomer\s+(?:service|support)\s+(?:agent|rep|representative|person)\b/i;

/** Consecutive bot "couldn't answer" replies that auto-raise the flag. */
const FALLBACK_STREAK = 2;

/**
 * A handover (REQUESTED or ACTIVE_HUMAN) with no message from anyone for this
 * long is considered abandoned and auto-resolved back to the bot. `lastMessageAt`
 * updates on every message, so an actively-handled chat is never swept.
 */
const HANDOVER_IDLE_MINUTES = 20;

/** Context needed to mutate handover state + emit realtime for one session. */
interface HandoverCtx {
  sessionDbId: string;
  publicSessionId: string;
  organizationId: string;
}

@Injectable()
export class HandoverService {
  private readonly log = new AppLogger(HandoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    private readonly whatsappOutbound: WhatsappOutboundService,
    private readonly piiDetection: PiiDetectionService,
    private readonly events: InternalEventLogger,
    private readonly tracer: TracerService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Idle window (minutes) before an untouched handover is auto-resolved.
   * Defaults to HANDOVER_IDLE_MINUTES; override per-deploy via the
   * `HANDOVER_IDLE_MINUTES` env var without a code change.
   */
  private resolveIdleMinutes(): number {
    const raw = this.config.get<string>('HANDOVER_IDLE_MINUTES');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : HANDOVER_IDLE_MINUTES;
  }

  // ---------------------------------------------------------------------------
  // Triggers (chat hot-path)
  // ---------------------------------------------------------------------------

  /** Synchronous keyword check — safe to call inline before the LLM stream. */
  detectKeyword(text: string): boolean {
    return HUMAN_REQUEST_RE.test(text);
  }

  /**
   * The per-turn system-prompt hint that makes the bot stall politely while a
   * teammate is being connected (handoverState = REQUESTED). The bot keeps
   * helping; it just acknowledges a human is on the way.
   */
  stallInstruction(humanConnectedLabel?: string | null): string {
    const who = humanConnectedLabel?.trim() || 'a member of our team';
    return (
      `The user has asked to speak with a human, and ${who} is being connected right now. ` +
      'Warmly acknowledge that a human will join shortly, and keep helping with anything ' +
      'you can in the meantime. Never claim to be human or to be the person they asked for. ' +
      'Keep your reply brief.'
    );
  }

  /**
   * System-prompt rule that lets the bot ESCALATE on its own judgement (added
   * for turns where takeover is on and the chat is still bot-handled). The bot
   * reads frustration / an explicit ask in-band — no extra LLM call — and calls
   * the `connect_to_human` tool when (and only when) the visitor clearly wants
   * a human. This is the nuanced counterpart to the cheap inline keyword check.
   */
  offerInstruction(): string {
    return (
      'There is currently NO human connected to this chat. A teammate can take over, but the ' +
      'ONLY thing that actually connects one is calling the `connect_to_human` tool — saying it ' +
      'in text does nothing. So NEVER tell the visitor that a human is coming, connecting, being ' +
      'notified, or will reach out UNLESS you call `connect_to_human` in that same reply.\n' +
      'Call `connect_to_human` when the visitor clearly asks for a human/person/agent/someone, ' +
      'when they agree to be connected, or when they are frustrated/upset or you cannot resolve ' +
      'their issue after genuinely trying — do not wait to be asked. This applies EVEN IF a human ' +
      'already helped earlier in this conversation and then left: if the visitor is upset or asks ' +
      'again, treat it as a brand-new escalation and call the tool again. Do not assume a past ' +
      'handover still covers them, and do not just repeat an earlier "a teammate will join" line.\n' +
      'Do not call it speculatively or twice in a row for the same request. After calling it, ' +
      'briefly let them know a teammate will join shortly and keep helping meanwhile. Never claim ' +
      'to be a human yourself.\n' +
      'In the history, turns beginning with "[Human teammate]:" were written by a human agent who ' +
      'helped earlier — NOT by you — and turns beginning with "[System]:" are automated status ' +
      'notes about the handover (e.g. a teammate took over, or the chat was resolved and handed ' +
      'back to you). Use both only as context; never write a "[Human teammate]:" or "[System]:" ' +
      'prefix in your own replies.'
    );
  }

  /**
   * The `connect_to_human` tool handed to the model on bot-handled turns. The
   * AI SDK runs `execute` server-side the instant the model decides to call it
   * (i.e. the visitor consented), which flips the session NONE → REQUESTED.
   * `onEscalate` lets the caller (the SSE controller) learn it fired so it can
   * tell the widget to start polling for the human's replies.
   */
  buildConnectTool(
    ctx: HandoverCtx,
    onEscalate: (reason: HandoverReason) => void,
  ) {
    return tool({
      description:
        'Connect the visitor to a human teammate. Call this ONLY when the visitor has ' +
        'agreed to be connected, or has explicitly asked to talk to a human. Do not call ' +
        'it speculatively or to end the conversation.',
      inputSchema: jsonSchema<{ reason: 'explicit_request' | 'frustration' }>({
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          reason: {
            type: 'string',
            enum: ['explicit_request', 'frustration'],
            description:
              'Why a human is being brought in: the visitor explicitly asked, or they are frustrated/stuck.',
          },
        },
      }),
      execute: async ({ reason }) => {
        const mapped: HandoverReason =
          reason === 'frustration' ? 'FRUSTRATION' : 'USER_REQUESTED';
        this.log.info(
          'buildConnectTool',
          'connect_to_human fired — escalating to a human',
          { reason: mapped, sessionId: ctx.publicSessionId },
        );
        await this.raiseRequested(ctx, mapped);
        onEscalate(mapped);
        return {
          status: 'connecting',
          message: 'A teammate is being connected and will join shortly.',
        };
      },
    });
  }

  /**
   * Raise the flag (NONE → REQUESTED). Idempotent + race-safe via a guarded
   * updateMany: only the first caller flips it and writes the system line.
   * Best-effort realtime; never throws into the chat path.
   */
  async raiseRequested(ctx: HandoverCtx, reason: HandoverReason): Promise<void> {
    try {
      const res = await this.prisma.chatSession.updateMany({
        where: { id: ctx.sessionDbId, handoverState: 'NONE' },
        data: {
          handoverState: 'REQUESTED',
          handoverReason: reason,
          handoverRequestedAt: new Date(),
          // Re-escalation after a prior resolve: clear last cycle's stamps so
          // each handover is self-contained (no stale "taken over by" / a
          // resolvedAt that predates this requestedAt skewing handle-time).
          handoverStartedAt: null,
          handoverResolvedAt: null,
          takenOverById: null,
        },
      });
      if (res.count === 0) return; // already requested or being handled

      // Semantic event: the session actually flipped NONE → REQUESTED. Fire-and-forget.
      this.events.logCompleted('HANDOVER_REQUESTED', {
        sessionId: ctx.publicSessionId,
        organizationId: ctx.organizationId,
        metadata: { reason },
      });

      const text =
        reason === 'BOT_FALLBACK'
          ? "Bot couldn't answer — escalated to a human"
          : reason === 'FRUSTRATION'
            ? 'Frustration detected — escalated to a human'
            : 'Visitor asked for a human';
      await this.insertSystemMessage(ctx.sessionDbId, text);

      await this.realtime.emitHandover(ctx, 'REQUESTED');
      await this.realtime.emitMessage(ctx);

      // Dashboard notification (bell + toast + sound + browser popup, and email
      // if the agent has it on). Deliberately NOT awaited: this runs on the chat
      // hot path, and telling the team must never add latency to the visitor's
      // reply. notifyHandoverRequested swallows everything it can throw.
      void this.notifyHandoverRequested(ctx);
    } catch (err) {
      this.log.warn('raiseRequested', 'flip failed (fail-open)', {
        sessionId: ctx.sessionDbId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Raise the "a visitor wants a human" notification.
   *
   * Fetches the agent/org names it needs itself rather than widening
   * {@link HandoverCtx}, because it runs off the hot path (fire-and-forget) and
   * every other caller of that ctx would otherwise have to carry fields it does
   * not use.
   */
  private async notifyHandoverRequested(ctx: HandoverCtx): Promise<void> {
    try {
      const session = await this.prisma.chatSession.findUnique({
        where: { id: ctx.sessionDbId },
        select: {
          agent: {
            select: {
              id: true,
              name: true,
              handoverEmailEnabled: true,
              handoverEmailRecipients: true,
              organization: { select: { name: true } },
            },
          },
        },
      });
      const agent = session?.agent;
      if (!agent) return;

      await this.notifications.emit({
        organizationId: ctx.organizationId,
        agentId: agent.id,
        type: 'HANDOVER_REQUESTED',
        severity: 'URGENT',
        // Agent name only — never the visitor's message. This string goes over
        // the socket and into a browser popup.
        title: `A visitor asked for a human on ${agent.name}`,
        // publicSessionId is fine HERE: the notification row and the socket
        // payload are only ever read by an authenticated member of this org.
        // It must NOT go into the email — see NotificationService.deepLink,
        // which builds the email link from the notification id instead.
        entityType: 'conversation',
        entityId: ctx.publicSessionId,
        email: {
          enabled: agent.handoverEmailEnabled,
          recipients: agent.handoverEmailRecipients,
          templateKey: 'HANDOVER_REQUESTED',
          // `conversationUrl` is deliberately absent — NotificationService fills
          // it, because only it knows the notification id the link points at.
          vars: {
            orgName: agent.organization?.name ?? 'your organization',
            agentName: agent.name,
          },
        },
      });
    } catch (err) {
      this.log.warn('notifyHandoverRequested', 'notification failed (ignored)', {
        sessionId: ctx.sessionDbId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Auto-escalate when the bot has now failed FALLBACK_STREAK turns in a row.
   * `currentCouldntAnswer` is the just-completed turn (not yet relied on from
   * the DB, since persistence is fire-and-forget); we only query the PRIOR
   * persisted turns to complete the streak.
   */
  async maybeRaiseFromFallback(ctx: HandoverCtx, currentCouldntAnswer: boolean): Promise<void> {
    if (!currentCouldntAnswer) return;
    try {
      const priorNeeded = FALLBACK_STREAK - 1;
      if (priorNeeded > 0) {
        const recent = await this.prisma.chatMessage.findMany({
          where: { chatSessionId: ctx.sessionDbId, role: 'ASSISTANT' },
          orderBy: { createdAt: 'desc' },
          take: priorNeeded,
          select: { metrics: { select: { couldntAnswer: true } } },
        });
        const priorStreak =
          recent.length >= priorNeeded &&
          recent.every((m) => m.metrics?.couldntAnswer === true);
        if (!priorStreak) return;
      }
      await this.raiseRequested(ctx, 'BOT_FALLBACK');
    } catch (err) {
      this.log.warn('maybeRaiseFromFallback', 'failed (fail-open)', {
        sessionId: ctx.sessionDbId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Ping the live layer that a bot turn landed while in REQUESTED. */
  async publishBotTurn(ctx: HandoverCtx): Promise<void> {
    await this.realtime.emitMessage(ctx);
  }

  /** Persist + publish a visitor message that arrived while the AI is paused. */
  async onVisitorMessageWhilePaused(
    ctx: HandoverCtx,
    content: string,
  ): Promise<void> {
    try {
      const msg = await this.prisma.chatMessage.create({
        data: {
          chatSessionId: ctx.sessionDbId,
          role: 'USER',
          // Compliance floor: identity/card numbers are destroyed before
          // persistence on every channel, including while a human handles.
          content: this.piiDetection.maskHardDrop(content),
        },
      });
      await this.prisma.chatSession.update({
        where: { id: ctx.sessionDbId },
        data: { lastMessageAt: msg.createdAt },
      });
      await this.realtime.emitMessage(ctx);
    } catch (err) {
      this.log.warn('onVisitorMessageWhilePaused', 'failed (fail-open)', {
        sessionId: ctx.sessionDbId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard (authenticated) — Inbox + actions
  // ---------------------------------------------------------------------------

  async listInbox(
    query: { filter: 'needs' | 'handling' | 'all'; agentId?: string; orgId?: string },
    user: CurrentUserData,
  ) {
    this.assertClientHasOrg(user);
    const states: HandoverState[] =
      query.filter === 'handling'
        ? ['ACTIVE_HUMAN']
        : query.filter === 'all'
          ? ['REQUESTED', 'ACTIVE_HUMAN']
          : ['REQUESTED'];

    const sessions = await this.prisma.chatSession.findMany({
      where: {
        handoverState: { in: states },
        agent: this.agentScope(user, query),
      },
      // Enum sorts in declared order (NONE, REQUESTED, ACTIVE_HUMAN) → REQUESTED
      // first; oldest-waiting first within each so nothing starves.
      orderBy: [{ handoverState: 'asc' }, { handoverRequestedAt: 'asc' }],
      take: 100,
      include: {
        agent: { select: { id: true, name: true } },
        takenOverBy: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, content: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      agent: s.agent,
      source: s.source,
      visitorId: s.visitorId,
      handoverState: s.handoverState,
      handoverReason: s.handoverReason,
      handoverRequestedAt: s.handoverRequestedAt,
      takenOverBy: s.takenOverBy,
      lastMessageAt: s.lastMessageAt,
      messageCount: s._count.messages,
      lastMessage: s.messages[0] ?? null,
    }));
  }

  /**
   * Does ANY in-scope bot have human takeover enabled? Powers the dashboard
   * "Inbox" nav visibility — CLIENT checks their org's bots; ADMIN/SUPER_ADMIN
   * check every bot they can see (any one enabled → show the Inbox).
   */
  async handoverEnabled(user: CurrentUserData): Promise<{ enabled: boolean }> {
    this.assertClientHasOrg(user);
    const count = await this.prisma.agent.count({
      where: {
        deletedAt: null,
        humanTakeoverEnabled: true,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
    });
    return { enabled: count > 0 };
  }

  async getThread(publicSessionId: string, user: CurrentUserData) {
    const session = await this.loadScopedSession(publicSessionId, user);
    const messages = await this.prisma.chatMessage.findMany({
      where: { chatSessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true, metadata: true },
    });
    return {
      sessionId: session.sessionId,
      agent: session.agent,
      source: session.source,
      visitorId: session.visitorId,
      handoverState: session.handoverState,
      handoverReason: session.handoverReason,
      handoverRequestedAt: session.handoverRequestedAt,
      handoverStartedAt: session.handoverStartedAt,
      handoverResolvedAt: session.handoverResolvedAt,
      takenOverBy: session.takenOverBy,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        author: this.authorName(m.metadata),
      })),
    };
  }

  async takeover(publicSessionId: string, user: CurrentUserData) {
    const session = await this.loadScopedSession(publicSessionId, user);
    const name = await this.resolveUserName(user.id);

    // Guarded so two teammates clicking "Take over" at once can't both win: only
    // the update that flips it away from ACTIVE_HUMAN claims it. A second click
    // no-ops and just returns the current thread (showing who already has it).
    const claimed = await this.prisma.chatSession.updateMany({
      where: { id: session.id, handoverState: { not: 'ACTIVE_HUMAN' } },
      data: {
        handoverState: 'ACTIVE_HUMAN',
        takenOverById: user.id,
        handoverStartedAt: new Date(),
        handoverRequestedAt: session.handoverRequestedAt ?? new Date(),
        // A teammate grabbing a live bot chat directly = a manual escalation.
        handoverReason: session.handoverReason ?? 'MANUAL',
      },
    });
    if (claimed.count === 0) return this.getThread(publicSessionId, user);

    // Semantic event: a teammate claimed the chat (→ ACTIVE_HUMAN). Fire-and-forget.
    this.events.logCompleted('HANDOVER_TAKEN_OVER', {
      agentId: session.agent.id,
      sessionId: session.sessionId,
      organizationId: session.agent.organizationId,
      metadata: { takenOverById: user.id },
    });
    // Accountability trail (distinct from the event_log above): who seized a
    // live customer conversation, when.
    await this.tracer.logAuditEvent(
      session.sessionId,
      'HANDOVER_TAKEN_OVER',
      { response: { takenOverById: user.id, sessionId: session.sessionId } },
      { organizationId: session.agent.organizationId, agentId: session.agent.id },
    );

    const ctx = this.ctxOf(session);
    await this.insertSystemMessage(session.id, `${name} took over — AI paused`);
    await this.realtime.emitHandover(ctx, 'ACTIVE_HUMAN');
    await this.realtime.emitMessage(ctx);
    return this.getThread(publicSessionId, user);
  }

  async postMessage(publicSessionId: string, user: CurrentUserData, content: string) {
    const session = await this.loadScopedSession(publicSessionId, user);
    if (session.handoverState !== 'ACTIVE_HUMAN') {
      throw new ConflictException('Take over the conversation before replying');
    }
    const name = await this.resolveUserName(user.id);
    // Same compliance floor as visitor messages: a human agent pasting a
    // card/Aadhaar number must not persist it either. WhatsApp outbound below
    // deliberately sends the original `content` — the visitor may need the
    // real value; only OUR storage is restricted.
    const storedContent = this.piiDetection.maskHardDrop(content);
    const msg = await this.prisma.chatMessage.create({
      data: {
        chatSessionId: session.id,
        role: 'HUMAN_AGENT',
        content: storedContent,
        metadata: { humanAgent: { id: user.id, name } },
      },
    });
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { lastMessageAt: msg.createdAt },
    });
    await this.realtime.emitMessage(this.ctxOf(session));

    // Accountability: a staff member sent a message to a customer as the brand.
    // Content is masked in storage; the audit row records who/when only (no body).
    await this.tracer.logAuditEvent(
      session.sessionId,
      'HANDOVER_HUMAN_REPLY_SENT',
      { response: { userId: user.id, messageId: msg.id, sessionId: session.sessionId } },
      { organizationId: session.agent.organizationId, agentId: session.agent.id },
    );

    // WhatsApp visitors aren't watching a widget — push the human's reply OUT
    // to their phone via the bot's own Graph sender. Fire-and-forget + swallowed
    // inside the service, so an outbound failure never breaks this reply. (Widget
    // + voice visitors receive via the widget poll, so they need nothing here.)
    if (session.source === 'WHATSAPP' && session.visitorId) {
      void this.whatsappOutbound.deliverHumanReply(session.agent.id, session.visitorId, content);
    }

    return { id: msg.id, role: msg.role, content: msg.content, createdAt: msg.createdAt, author: name };
  }

  async resolve(publicSessionId: string, user: CurrentUserData) {
    const session = await this.loadScopedSession(publicSessionId, user);
    const name = await this.resolveUserName(user.id);

    if (session.handoverState !== 'NONE') {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { handoverState: 'NONE', handoverResolvedAt: new Date() },
      });

      // Semantic event: teammate resolved the chat (→ NONE, AI resumed). Fire-and-forget.
      this.events.logCompleted('HANDOVER_RESOLVED', {
        agentId: session.agent.id,
        sessionId: session.sessionId,
        organizationId: session.agent.organizationId,
        metadata: { resolvedBy: user.id },
      });
      // Accountability trail: who ended the human session / resumed the AI.
      await this.tracer.logAuditEvent(
        session.sessionId,
        'HANDOVER_RESOLVED',
        { response: { resolvedBy: user.id, sessionId: session.sessionId } },
        { organizationId: session.agent.organizationId, agentId: session.agent.id },
      );

      const ctx = this.ctxOf(session);
      await this.insertSystemMessage(session.id, `Resolved by ${name} — AI resumed`);
      await this.realtime.emitHandover(ctx, 'NONE');
      await this.realtime.emitMessage(ctx);
    }
    return this.getThread(publicSessionId, user);
  }

  /**
   * Auto-resolve abandoned handovers (no activity for HANDOVER_IDLE_MINUTES).
   * Runs from an internal cron (Supabase pg_cron → /internal/handover/sweep),
   * the same pattern as the classifier. Non-destructive: just hands control
   * back to the AI so the session resumes its normal lifecycle (and can expire
   * again — the expiry guard only blocks while handoverState != NONE).
   */
  async sweepIdleHandovers(idleMinutes?: number): Promise<{ resolved: number }> {
    const minutes = idleMinutes ?? this.resolveIdleMinutes();
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const stale = await this.prisma.chatSession.findMany({
      where: {
        handoverState: { in: ['REQUESTED', 'ACTIVE_HUMAN'] },
        // Idle = quiet for `idleMinutes`. Sessions with no messages yet (e.g. a
        // cold "talk to a human" button click) have a null lastMessageAt, so
        // fall back to createdAt — otherwise they'd stay stuck in REQUESTED
        // forever, never swept.
        OR: [
          { lastMessageAt: { lte: cutoff } },
          { lastMessageAt: null, createdAt: { lte: cutoff } },
        ],
      },
      select: {
        id: true,
        sessionId: true,
        agent: { select: { organizationId: true } },
      },
      take: 200,
    });

    let resolved = 0;
    for (const s of stale) {
      try {
        await this.prisma.chatSession.update({
          where: { id: s.id },
          data: { handoverState: 'NONE', handoverResolvedAt: new Date() },
        });
        await this.insertSystemMessage(s.id, 'Auto-resolved (inactive) — AI resumed');
        const ctx = {
          sessionDbId: s.id,
          publicSessionId: s.sessionId,
          organizationId: s.agent.organizationId,
        };
        await this.realtime.emitHandover(ctx, 'NONE');
        await this.realtime.emitMessage(ctx);
        resolved++;
      } catch (err) {
        this.log.warn('sweepIdleHandovers', 'per-session resolve failed (fail-open)', {
          sessionId: s.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (resolved > 0) {
      this.log.info('sweepIdleHandovers', 'auto-resolved idle session(s)', { resolved });
    }
    // INTERNAL observability: record each sweep run (cron liveness + how many
    // stale sessions it auto-resolved). Fire-and-forget.
    this.events.logCompleted('HANDOVER_SWEEP_COMPLETED', {
      metadata: { scanned: stale.length, resolved },
    });
    return { resolved };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertClientHasOrg(user: CurrentUserData): void {
    if (user.role === Role.CLIENT && !user.organizationId) {
      throw new ForbiddenException('Client user must be associated with an organization');
    }
  }

  private agentScope(
    user: CurrentUserData,
    query: { agentId?: string; orgId?: string },
  ): Prisma.AgentWhereInput {
    return {
      deletedAt: null,
      ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      ...(user.role !== Role.CLIENT && query.orgId && { organizationId: query.orgId }),
      ...(query.agentId && { id: query.agentId }),
    };
  }

  private async loadScopedSession(publicSessionId: string, user: CurrentUserData) {
    this.assertClientHasOrg(user);
    const session = await this.prisma.chatSession.findFirst({
      where: {
        sessionId: publicSessionId,
        agent: {
          deletedAt: null,
          ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
        },
      },
      include: {
        agent: { select: { id: true, name: true, organizationId: true, humanConnectedLabel: true } },
        takenOverBy: { select: { id: true, name: true } },
      },
    });
    if (!session) throw new NotFoundException('Conversation not found');
    return session;
  }

  private ctxOf(session: {
    id: string;
    sessionId: string;
    agent: { organizationId: string };
  }): HandoverCtx {
    return {
      sessionDbId: session.id,
      publicSessionId: session.sessionId,
      organizationId: session.agent.organizationId,
    };
  }

  private async insertSystemMessage(sessionDbId: string, content: string) {
    return this.prisma.chatMessage.create({
      data: { chatSessionId: sessionDbId, role: 'SYSTEM', content, metadata: { system: true } },
    });
  }

  private authorName(metadata: Prisma.JsonValue | null): string | null {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const ha = (metadata as Record<string, unknown>).humanAgent;
      if (ha && typeof ha === 'object' && 'name' in ha) {
        const name = (ha as Record<string, unknown>).name;
        if (typeof name === 'string') return name;
      }
    }
    return null;
  }

  private async resolveUserName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return u?.name?.trim() || 'A teammate';
  }
}
