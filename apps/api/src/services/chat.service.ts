import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TracerService } from "../common/tracer/tracer.service";
import { WidgetEventLogger } from "../common/events/widget.logger";
import { AppLogger } from "../common/logger/app-logger";
import { DirectChatService } from "../modules/ai/direct-chat.service";
import { PiiDetectionService } from "../modules/pii/pii-detection.service";
import { PiiTokenizerService } from "../modules/pii/pii-tokenizer.service";
import { HandoverService } from "./handover.service";
import { ConsentService } from "./consent.service";
import type { VisitorIdentity } from "./web-visitor";
import type { SendMessageDto } from "@repo/validation";
import type { ChatSession, Prisma, HandoverReason } from "@prisma/client";
import type { ChatMessageMetadata } from "./chat-metadata.interface";
import { MessageMetricsService } from "./message-metrics.service";
import { detectFallback } from "../utils/fallback-detection";
import { randomUUID } from "crypto";
import { clientIp } from "../utils/client-ip";

/** The session a message is written to. Its agent and channel are copied onto the message (ADR-0007). */
export type MessageSession = Pick<ChatSession, "id" | "agentId" | "source">;

/** A session the handover helpers act on: a MessageSession plus its public id. */
type HandoverSession = MessageSession & Pick<ChatSession, "sessionId">;

