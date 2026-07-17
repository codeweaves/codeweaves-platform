import { Controller, Post, Get, Body, Param, Query, Res, Req, HttpException, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppLogger } from '../../common/logger/app-logger';
import { WidgetEventLogger } from '../../common/events/widget.logger';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../../decorators/public.decorator';
import { ChatService } from '../../services/chat.service';
import { PrismaService } from '../../services/prisma.service';
import { AgentsService } from '../../services/agents.service';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { DirectChatService } from '../../modules/ai/direct-chat.service';
import { HandoverService } from '../../services/handover.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { sendMessageSchema, type SendMessageDto, resolveRoutingMode } from '@repo/validation';
import type { ChatMessageMetadata } from '../../services/chat-metadata.interface';
import { detectFallback } from '../../utils/fallback-detection';

const STREAM_TIMEOUT_MS = 30_000;

const warmupSchema = z.object({
  agentId: z.string().min(1).max(128),
});
type WarmupDto = z.infer<typeof warmupSchema>;

const requestHumanSchema = z.object({
  agentId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128).optional(),
  source: z.enum(['WIDGET', 'WHATSAPP', 'DEMO']).optional(),
});
type RequestHumanDto = z.infer<typeof requestHumanSchema>;

@ApiTags('Public Chat')
@Public()
@Controller('public/chat')
export class PublicChatController {
  private readonly log = new AppLogger(PublicChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly agentsService: AgentsService,
    private readonly n8nStreamingService: N8nStreamingService,
    private readonly messageRateLimitService: MessageRateLimitService,
    private readonly directChatService: DirectChatService,
    private readonly handoverService: HandoverService,
    private readonly prisma: PrismaService,
    private readonly widgetLog: WidgetEventLogger,
  ) {}

