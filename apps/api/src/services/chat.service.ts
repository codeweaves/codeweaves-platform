import { Injectable, Logger, NotFoundException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgentsService } from './agents.service';
import { HmacService } from '../common/security/hmac.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TracerService } from '../common/tracer/tracer.service';
import { DirectChatService } from '../modules/ai/direct-chat.service';
import type { SendMessageDto } from '@repo/validation';
import { resolveRoutingMode } from '@repo/validation';
import type { ChatSession, Prisma } from '@prisma/client';
import type { ChatMessageMetadata } from './chat-metadata.interface';
import { randomUUID } from 'crypto';

const N8N_TIMEOUT_MS = 10_000;
const MAX_LOG_RESPONSE_LENGTH = 500;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly hmacService: HmacService,
    private readonly cryptoService: CryptoService,
    private readonly tracerService: TracerService,
    private readonly directChatService: DirectChatService,
  ) {}

  private buildMetadata(
    backendReceivedAt: Date,
    backendRespondedAt: Date,
    n8nResponse: { n8nReceivedAt?: string; agentRepliedAt?: string },
  ): ChatMessageMetadata {
    return {
      streamingMode: 'simulated',
      backendReceivedAt: backendReceivedAt.toISOString(),
      n8nReceivedAt: n8nResponse.n8nReceivedAt ?? null,
      agentRepliedAt: n8nResponse.agentRepliedAt ?? null,
      backendRespondedAt: backendRespondedAt.toISOString(),
      responseLatencyMs: backendRespondedAt.getTime() - backendReceivedAt.getTime(),
      // Streaming fields are null on the simulated-sync path — analytics can
      // `COALESCE(timeToFirstToken, responseLatencyMs)` if it wants a unified
      // "time-to-usable-output" metric across modes.
      timeToFirstToken: null,
      timeToLastToken: null,
      totalChunks: null,
      streamDurationMs: null,
    };
  }

  async resolveAgent(agentId: string) {
    // Support both internal UUID and public short ID (widget sends publicId)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId);
    const agent = await this.prisma.agent.findFirst({
      where: {
        ...(isUuid ? { id: agentId } : { publicId: agentId }),
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true, hmacEnabled: true, aiConfig: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found or inactive');
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
    source: 'DEMO' | 'WIDGET' | 'WHATSAPP' = 'DEMO',
    visitorId?: string,
  ): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findFirst({
        where: { sessionId, agentId, status: 'ACTIVE' },
        // Pull the agent's per-row lifetime alongside the session so the
        // expiry check uses the agent's configured value (6-24h range,
        // default 6h) rather than a hardcoded constant.
        include: { agent: { select: { sessionLifetimeHours: true } } },
      });
      if (!existing) {
        throw new NotFoundException('Session not found or does not belong to this agent');
      }

      // Auto-rotate when the session has lived past its lifetime cap. We
      // measure from `createdAt` — not `lastMessageAt` — so sessions have a
      // bounded length even when someone keeps the conversation going.
      // Old row gets stamped EXPIRED (the dashboard + classifier rely on it
      // to tell live conversations apart from closed ones); the next call
      // gets a brand-new sessionId in the response and rotates client-side.
      const lifetimeMs = existing.agent.sessionLifetimeHours * 60 * 60 * 1000;
      const isExpired =
        Date.now() - existing.createdAt.getTime() > lifetimeMs;
      if (isExpired) {
        await this.prisma.chatSession.update({
          where: { id: existing.id },
          data: { status: 'EXPIRED' },
        });
        return this.prisma.chatSession.create({
          data: {
            agentId,
            sessionId: randomUUID(),
            source,
            visitorId: visitorId ?? null,
          },
        });
      }

      // Backfill visitorId on an existing session when missing, OR when the
      // stored value is a loopback address (::1, 127.0.0.1) — this happens
      // when the first request arrived before the widget's public-IP lookup
      // resolved, so req.ip fell back to localhost.
      //
      // Fire-and-forget: the chat hot-path doesn't read session.visitorId, so
      // we don't need to await the write. The UPDATE lands ~300-500ms after
      // the response is already streaming; analytics consumers see the fresh
      // value on the next query. In local testing where req.ip is always
      // loopback, this was triggering an extra serial Prisma write on EVERY
      // turn — the dominant remaining controller pre-stream cost.
      const isLoopback = existing.visitorId === '::1'
        || existing.visitorId === '127.0.0.1'
        || existing.visitorId?.startsWith('::ffff:127.');
      if (visitorId && (!existing.visitorId || isLoopback)) {
        void this.prisma.chatSession
          .update({
            where: { id: existing.id },
            data: { visitorId },
          })
          .catch((err) => {
            this.logger.warn(
              `visitorId backfill failed (session=${existing.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
      return existing;
    }
    return this.prisma.chatSession.create({
      data: {
        agentId,
        sessionId: randomUUID(),
        source,
        visitorId: visitorId ?? null,
      },
    });
  }

  /** Extract client IP from an Express request (req.ip → X-Forwarded-For). */
  static extractVisitorIp(request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string | undefined {
    if (request.ip) return request.ip;
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0]! : String(forwarded).split(',')[0]!;
      return first.trim() || undefined;
    }
    return undefined;
  }

  /**
   * Save a user message to the database.
   *
   * Accepts an optional explicit `id` so streaming callers can pre-generate
   * the UUID and fire-and-forget the persist while still tracking the row for
   * later operations (e.g. orphan cleanup). Mirrors `saveAssistantMessage`.
   */
  async saveUserMessage(chatSessionId: string, content: string, id?: string) {
    return this.prisma.chatMessage.create({
      data: {
        ...(id ? { id } : {}),
        chatSessionId,
        role: 'USER',
        content,
      },
    });
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
    chatSessionId: string,
    content: string,
    metadata: Prisma.InputJsonValue,
    id?: string,
  ) {
    return this.prisma.chatMessage.create({
      data: {
        ...(id ? { id } : {}),
        chatSessionId,
        role: 'ASSISTANT',
        content,
        metadata,
      },
    });
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
   * Fetch the agent's decrypted HMAC secret from AgentSecret.
   * Returns null if no secret exists.
   */
  private async getAgentHmacSecret(agentId: string): Promise<string | null> {
    const agentSecret = await this.prisma.agentSecret.findUnique({
      where: { agentId },
      select: { apiKey: true },
    });
    if (!agentSecret?.apiKey) return null;
    return this.cryptoService.decrypt(agentSecret.apiKey);
  }

  /**
   * Send a message to an agent and get an AI response. Routes to either the
   * n8n webhook or our native DirectChatService depending on `aiConfig.routingMode`.
   *
   * Both paths persist messages with the unified `ChatMessageMetadata` shape so
   * analytics (`responseLatencyMs`, `timeToFirstToken`, `streamingMode`) work
   * identically regardless of which engine served the reply.
   */
  async sendMessage(dto: SendMessageDto, visitorIp?: string) {
    const agent = await this.resolveAgent(dto.agentId);
    const routingMode = resolveRoutingMode(agent.aiConfig);

    if (routingMode === 'direct') {
      return this.sendDirectMessage(dto, agent.id, visitorIp);
    }
    return this.sendN8nMessage(dto, agent, visitorIp);
  }

  /**
   * Direct-mode sync send. Delegates to DirectChatService.send() and persists
   * the resulting message with metadata that mirrors the n8n shape plus our
   * richer native fields (cachedInputTokens, traceId, cost, etc.).
   */
  private async sendDirectMessage(dto: SendMessageDto, agentId: string, visitorIp?: string) {
    const backendReceivedAt = new Date();
    // Need the full Agent entity (with systemPrompt + organizationId) for
    // the orchestrator — `resolveAgent` only returns a stripped projection.
    const fullAgent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    const session = await this.resolveOrCreateSession(agentId, dto.sessionId, dto.source ?? 'DEMO', visitorIp);

    const result = await this.directChatService.send({
      agent: fullAgent,
      chatSessionId: session.id,
      externalSessionId: session.sessionId,
      newUserMessage: dto.chatInput,
      recentHistory: dto.recentHistory,
      feature: 'chat',
    });
    const backendRespondedAt = new Date();

    const metadata: ChatMessageMetadata = {
      streamingMode: 'direct',
      backendReceivedAt: backendReceivedAt.toISOString(),
      backendRespondedAt: backendRespondedAt.toISOString(),
      responseLatencyMs: backendRespondedAt.getTime() - backendReceivedAt.getTime(),
      // Non-streaming direct call: no per-token timing available, but we still
      // populate the shape so downstream queries can `COALESCE` consistently.
      timeToFirstToken: null,
      timeToLastToken: null,
      totalChunks: null,
      streamDurationMs: null,
      // n8n-only fields intentionally omitted (undefined → absent in JSONB).
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
    };

    const [userMessage, assistantMessage] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: { chatSessionId: session.id, role: 'USER', content: dto.chatInput },
      }),
      this.prisma.chatMessage.create({
        data: {
          chatSessionId: session.id,
          role: 'ASSISTANT',
          content: result.text,
          metadata,
        },
      }),
      this.prisma.chatSession.update({
        where: { id: session.id },
        data: { lastMessageAt: backendRespondedAt },
      }),
    ]);

    return {
      sessionId: session.sessionId,
      messageId: userMessage.id,
      reply: result.text,
      assistantMessageId: assistantMessage.id,
      metadata,
    };
  }

  /**
   * Legacy n8n-mode sync send. Original behaviour — calls the configured
   * webhook, HMAC-verifies if enabled, persists with simulated-streaming
   * metadata. Will be removed once n8n is retired.
   */
  private async sendN8nMessage(
    dto: SendMessageDto,
    agent: { id: string; hmacEnabled: boolean },
    visitorIp?: string,
  ) {
    const backendReceivedAt = new Date();
    const session = await this.resolveOrCreateSession(agent.id, dto.sessionId, dto.source ?? 'DEMO', visitorIp);

    // Call n8n webhook BEFORE storing messages to avoid orphaned user messages on failure
    const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(agent.id);
    const n8nResponse = await this.callN8nWebhook(
      webhookUrl,
      dto.chatInput,
      session.sessionId,
      agent.id,
      agent.hmacEnabled,
    );

    const backendRespondedAt = new Date();
    const metadata = this.buildMetadata(backendReceivedAt, backendRespondedAt, n8nResponse);

    // Store user message + AI response + update session atomically
    const [userMessage, assistantMessage] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: {
          chatSessionId: session.id,
          role: 'USER',
          content: dto.chatInput,
        },
      }),
      this.prisma.chatMessage.create({
        data: {
          chatSessionId: session.id,
          role: 'ASSISTANT',
          content: n8nResponse.agentReply,
          metadata,
        },
      }),
      this.prisma.chatSession.update({
        where: { id: session.id },
        data: { lastMessageAt: backendRespondedAt },
      }),
    ]);

    return {
      sessionId: session.sessionId,
      messageId: userMessage.id,
      reply: n8nResponse.agentReply,
      assistantMessageId: assistantMessage.id,
      metadata,
    };
  }

  /**
   * Split text into chunks at word boundaries.
   * Default: ~3 words per chunk for natural typing feel.
   */
  static chunkText(text: string, chunkSize = 3): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      // Add trailing space between chunks so they concatenate correctly
      chunks.push(i + chunkSize < words.length ? chunk + ' ' : chunk);
    }

    return chunks;
  }

  /**
   * Stream a message response via SSE.
   * Stores user message before calling n8n, stores AI message after response.
   * Returns data for SSE streaming by the controller.
   */
  async streamMessage(dto: SendMessageDto, visitorIp?: string) {
    const backendReceivedAt = new Date();

    const agent = await this.resolveAgent(dto.agentId);
    const session = await this.resolveOrCreateSession(agent.id, dto.sessionId, dto.source ?? 'DEMO', visitorIp);

    // Store user message BEFORE calling n8n
    const userMessage = await this.prisma.chatMessage.create({
      data: {
        chatSessionId: session.id,
        role: 'USER',
        content: dto.chatInput,
      },
    });

    // Call n8n webhook to get full response
    const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(dto.agentId);
    const n8nResponse = await this.callN8nWebhook(
      webhookUrl,
      dto.chatInput,
      session.sessionId,
      dto.agentId,
      agent.hmacEnabled,
    );

    const backendRespondedAt = new Date();
    const metadata = this.buildMetadata(backendReceivedAt, backendRespondedAt, n8nResponse);

    // Store AI message AFTER full response received (before streaming starts)
    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        chatSessionId: session.id,
        role: 'ASSISTANT',
        content: n8nResponse.agentReply,
        metadata,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { lastMessageAt: backendRespondedAt },
    });

    const chunks = ChatService.chunkText(n8nResponse.agentReply);

    return {
      sessionId: session.sessionId,
      messageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      chunks,
      metadata,
    };
  }

  /**
   * Verify the HMAC signature on an n8n webhook response.
   * Skips verification if no secret is configured (AC#2: no secret → passthrough).
   * Logs audit event and throws BadGatewayException on failure.
   */
  private async verifyHmacSignature(
    responseText: string,
    signature: string | null,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const secret = await this.getAgentHmacSecret(agentId);
    if (!secret) {
      this.logger.warn(`HMAC enabled but no secret found for agent ${agentId}, skipping verification`);
      return;
    }

    if (!signature) {
      await this.tracerService.logAuditEvent(agentId, 'HMAC_VERIFICATION_FAILED', {
        sessionId,
        reason: 'missing_signature_header',
      });
      throw new BadGatewayException('Response verification failed');
    }

    if (!this.hmacService.verifySignature(responseText, signature, secret)) {
      await this.tracerService.logAuditEvent(agentId, 'HMAC_VERIFICATION_FAILED', {
        sessionId,
        reason: 'invalid_signature',
      });
      throw new BadGatewayException('Response verification failed');
    }
  }

  /**
   * Call n8n webhook with chat input and session ID.
   * Handles timeout, network errors, HMAC verification, and response parsing.
   */
  private async callN8nWebhook(
    webhookUrl: string,
    chatInput: string,
    sessionId: string,
    agentId: string,
    hmacEnabled: boolean,
  ): Promise<{ agentReply: string; n8nReceivedAt?: string; agentRepliedAt?: string }> {
    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatInput, sessionId }),
        signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        this.logger.warn(`n8n webhook timeout for session ${sessionId}`);
        throw new BadGatewayException('Response is taking too long, please try again');
      }
      this.logger.error(
        `n8n webhook network error for session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new BadGatewayException('Unable to connect to AI service, please try again');
    }

    if (!response.ok) {
      this.logger.error(`n8n webhook returned ${response.status} for session ${sessionId}`);
      throw new BadGatewayException('AI service returned an error, please try again');
    }

    try {
      // Read response as text first for HMAC verification
      const responseText = await response.text();

      // Verify HMAC signature if enabled for this agent
      if (hmacEnabled) {
        const signature = response.headers.get('x-signature');
        await this.verifyHmacSignature(responseText, signature, agentId, sessionId);
      }

      const data = JSON.parse(responseText);

      // Handle both object and array response formats
      const payload = Array.isArray(data) ? data[0] : data;

      const agentReply = payload?.agentReply ?? payload?.output;
      if (!agentReply || typeof agentReply !== 'string') {
        const truncated = JSON.stringify(data).slice(0, MAX_LOG_RESPONSE_LENGTH);
        this.logger.error(`Unexpected n8n response format for session ${sessionId}: ${truncated}`);
        throw new BadGatewayException('Unexpected response format from AI service');
      }

      return {
        agentReply,
        n8nReceivedAt: payload?.n8nReceivedAt,
        agentRepliedAt: payload?.agentRepliedAt,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      this.logger.error(
        `Failed to parse n8n response for session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new BadGatewayException('Unexpected response format from AI service');
    }
  }
}