@Injectable()
export class ChatService {
  private readonly log = new AppLogger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracerService: TracerService,
    private readonly directChatService: DirectChatService,
    private readonly messageMetricsService: MessageMetricsService,
    private readonly handoverService: HandoverService,
    private readonly piiDetection: PiiDetectionService,
    private readonly piiTokenizer: PiiTokenizerService,
    private readonly widgetLog: WidgetEventLogger,
    private readonly consentService: ConsentService,
  ) {}

  /**
   * True when a human teammate has taken over this session — the AI must NOT
   * reply on ANY route (widget / WhatsApp / voice). Shared by every channel so
   * the pause is enforced in exactly one place.
   */
  isPausedForHuman(session: { handoverState: string }): boolean {
    return session.handoverState === "ACTIVE_HUMAN";
  }

  /**
   * Record an inbound visitor message that arrived while a human is handling:
   * persists it and pushes it to the dashboard, with NO AI reply. Used by the
   * non-stream send, WhatsApp, and voice paths (the widget stream calls
   * HandoverService directly).
   */
  async recordPausedInbound(
    session: HandoverSession,
    organizationId: string,
    content: string,
  ): Promise<void> {
    await this.handoverService.onVisitorMessageWhilePaused(
      {
        sessionDbId: session.id,
        publicSessionId: session.sessionId,
        agentId: session.agentId,
        source: session.source,
        organizationId,
      },
      content,
    );
  }

  /**
   * Cheap escalation: if the visitor explicitly asks for a human (keyword match,
   * no LLM) and the agent has human takeover enabled, raise the session
   * NONE → REQUESTED so it surfaces in the dashboard Inbox. Channel-agnostic —
   * used by the WhatsApp + voice routes (the widget stream wires this PLUS the
   * LLM `connect_to_human` tool directly). Returns true if it escalated this
   * turn. Best-effort: `raiseRequested` swallows its own errors.
   */
  async maybeEscalateToHuman(
    session: HandoverSession & { handoverState: string },
    agent: { humanTakeoverEnabled?: boolean | null; organizationId: string },
    text: string,
  ): Promise<boolean> {
    if (!agent.humanTakeoverEnabled) return false;
    if (session.source === "DEMO") return false; // demo/preview never raises a real handover
    if (session.handoverState !== "NONE") return false;
    if (!this.handoverService.detectKeyword(text)) return false;
    await this.handoverService.raiseRequested(
      {
        sessionDbId: session.id,
        publicSessionId: session.sessionId,
        agentId: session.agentId,
        source: session.source,
        organizationId: agent.organizationId,
      },
      "USER_REQUESTED",
    );
    return true;
  }

  /**
   * Ping the dashboard that a bot turn landed while a handover is pending
   * (REQUESTED), so the Inbox thread shows the bot's live messages. Callers gate
   * on being in a handover. Best-effort.
   */
  async publishHandoverBotTurn(
    session: HandoverSession,
    organizationId: string,
  ): Promise<void> {
    await this.handoverService.publishBotTurn({
      sessionDbId: session.id,
      publicSessionId: session.sessionId,
      agentId: session.agentId,
      source: session.source,
      organizationId,
    });
  }

  /**
   * Per-turn system hint that makes the bot stall politely while a teammate is
   * being connected (handoverState = REQUESTED). Passed as `extraSystemInstruction`
   * by every route (widget text, voice, WhatsApp) when the chat is mid-handover.
   */
  handoverStallInstruction(agent: {
    humanConnectedLabel?: string | null;
  }): string {
    return this.handoverService.stallInstruction(agent.humanConnectedLabel);
  }

  /**
   * The `connect_to_human` tool + its system instruction, for channels that run
   * a tool-capable LLM turn (widget text, voice) so the model can escalate on
   * frustration / explicit consent — same behaviour on every route. `onEscalate`
   * fires when the model calls it, so the caller can signal the client to poll.
   */
  buildHumanConnectTool(
    session: HandoverSession,
    organizationId: string,
    onEscalate: (reason: HandoverReason) => void,
  ) {
    return this.handoverService.buildConnectTool(
      {
        sessionDbId: session.id,
        publicSessionId: session.sessionId,
        agentId: session.agentId,
        source: session.source,
        organizationId,
      },
      onEscalate,
    );
  }

  humanOfferInstruction(): string {
    return this.handoverService.offerInstruction();
  }

  async resolveAgent(agentId: string) {
    // Support both internal UUID and public short ID (widget sends publicId)
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        agentId,
      );
    const agent = await this.prisma.agent.findFirst({
      where: {
        ...(isUuid ? { id: agentId } : { publicId: agentId }),
        deletedAt: null,
        status: "ACTIVE",
      },
      select: {
        id: true,
        aiConfig: true,
        organizationId: true,
      },
    });
    if (!agent) {
      throw new NotFoundException("Agent not found or inactive");
    }
    return agent;
  }

  // Hard session lifetime, measured from createdAt (NOT lastMessageAt). A
  // session is bounded — after 6h from its first message the row is sealed,
  // the next message from the same widget rotates to a brand-new session.
  // Reasoning is in the conversations PRD / classifier comments: bounded
  // lifetime gives cleaner analytics and a deterministic moment for the
  // classifier to run. The web widget separately resets sessionId on page
  // reload / tab close (handled in apps/widget session-manager); the
  // per-agent `sessionLifetimeHours` catches the long-running-tab case and
  // is the ONLY rule for channels with no page concept (WhatsApp).

  async resolveOrCreateSession(
    agentId: string,
    sessionId?: string,
    source: "DEMO" | "WIDGET" | "WHATSAPP" = "DEMO",
    visitor: VisitorIdentity = {},
  ): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findFirst({
        where: { sessionId, agentId, status: "ACTIVE" },
        // Pull the agent's per-row lifetime alongside the session so the
        // expiry check uses the agent's configured value (6-24h range,
        // default 6h) rather than a hardcoded constant.
        include: { agent: { select: { sessionLifetimeHours: true } } },
      });
      if (!existing) {
        throw new NotFoundException(
          "Session not found or does not belong to this agent",
        );
      }

      // Auto-rotate when the session has lived past its lifetime cap. We
      // measure from `createdAt` — not `lastMessageAt` — so sessions have a
      // bounded length even when someone keeps the conversation going.
      // Old row gets stamped EXPIRED (the dashboard + classifier rely on it
      // to tell live conversations apart from closed ones); the next call
      // gets a brand-new sessionId in the response and rotates client-side.
      const lifetimeMs = existing.agent.sessionLifetimeHours * 60 * 60 * 1000;
      // Never rotate/expire a session that's mid-handover: a long human chat
      // crossing its lifetime cap must NOT split into two sessions. The instant
      // it's resolved (handoverState back to NONE), normal rotation resumes.
      const isExpired =
        existing.handoverState === "NONE" &&
        Date.now() - existing.createdAt.getTime() > lifetimeMs;
      if (isExpired) {
        await this.prisma.chatSession.update({
          where: { id: existing.id },
          data: { status: "EXPIRED" },
        });
        return this.createWidgetAwareSession(agentId, source, visitor);
      }

      // Backfill the visitor on an existing session that was created without
      // one (e.g. a request that carried no device ID, or a loopback IP).
      //
      // Fire-and-forget: the chat hot-path doesn't read session.visitorId, so
      // we don't need to await the write. The UPDATE lands ~300-500ms after
      // the response is already streaming; analytics consumers see the fresh
      // value on the next query. In local testing where req.ip is always
      // loopback, this was triggering an extra serial Prisma write on EVERY
      // turn — the dominant remaining controller pre-stream cost.
      const backfill: Prisma.ChatSessionUpdateInput = {};
      if (visitor.visitorId && !existing.visitorId)
        backfill.visitorId = visitor.visitorId;
      if (visitor.ipHash && !existing.ipHash) backfill.ipHash = visitor.ipHash;
      if (Object.keys(backfill).length > 0) {
        void this.prisma.chatSession
          .update({
            where: { id: existing.id },
            data: backfill,
          })
          .catch((err) => {
            this.log.warn(
              "resolveOrCreateSession",
              `visitorId backfill failed (session=${existing.id})`,
              { err: err instanceof Error ? err.message : String(err) },
            );
          });
      }
      return existing;
    }
    return this.createWidgetAwareSession(agentId, source, visitor);
  }

  /**
   * Create a new chat session, emitting WIDGET_SESSION_STARTED for widget
   * sessions (the first-contact observability signal). DEMO is preview-only and
   * WhatsApp session starts are covered by its own inbound-message event, so
   * only WIDGET emits here.
   *
   * The consent gate runs here, at session creation only: in consent mode a
   * visitor without a current GRANTED decision gets ConsentRequiredException
   * (403, code CONSENT_REQUIRED) and no session is created.
   */
  private async createWidgetAwareSession(
    agentId: string,
    source: "DEMO" | "WIDGET" | "WHATSAPP",
    visitor: VisitorIdentity,
  ): Promise<ChatSession> {
    const consentId = await this.consentService.assertConsented(
      agentId,
      source,
      visitor.visitorId,
    );
    const session = await this.prisma.chatSession.create({
      data: {
        agentId,
        sessionId: randomUUID(),
        source,
        visitorId: visitor.visitorId ?? null,
        ipHash: visitor.ipHash ?? null,
        consentId,
      },
    });
    if (source === "WIDGET") {
      this.widgetLog.logSessionStarted({
        agentId,
        sessionId: session.sessionId,
        visitorId: visitor.visitorId,
      });
    }
    return session;
  }

  /**
   * Resolve or create a session for a server-keyed channel (e.g. WhatsApp), where
   * the client can't carry a sessionId between turns — the visitor is identified by
   * a stable key (their phone number). Applies the SAME per-agent
   * sessionLifetimeHours rotation as the widget path: an active session past its
   * lifetime cap is stamped EXPIRED and a fresh one created, so analytics see
   * distinct conversations exactly like the widget.
   *
   * Differs from resolveOrCreateSession (which THROWS on an unknown id — the
   * widget's client-driven contract) by looking the session up via
   * (agent, source, visitor) and creating one when absent. The stored `sessionId`
   * is still a random UUID to satisfy the unique constraint.
   */
  async resolveOrCreateVisitorSession(
    agentId: string,
    source: "WHATSAPP",
    visitorKey: string,
  ): Promise<ChatSession> {
    const existing = await this.prisma.chatSession.findFirst({
      where: { agentId, source, visitorId: visitorKey, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { sessionLifetimeHours: true } } },
    });

    if (existing) {
      const lifetimeMs = existing.agent.sessionLifetimeHours * 60 * 60 * 1000;
      // Mid-handover sessions never rotate (see resolveOrCreateSession).
      const isExpired =
        existing.handoverState === "NONE" &&
        Date.now() - existing.createdAt.getTime() > lifetimeMs;
      if (!isExpired) return existing;
      // Past its lifetime — close it (the dashboard + classifier rely on EXPIRED
      // to tell finished conversations apart), then fall through to a fresh one.
      await this.prisma.chatSession.update({
        where: { id: existing.id },
        data: { status: "EXPIRED" },
      });
    }

    return this.prisma.chatSession.create({
      data: {
        agentId,
        sessionId: randomUUID(),
        source,
        visitorId: visitorKey,
      },
    });
  }

  /** Client IP from the proxy-derived req.ip only (see utils/client-ip). */
  static extractVisitorIp(request: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  }): string | undefined {
    return clientIp(request);
  }

  /**
   * Save a user message to the database.
   *
   * Accepts an optional explicit `id` so streaming callers can pre-generate
   * the UUID and fire-and-forget the persist while still tracking the row for
   * later operations (e.g. orphan cleanup). Mirrors `saveAssistantMessage`.
   */
  async saveUserMessage(
    session: MessageSession,
    content: string,
    id?: string,
    organizationId?: string,
  ) {
    return this.prisma.chatMessage.create({
      data: {
        ...(id ? { id } : {}),
        chatSessionId: session.id,
        agentId: session.agentId,
        sessionSource: session.source,
        role: "USER",
        content: await this.redactUserContent(
          content,
          session.id,
          organizationId,
        ),
      },
    });
  }

  /**
   * Single choke point for persisting visitor-authored text.
   *   - HARD_DROP-tier (card/Aadhaar/passport/…) is ALWAYS destroyed.
   *   - VAULT-tier (bank/DOB/PAN/IFSC): callers pass `organizationId` ONLY when
   *     the agent opted into PII redaction (`aiConfig.piiRedactionEnabled`), in
   *     which case those values are tokenised into the encrypted vault and the
   *     transcript stores the token. Without an org this is the pre-existing
   *     HARD_DROP-only behaviour (no regression for agents that never opted in).
   * Gating storage on the SAME flag as the LLM path keeps the two consistent.
   * See docs/security/pii-handling-spec.md.
   */
  private async redactUserContent(
    content: string,
    chatSessionId: string,
    organizationId?: string,
  ): Promise<string> {
    return organizationId
      ? this.piiTokenizer.redactForStorage(
          organizationId,
          chatSessionId,
          content,
        )
      : this.piiDetection.maskHardDrop(content);
  }

  /**
   * True when the agent opted into PII redaction. Reading the raw boolean is
   * equivalent to the parsed `aiConfig` (schema default is `false`) and avoids a
   * full Zod parse on the persist path. Callers use it to decide whether to pass
   * `organizationId` into `saveUserMessage`/`redactUserContent` (→ vault).
   */
  static isPiiRedactionEnabled(
    aiConfig: Prisma.JsonValue | null | undefined,
  ): boolean {
    // Always ON (ADR-0005). A stored piiRedactionEnabled=false from before the
    // editor toggle was removed is ignored. The parameter stays so every
    // channel keeps one call site to change if this ever becomes a choice.
    void aiConfig;
    return true;
  }

  /**
   * Save an assistant message with metadata to the database.
   *
   * Accepts an optional explicit `id` so the caller can pre-generate the UUID
   * and return it to the client (in the SSE `done` event) BEFORE the DB write
   * completes. This lets the public chat endpoint fire-and-forget the persist
   * instead of holding the response open for the ~300-500ms Supabase round
   * trip. If `id` isn't supplied, Prisma generates one as before.
   */
  async saveAssistantMessage(
    session: MessageSession,
    content: string,
    metadata: Prisma.InputJsonValue,
    id?: string,
  ) {
    const message = await this.prisma.chatMessage.create({
      data: {
        ...(id ? { id } : {}),
        chatSessionId: session.id,
        agentId: session.agentId,
        sessionSource: session.source,
        role: "ASSISTANT",
        content,
        metadata,
      },
    });
    // Mirror analytics metrics into typed columns via the single normalizing
    // writer. Best-effort (never throws into the chat path) and idempotent.
    await this.messageMetricsService.recordFromMetadata(
      message,
      metadata as unknown as Record<string, unknown>,
    );
    return message;
  }

  /**
   * Update session lastMessageAt timestamp.
   */
  async updateSessionTimestamp(sessionDbId: string) {
    return this.prisma.chatSession.update({
      where: { id: sessionDbId },
      data: { lastMessageAt: new Date() },
    });
  }

  /**
   * Delete a message by ID. Used to clean up orphaned user messages on stream failure.
   */
  async deleteMessage(messageId: string) {
    return this.prisma.chatMessage.delete({ where: { id: messageId } });
  }

  /**
   * Public poll for a session's recent messages + current handover state. The
   * widget calls this (only while escalated) to receive a human agent's replies
   * and to learn when the handover ends (handoverState back to NONE → stop
   * polling, resume the bot). Scoped by the unguessable public sessionId.
   */
  async pollPublicSession(publicSessionId: string, after?: Date) {
    const session = await this.prisma.chatSession.findUnique({
      where: { sessionId: publicSessionId },
      select: { id: true, handoverState: true },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        chatSessionId: session.id,
        ...(after ? { createdAt: { gt: after } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        metadata: true,
      },
    });
    return {
      handoverState: session.handoverState,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        author: ChatService.extractHumanAuthor(m.metadata),
      })),
    };
  }

  /** Pull the human agent's display name out of a HUMAN_AGENT message's metadata. */
  private static extractHumanAuthor(
    metadata: Prisma.JsonValue | null,
  ): string | null {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const ha = (metadata as Record<string, unknown>).humanAgent;
      if (ha && typeof ha === "object" && "name" in ha) {
        const name = (ha as Record<string, unknown>).name;
        if (typeof name === "string") return name;
      }
    }
    return null;
  }

  /**
   * Send a message to an agent and get an AI response through DirectChatService.
   * Persists with the unified `ChatMessageMetadata` shape so analytics
   * (`responseLatencyMs`, `timeToFirstToken`, `streamingMode`) read one format.
   */
  async sendMessage(dto: SendMessageDto, visitor: VisitorIdentity = {}) {
    const agent = await this.resolveAgent(dto.agentId);
    return this.sendDirectMessage(dto, agent.id, visitor);
  }

  /**
   * Sync send. Delegates to DirectChatService.send() and persists the message
   * with the unified metadata plus native fields (cachedInputTokens, traceId, cost).
   */
  private async sendDirectMessage(
    dto: SendMessageDto,
    agentId: string,
    visitor: VisitorIdentity,
  ) {
    const backendReceivedAt = new Date();
    // Need the full Agent entity (with systemPrompt + organizationId) for
    // the orchestrator — `resolveAgent` only returns a stripped projection.
    const fullAgent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
    });
    const session = await this.resolveOrCreateSession(
      agentId,
      dto.sessionId,
      dto.source ?? "DEMO",
      visitor,
    );

    // Human handover: a teammate is handling this chat → no AI reply. Persist
    // the visitor's message + push it to the dashboard, then return paused.
    if (this.isPausedForHuman(session)) {
      await this.recordPausedInbound(
        session,
        fullAgent.organizationId,
        dto.chatInput,
      );
      const pausedMetadata: ChatMessageMetadata = {
        streamingMode: "direct",
        backendReceivedAt: backendReceivedAt.toISOString(),
        backendRespondedAt: new Date().toISOString(),
        responseLatencyMs: 0,
        timeToFirstToken: null,
        timeToLastToken: null,
        totalChunks: null,
        streamDurationMs: null,
      };
      return {
        sessionId: session.sessionId,
        messageId: "",
        reply: "",
        assistantMessageId: "",
        metadata: pausedMetadata,
        paused: true as const,
      };
    }

    const result = await this.directChatService.send({
      agent: fullAgent,
      chatSessionId: session.id,
      externalSessionId: session.sessionId,
      newUserMessage: dto.chatInput,
      recentHistory: dto.recentHistory,
      feature: "chat",
    });
    const backendRespondedAt = new Date();

    const metadata: ChatMessageMetadata = {
      streamingMode: "direct",
      backendReceivedAt: backendReceivedAt.toISOString(),
      backendRespondedAt: backendRespondedAt.toISOString(),
      responseLatencyMs:
        backendRespondedAt.getTime() - backendReceivedAt.getTime(),
      // Non-streaming direct call: no per-token timing available, but we still
      // populate the shape so downstream queries can `COALESCE` consistently.
      timeToFirstToken: null,
      timeToLastToken: null,
      totalChunks: null,
      streamDurationMs: null,
      // Native direct-mode fields:
      traceId: result.traceId,
      model: result.model,
      cost: result.cost,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      cachedInputTokens: result.usage.cachedInputTokens ?? null,
      reasoningTokens: result.usage.reasoningTokens ?? null,
      finishReason: result.finishReason,
      historyCount: result.historyCount,
      historyTruncated: result.historyTruncated,
      ...detectFallback(result.text, fullAgent.fallbackPhrases),
    };

    const storedUserContent = await this.redactUserContent(
      dto.chatInput,
      session.id,
      ChatService.isPiiRedactionEnabled(fullAgent.aiConfig)
        ? fullAgent.organizationId
        : undefined,
    );
    const [userMessage, assistantMessage] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: {
          chatSessionId: session.id,
          agentId: session.agentId,
          sessionSource: session.source,
          role: "USER",
          content: storedUserContent,
        },
      }),
      this.prisma.chatMessage.create({
        data: {
          chatSessionId: session.id,
          agentId: session.agentId,
          sessionSource: session.source,
          role: "ASSISTANT",
          content: result.text,
          metadata,
        },
      }),
      this.prisma.chatSession.update({
        where: { id: session.id },
        data: { lastMessageAt: backendRespondedAt },
      }),
    ]);

    await this.messageMetricsService.recordFromMetadata(
      assistantMessage,
      metadata as unknown as Record<string, unknown>,
    );

    return {
      sessionId: session.sessionId,
      messageId: userMessage.id,
      reply: result.text,
      assistantMessageId: assistantMessage.id,
      metadata,
    };
  }
}