  /**
   * Warmup: fire a tiny LLM call to populate OpenAI's prompt cache for this
   * agent's system prompt + KB before the user types their first message.
   *
   * Triggered by the widget when it loads (or when the user first opens it).
   * By the time the user actually types (~5-60s later), OpenAI has the
   * 1280-token prefix cached → first-message LLM TTFT drops from ~1500-2500ms
   * cold to ~700-900ms warm. Combined with `prompt_cache_retention: '24h'`,
   * the cache stays alive across the entire day.
   *
   * Fire-and-forget: returns 204 immediately. The background LLM call runs to
   * completion (~700-1500ms) and populates the cache. If the call fails (rate
   * limit, network), the next real user message just pays the cold tax — same
   * as before this endpoint existed. No downstream consequences.
   *
   * Rate-limit via the existing per-device message rate limiter — abuse here
   * would translate to LLM cost, so we cap it.
   */
  @Post('warmup')
  @HttpCode(204)
  @ApiOperation({ summary: 'Pre-warm the agent\'s LLM prompt cache' })
  @ApiResponse({ status: 204, description: 'Warmup queued' })
  async warmup(
    @Body(new ZodValidationPipe(warmupSchema)) dto: WarmupDto,
    @Req() req: Request,
  ): Promise<void> {
    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    // Silently skip if rate-limited — warmup is a perf hint, not a real action.
    if (!rateLimitResult.allowed) return;

    // Resolve agent first (cheap, will hit allowedDomains middleware cache too).
    // If the agent doesn't exist we silently no-op — never leak existence info
    // via the warmup endpoint.
    let agent: Awaited<ReturnType<ChatService['resolveAgent']>>;
    try {
      agent = await this.chatService.resolveAgent(dto.agentId);
    } catch {
      return;
    }

    const routingMode = resolveRoutingMode(agent.aiConfig);
    // Only OpenAI-backed agents benefit from auto-cache. n8n mode is a no-op.
    if (routingMode !== 'direct') return;

    // Fire-and-forget the LLM call. Use the streaming path so the actual wire
    // format matches what the real chat endpoint sends — that's what OpenAI's
    // cache fingerprints on. We discard chunks; we only care about the prefix
    // landing in the backend's cache.
    void (async () => {
      try {
        const fullAgent = await this.prisma.agent.findUnique({
          where: { id: agent.id },
        });
        if (!fullAgent) return;
        const stream = this.directChatService.stream({
          agent: fullAgent,
          chatSessionId: 'warmup',
          externalSessionId: 'warmup',
          newUserMessage: 'ping',
          recentHistory: [],
          feature: 'warmup',
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of stream) {
          // Drain the stream. We don't need any chunk content — the side
          // effect (populating OpenAI's prompt cache) happens server-side as
          // the LLM call progresses, independent of whether we read chunks.
        }
      } catch (err) {
        this.log.warn('warmup', `background LLM warmup failed for agent ${agent.id}`, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  @Post('send')
  @ApiOperation({ summary: 'Send a chat message to an agent' })
  @ApiResponse({ status: 200, description: 'Message sent and AI response received' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Agent not found or inactive' })
  @ApiResponse({ status: 502, description: 'AI service error (timeout, network, or unexpected response)' })
  async sendMessage(
    @Body(new ZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
    @Req() req: Request,
  ) {
    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );

    if (!rateLimitResult.allowed) {
      return { error: true, message: rateLimitResult.message, retryAfterSeconds: rateLimitResult.retryAfterSeconds };
    }

    const visitorIp = ChatService.extractVisitorIp(req);
    return this.chatService.sendMessage(dto, visitorIp);
  }

  @Get(':sessionId/poll')
  @ApiOperation({ summary: 'Poll a session for new messages + handover state' })
  @ApiResponse({ status: 200, description: 'Messages after `after` + current handoverState' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async poll(
    @Param('sessionId') sessionId: string,
    @Query('after') after?: string,
  ) {
    // The widget polls this only while escalated, to receive the human's
    // replies + know when the handover ends (handoverState back to NONE).
    // Public: the unguessable sessionId is the bearer (same model as the chat).
    const afterDate = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : undefined;
    return this.chatService.pollPublicSession(sessionId, afterDate);
  }

  /**
   * Explicit "talk to a human" request — the widget button calls this directly.
   *
   * Unlike a typed message, the button's intent is unambiguous, so we escalate
   * DETERMINISTICALLY: no keyword regex, and crucially NO LLM call. We just flip
   * the session to REQUESTED (idempotent) and return the state. The widget shows
   * its own instant acknowledgment — paying for a model turn to "reply" to a
   * button press would be wasteful. Creates a session if the visitor clicks
   * before sending anything. Rate-limited (shares the message limiter) so a
   * no-session spam can't churn out sessions.
   */
  @Post('request-human')
  @ApiOperation({ summary: 'Request a human teammate (deterministic, no LLM)' })
  @ApiResponse({ status: 200, description: 'Handover requested (or current state)' })
  async requestHuman(
    @Body(new ZodValidationPipe(requestHumanSchema)) dto: RequestHumanDto,
    @Req() req: Request,
  ) {
    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );
    if (!rateLimitResult.allowed) {
      return { error: true, message: rateLimitResult.message, retryAfterSeconds: rateLimitResult.retryAfterSeconds };
    }

    const agent = await this.chatService.resolveAgent(dto.agentId);
    const fullAgent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    const visitorIp = ChatService.extractVisitorIp(req);
    const session = await this.chatService.resolveOrCreateSession(
      agent.id,
      dto.sessionId,
      dto.source ?? 'WIDGET',
      visitorIp,
    );

    let handoverState: string = session.handoverState;
    // Demo/preview chats never raise a real handover.
    if (
      fullAgent.humanTakeoverEnabled &&
      session.source !== 'DEMO' &&
      session.handoverState === 'NONE'
    ) {
      await this.handoverService.raiseRequested(
        {
          sessionDbId: session.id,
          publicSessionId: session.sessionId,
          organizationId: fullAgent.organizationId,
        },
        'USER_REQUESTED',
      );
      handoverState = 'REQUESTED';
    }

    return { sessionId: session.sessionId, handoverState };
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream a chat response via Server-Sent Events' })
  @ApiResponse({ status: 200, description: 'SSE stream of AI response chunks (errors sent as SSE events, not HTTP status codes)' })
  @ApiResponse({ status: 400, description: 'Invalid input (only error returned as HTTP status; all other errors are SSE events)' })
  async stream(
    @Body(new ZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Flush headers immediately so the browser stops the "Waiting for server
    // response" timer right away instead of waiting until the first text-delta
    // chunk arrives ~2-3s later. Without this the DevTools network panel shows
    // the entire LLM TTFT under "TTFB", which is misleading.
    res.flushHeaders?.();

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );

    if (!rateLimitResult.allowed) {
      this.log.warn('stream', `rate limited agent=${dto.agentId}`);
      this.widgetLog.logRateLimited({ agentId: dto.agentId });
      res.write(`data: ${JSON.stringify({ type: 'error', message: rateLimitResult.message })}\n\n`);
      res.end();
      return;
    }

    // D3: Capture timestamp AFTER rate limit check so latency metrics reflect only AI pipeline
    const backendReceivedAt = new Date();

    let closed = false;
    const abortController = new AbortController();
    res.on('close', () => {
      closed = true;
      abortController.abort();
    });

    const timeout = setTimeout(() => {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream timeout - response took too long' })}\n\n`);
        res.end();
        closed = true;
        abortController.abort();
      }
    }, STREAM_TIMEOUT_MS);

    try {
      const agent = await this.chatService.resolveAgent(dto.agentId);
      const visitorIp = ChatService.extractVisitorIp(req);
      const routingMode = resolveRoutingMode(agent.aiConfig);

      // IG1: Warn when HMAC is enabled — streaming responses cannot be HMAC-verified.
      // Direct mode has no webhook so HMAC is moot; only warn for n8n mode.
      if (agent.hmacEnabled && routingMode === 'n8n') {
        this.log.warn(
          'stream',
          `agent ${agent.id} has HMAC enabled but streaming responses cannot be verified (applies to sendMessage path only)`,
        );
      }

      // Parallelize the two remaining DB hits — they don't depend on each
      // other (both only need agent.id). Running them concurrently saves one
      // Supabase round-trip (~250-450ms) on every turn. fullAgent is only
      // needed in direct mode, but we optimistically fetch it in parallel:
      // n8n mode discards it (cheap). Direct mode is the common case in prod.
      const sessionPromise = this.chatService.resolveOrCreateSession(
        agent.id,
        dto.sessionId,
        dto.source ?? 'WIDGET',
        visitorIp,
      );
      const fullAgentPromise = routingMode === 'direct'
        ? this.prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })
        : Promise.resolve(null);

      const [session, fullAgentResult] = await Promise.all([sessionPromise, fullAgentPromise]);

      this.log.info('stream', `message received agent=${agent.id} mode=${routingMode}`, {
        sessionId: session.sessionId,
        chars: dto.chatInput.length,
      });
      this.widgetLog.logMessageReceived({
        agentId: agent.id,
        sessionId: session.sessionId,
        visitorId: visitorIp,
        payload: { chars: dto.chatInput.length, source: dto.source ?? 'WIDGET', routingMode },
      });

      // Push an early `session` event so the client knows the connection is
      // alive and which session to round-trip on the next turn. Without this,
      // clients see dead air until the LLM responds. Mirrors the dev test
      // endpoint pattern.
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'session', sessionId: session.sessionId })}\n\n`);
      }

      // ----- Human handover: AI paused -------------------------------------
      // A teammate is actively handling this chat → do NOT call the LLM.
      // Persist the visitor's message + push it to the dashboard; the widget
      // receives the human's replies over its realtime subscription, not here.
      // (fullAgentResult is only fetched in direct mode, the chat path; n8n —
      // legacy, not used for chat — falls through to its normal reply.)
      if (session.handoverState === 'ACTIVE_HUMAN' && fullAgentResult) {
        void this.handoverService.onVisitorMessageWhilePaused(
          {
            sessionDbId: session.id,
            publicSessionId: session.sessionId,
            organizationId: fullAgentResult.organizationId,
          },
          dto.chatInput,
        );
        if (!closed) {
          res.write(`data: ${JSON.stringify({
            type: 'paused',
            reason: 'human',
            handoverState: 'ACTIVE_HUMAN',
            message: fullAgentResult.humanConnectedLabel ?? 'A member of our team is with you.',
          })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done', sessionId: session.sessionId, messageId: null, handoverState: 'ACTIVE_HUMAN' })}\n\n`);
        }
        return; // finally{} clears the timeout + ends the response
      }

      // Handover state to report to the widget on `done` so it knows whether to
      // start polling for a human (REQUESTED/ACTIVE_HUMAN) or stop (NONE). The
      // direct branch refines this once it knows if THIS turn raised the flag.
      let clientHandoverState: string = session.handoverState;

      // Fire-and-forget: persisting the user message must not block the LLM
      // call. We pre-generate the UUID so the row is identifiable if needed,
      // matching the dev test endpoint's pattern. Saves the awaited Supabase
      // round-trip (~300-500ms) before the orchestrator starts.
      const userMessageId = randomUUID();
      void this.chatService
        .saveUserMessage(session.id, dto.chatInput, userMessageId)
        .catch((err) => {
          this.log.warn(
            'stream',
            `saveUserMessage failed sessionId=${session.sessionId} messageId=${userMessageId}`,
            { err: err instanceof Error ? err.message : String(err) },
          );
        });

      // ----- Routing fork ---------------------------------------------------
      // Both branches eventually write `metadata: ChatMessageMetadata` with the
      // same key names so analytics queries don't need to know which engine
      // served the reply. The direct branch populates the richer native fields
      // (traceId, cost, cachedInputTokens, ...) in addition.
      let fullResponse = '';
      let metadata: ChatMessageMetadata;

      if (routingMode === 'direct') {
        const fullAgent = fullAgentResult!;

        // ----- Human handover: trigger + stall ----------------------------
        // Synchronous, zero-LLM keyword check so the bot can stall on THIS
        // turn (no added latency — see handover plan §3a). The DB flip +
        // realtime publish are fire-and-forget; the prompt hint is applied now.
        const handoverCtx = {
          sessionDbId: session.id,
          publicSessionId: session.sessionId,
          organizationId: fullAgent.organizationId,
        };
        // Demo/preview chats never trigger handover.
        const handoverAllowed =
          fullAgent.humanTakeoverEnabled && session.source !== 'DEMO';
        const justRequested =
          handoverAllowed &&
          session.handoverState === 'NONE' &&
          this.handoverService.detectKeyword(dto.chatInput);
        const inRequested = session.handoverState === 'REQUESTED' || justRequested;
        if (justRequested) {
          void this.handoverService.raiseRequested(handoverCtx, 'USER_REQUESTED');
        }
        clientHandoverState = inRequested ? 'REQUESTED' : 'NONE';

        // On bot-handled turns (takeover on, not already escalated) hand the
        // model the connect_to_human tool + an instruction to offer/escalate.
        // The model judges frustration and plain-language consent ("yes please")
        // that the inline keyword check can't; calling the tool flips the
        // session server-side. `toolEscalated` flips when that happens so we can
        // tell the widget to start polling on this same turn.
        let toolEscalated = false;
        const offerHumanTools =
          handoverAllowed && !inRequested
            ? {
                connect_to_human: this.handoverService.buildConnectTool(
                  handoverCtx,
                  () => {
                    toolEscalated = true;
                  },
                ),
              }
            : undefined;

        let firstTokenTime: number | null = null;
        let lastTokenTime: number | null = null;
        let chunkCount = 0;
        let finishPayload:
          | { traceId: string; model: string | null; cost: number | null;
              inputTokens: number; outputTokens: number; totalTokens: number;
              cachedInputTokens: number | null; reasoningTokens: number | null;
              finishReason: string | null; historyCount: number; historyTruncated: boolean }
          | null = null;

        const directStream = this.directChatService.stream({
          agent: fullAgent,
          chatSessionId: session.id,
          externalSessionId: session.sessionId,
          newUserMessage: dto.chatInput,
          // When the caller (widget / demo / any API consumer) sends history
          // in the body, ContextAssemblyService uses it directly and skips
          // the DB query — saves ~150-450ms per turn. Backend still trims
          // to `aiConfig.maxContextMessages` and fits into `maxInputTokens`.
          recentHistory: dto.recentHistory,
          abortSignal: abortController.signal,
          feature: 'chat-stream',
          // While a human is being connected (REQUESTED) the bot keeps replying
          // but is told to stall politely. On bot-handled turns it instead gets
          // the offer/escalate instruction that pairs with connect_to_human.
          extraSystemInstruction: inRequested
            ? this.handoverService.stallInstruction(fullAgent.humanConnectedLabel)
            : offerHumanTools
              ? this.handoverService.offerInstruction()
              : undefined,
          tools: offerHumanTools,
          maxSteps: offerHumanTools ? 3 : undefined,
        });

        for await (const chunk of directStream) {
          if (closed) break;
          if (chunk.type === 'text-delta' && chunk.content) {
            const now = Date.now();
            if (firstTokenTime === null) firstTokenTime = now;
            lastTokenTime = now;
            chunkCount++;
            fullResponse += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'finish') {
            finishPayload = {
              traceId: chunk.result.traceId,
              model: chunk.result.model,
              cost: chunk.result.cost,
              inputTokens: chunk.result.usage.inputTokens,
              outputTokens: chunk.result.usage.outputTokens,
              totalTokens: chunk.result.usage.totalTokens,
              cachedInputTokens: chunk.result.usage.cachedInputTokens ?? null,
              reasoningTokens: chunk.result.usage.reasoningTokens ?? null,
              finishReason: chunk.result.finishReason,
              historyCount: chunk.result.historyCount,
              historyTruncated: chunk.result.historyTruncated,
            };
          } else if (chunk.type === 'error') {
            // DirectChatService already logged + ended the trace. Surface to
            // client as an SSE error and stop — the outer catch will clean up.
            throw new HttpException(chunk.error, 502);
          }
          // 'trace' chunks are orchestration metadata — not forwarded to widgets.
        }

        // The model called connect_to_human mid-stream → session is now
        // REQUESTED. Reflect it so the `done`/`paused` event tells the widget to
        // start polling for the human's replies.
        if (toolEscalated) clientHandoverState = 'REQUESTED';

        const fallback = detectFallback(fullResponse, fullAgent.fallbackPhrases);
        metadata = {
          streamingMode: 'direct',
          backendReceivedAt: backendReceivedAt.toISOString(),
          backendRespondedAt: new Date().toISOString(),
          responseLatencyMs: Date.now() - backendReceivedAt.getTime(),
          timeToFirstToken: firstTokenTime ? firstTokenTime - backendReceivedAt.getTime() : null,
          timeToLastToken: lastTokenTime ? lastTokenTime - backendReceivedAt.getTime() : null,
          totalChunks: chunkCount,
          streamDurationMs: firstTokenTime && lastTokenTime ? lastTokenTime - firstTokenTime : null,
          // Direct-native richer fields (null-safe if `finish` never arrived
          // because of early abort).
          traceId: finishPayload?.traceId ?? null,
          model: finishPayload?.model ?? null,
          cost: finishPayload?.cost ?? null,
          inputTokens: finishPayload?.inputTokens ?? null,
          outputTokens: finishPayload?.outputTokens ?? null,
          totalTokens: finishPayload?.totalTokens ?? null,
          cachedInputTokens: finishPayload?.cachedInputTokens ?? null,
          reasoningTokens: finishPayload?.reasoningTokens ?? null,
          finishReason: finishPayload?.finishReason ?? null,
          historyCount: finishPayload?.historyCount ?? null,
          historyTruncated: finishPayload?.historyTruncated ?? null,
          ...fallback,
        };

        // ----- Human handover: post-turn hooks ----------------------------
        // Ping the dashboard so a watching teammate sees the live exchange (it
        // re-fetches the thread) while a human is being connected — whether the
        // chat was already REQUESTED or the model just escalated via the tool.
        // (No automatic couldn't-answer escalation: a human is summoned only
        // when the VISITOR wants one — explicit ask, button, or tool consent.)
        if (inRequested || toolEscalated) {
          void this.handoverService.publishBotTurn(handoverCtx);
        }
      } else {
        // n8n streaming path — unchanged behaviour, unified metadata shape.
        const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(agent.id);

        let n8nReceivedAt: number | null = null;
        let agentRepliedAt: number | null = null;
        let firstTokenTime: number | null = null;
        let lastTokenTime: number | null = null;
        let chunkCount = 0;

        const generator = this.n8nStreamingService.streamFromWebhookUrl(
          webhookUrl,
          dto.chatInput,
          session.sessionId,
          abortController.signal,
        );

        for await (const chunk of generator) {
          if (closed) break;
          if (chunk.type === 'begin') {
            n8nReceivedAt = chunk.metadata?.timestamp ?? null;
          } else if (chunk.type === 'item' && chunk.content) {
            const now = Date.now();
            if (firstTokenTime === null) firstTokenTime = now;
            lastTokenTime = now;
            chunkCount++;
            fullResponse += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'end') {
            agentRepliedAt = chunk.metadata?.timestamp ?? null;
          }
        }

        metadata = {
          streamingMode: 'real',
          backendReceivedAt: backendReceivedAt.toISOString(),
          n8nReceivedAt: n8nReceivedAt ? new Date(n8nReceivedAt).toISOString() : null,
          agentRepliedAt: agentRepliedAt ? new Date(agentRepliedAt).toISOString() : null,
          backendRespondedAt: new Date().toISOString(),
          responseLatencyMs: Date.now() - backendReceivedAt.getTime(),
          timeToFirstToken: firstTokenTime ? firstTokenTime - backendReceivedAt.getTime() : null,
          timeToLastToken: lastTokenTime ? lastTokenTime - backendReceivedAt.getTime() : null,
          totalChunks: chunkCount,
          streamDurationMs: agentRepliedAt && n8nReceivedAt ? agentRepliedAt - n8nReceivedAt : null,
        };
      }

      // P2: Send done event even when fullResponse is empty.
      if (!closed) {
        // Pre-generate the assistant message UUID so we can (a) send the
        // client the `done` event with a real messageId immediately, and
        // (b) fire-and-forget the DB writes. Previously the SSE connection
        // stayed open waiting for two Supabase writes (~500-800ms round
        // trip), which was the dominant tail in wall-clock time per turn.
        const assistantMessageId = randomUUID();

        res.write(`data: ${JSON.stringify({
          type: 'done',
          sessionId: session.sessionId,
          messageId: assistantMessageId,
          metadata,
          handoverState: clientHandoverState,
        })}\n\n`);

        this.log.info('stream', `reply sent agent=${agent.id}`, {
          sessionId: session.sessionId,
          chars: fullResponse.length,
          ms: metadata.responseLatencyMs,
        });
        // Reply-sent event carries the full turn metadata (model, tokens, cost,
        // latency) — the SSE envelope can't, since streams return no body.
        this.widgetLog.logReplySent({
          agentId: agent.id,
          sessionId: session.sessionId,
          visitorId: visitorIp,
          response: { chars: fullResponse.length },
          latencyMs: metadata.responseLatencyMs,
          metadata: metadata as unknown as Record<string, unknown>,
        });

        // Persist in the background. Errors log but don't leak to the user
        // (the response is already closed at this point). If the write fails,
        // the trace + pino logs still have the response so analytics isn't
        // blind.
        void this.chatService
          .saveAssistantMessage(session.id, fullResponse, metadata, assistantMessageId)
          .catch((err) => {
            this.log.warn(
              'stream',
              `assistant message persist failed sessionId=${session.sessionId} messageId=${assistantMessageId}`,
              { err: err instanceof Error ? err.message : String(err) },
            );
          });
        void this.chatService
          .updateSessionTimestamp(session.id)
          .catch((err) => {
            this.log.warn('stream', `session timestamp update failed sessionId=${session.sessionId}`, {
              err: err instanceof Error ? err.message : String(err),
            });
          });
      }
    } catch (error) {
      this.log.error('stream', `chat stream failed agent=${dto.agentId}`, error);
      this.widgetLog.logException({ agentId: dto.agentId, error });
      if (!closed) {
        // IG2: Map service timeout errors to the friendly controller timeout message
        const isTimeout = error instanceof Error && error.message.includes('timed out');
        const message = isTimeout
          ? 'Stream timeout - response took too long'
          : error instanceof HttpException
            ? error.message
            : 'An unexpected error occurred';
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      }
    } finally {
      clearTimeout(timeout);
      if (!closed) {
        res.end();
      }
    }
  }
}
