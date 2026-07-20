import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { Public } from '../../decorators/public.decorator';
import type { DirectChatStreamChunk } from '../../modules/ai';
import {
  AiTraceService,
  DirectChatService,
  SummarizationService,
} from '../../modules/ai';
import { ChatService } from '../../services/chat.service';
import { PrismaService } from '../../services/prisma.service';

import { devTestChatHtml } from './dev-test-chat.page';

/**
 * DEV-ONLY: HTTP surface for exercising the AI orchestration layer end-to-end
 * without any frontend integration. Think of this as the "localhost:3001
 * Swagger for the AI brain".
 *
 * Endpoints:
 *   GET  /dev/ai/test-chat               — serves the single-page UI
 *   GET  /dev/ai/agents                  — list agents for the UI dropdown
 *   POST /dev/ai/test-chat/stream        — SSE streaming chat (main demo)
 *   POST /dev/ai/test-chat               — non-streaming chat (JSON)
 *   GET  /dev/ai/traces/:traceId         — fetch a stored trace by ID
 *   GET  /dev/ai/sessions/:sessionId     — fetch session + messages
 *
 * FAIL-CLOSED: every endpoint 404s unless `ENABLE_DEV_ROUTES=true` is set
 * (do this ONLY in your local `.env`). Marked `@Public()` so you don't need to
 * log in to use the dev tool locally — the opt-in flag, not auth, is what keeps
 * it off in prod/CI, and it defaults to off so it can't be exposed by mistake.
 */
@Public()
@Controller('dev/ai')
export class DevAiController {
  private readonly logger = new Logger(DevAiController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly directChat: DirectChatService,
    private readonly traceService: AiTraceService,
    private readonly summarization: SummarizationService,
  ) {}

  /**
   * Fire-and-forget background task: if this session has enough exchanges
   * and no title yet, generate one. Never awaits — the user's response has
   * already been delivered by the time this runs.
   *
   * Guardrails:
   *   - Only runs once per session (skips if title already set)
   *   - Requires at least 2 assistant messages (enough signal for a topic)
   *   - Any error is logged but silenced — title generation is cosmetic
   */
  private maybeGenerateTitle(
    sessionDbId: string,
    agentId: string,
    organizationId: string,
  ): void {
    void (async () => {
      try {
        const session = await this.prisma.chatSession.findUnique({
          where: { id: sessionDbId },
          select: { title: true },
        });
        if (!session || session.title) return;

        const assistantCount = await this.prisma.chatMessage.count({
          where: { chatSessionId: sessionDbId, role: 'ASSISTANT' },
        });
        if (assistantCount < 2) return;

        const messages = await this.prisma.chatMessage.findMany({
          where: { chatSessionId: sessionDbId },
          orderBy: { createdAt: 'asc' },
          take: 4,
          select: { role: true, content: true },
        });

        const title = await this.summarization.generateTitle({
          messages: messages.map((m) => ({
            role: m.role === 'USER' ? 'user' : 'assistant',
            content: m.content,
          })),
          organizationId,
          agentId,
          sessionId: sessionDbId,
        });

        await this.prisma.chatSession.update({
          where: { id: sessionDbId },
          data: { title },
        });
        this.logger.debug(`Generated title for session ${sessionDbId}: "${title}"`);
      } catch (err) {
        this.logger.warn(
          `Title generation failed for session ${sessionDbId}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    })();
  }

  @Get('test-chat')
  serveTestPage(@Res() res: Response): void {
    this.assertDevRoutesEnabled();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(devTestChatHtml);
  }

  @Get('agents')
  async listAgents(
    @Query('includeInactive') includeInactive?: string,
  ): Promise<
    Array<{
      id: string;
      publicId: string;
      name: string;
      status: string;
      routingMode: string;
      modelId: string | null;
      organization: { id: string; name: string };
    }>
  > {
    this.assertDevRoutesEnabled();
    const agents = await this.prisma.agent.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive === 'true' ? {} : { status: 'ACTIVE' }),
      },
      select: {
        id: true,
        publicId: true,
        name: true,
        status: true,
        aiConfig: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    return agents.map((a) => {
      const cfg = (a.aiConfig as Record<string, unknown> | null) ?? {};
      return {
        id: a.id,
        publicId: a.publicId,
        name: a.name,
        status: a.status,
        routingMode:
          typeof cfg.routingMode === 'string' ? cfg.routingMode : 'n8n',
        modelId: typeof cfg.modelId === 'string' ? cfg.modelId : null,
        organization: a.organization,
      };
    });
  }

  @Post('test-chat/stream')
  async streamChat(
    @Body() dto: TestChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    this.assertDevRoutesEnabled();
    this.validateRequest(dto);

    // resolveAgent does permission + existence checks but returns a stripped
    // projection for security; we need the full Agent (with aiConfig) for
    // the orchestrator, so do a follow-up findUnique after the check passes.
    const { id: agentId } = await this.chatService.resolveAgent(dto.agentId);
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
    });

    const session = await this.chatService.resolveOrCreateSession(
      agent.id,
      dto.sessionId,
      'DEMO',
    );

    // Fire-and-forget: persisting the user message for audit should NOT block
    // the LLM call. If the write fails we log it; the chat still works, and
    // the UI already has the message on screen. Saves ~150-400ms per turn.
    void this.chatService.saveUserMessage(session.id, dto.message).catch((err) => {
      this.logger.warn(
        `saveUserMessage failed (session=${session.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // SSE headers. `X-Accel-Buffering: no` defeats any reverse proxy buffering
    // (critical for streaming over nginx / Cloudflare). Keep-alive ensures the
    // connection stays open across token gaps.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    res.on('close', onClose);

    // Let the client know the session ID (they need it for subsequent messages).
    this.writeSse(res, 'session', { sessionId: session.sessionId });

    let finalText = '';
    let assistantMessageId: string | null = null;

    try {
      const stream = this.directChat.stream({
        agent,
        chatSessionId: session.id,
        externalSessionId: session.sessionId,
        newUserMessage: dto.message,
        recentHistory: dto.recentHistory,
        abortSignal: abortController.signal,
        feature: 'chat-stream',
      });

      for await (const chunk of stream) {
        this.emitChunk(res, chunk);
        if (chunk.type === 'text-delta') {
          finalText += chunk.content;
        } else if (chunk.type === 'finish') {
          // Fire-and-forget the assistant message persist + session bump. The
          // user already has the complete response in their UI — delaying the
          // `done` event by a Supabase round-trip (~150-400ms) is pure waste.
          // We do need the message ID for the `done` payload, so we create it
          // via an awaited Prisma call but don't await the session update.
          //
          // Trade-off accepted: if the DB is momentarily down, this turn's
          // assistant message isn't persisted. The trace + pino logs still
          // have the response, so analytics isn't blind.
          const persistStart = performance.now();
          const assistantMsg = await this.prisma.chatMessage.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: chunk.result.text,
              metadata: {
                streamingMode: 'direct',
                traceId: chunk.result.traceId,
                model: chunk.result.model,
                cost: chunk.result.cost,
                inputTokens: chunk.result.usage.inputTokens,
                outputTokens: chunk.result.usage.outputTokens,
                totalTokens: chunk.result.usage.totalTokens,
                latencyMs: chunk.result.latencyMs,
                ttftMs: chunk.result.ttftMs,
                finishReason: chunk.result.finishReason,
                historyCount: chunk.result.historyCount,
                historyTruncated: chunk.result.historyTruncated,
              },
            },
          });
          assistantMessageId = assistantMsg.id;
          this.logger.debug(
            `Assistant message persisted in ${Math.round(performance.now() - persistStart)}ms`,
          );

          // Session timestamp + title generation are fully background work.
          void this.chatService
            .updateSessionTimestamp(session.id)
            .catch((err) =>
              this.logger.warn(
                `updateSessionTimestamp failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          this.maybeGenerateTitle(session.id, agent.id, agent.organizationId);

          // Emit a final `done` event that the widget/dev page can use to
          // close the stream cleanly.
          this.writeSse(res, 'done', {
            messageId: assistantMsg.id,
            sessionId: session.sessionId,
            traceId: chunk.result.traceId,
          });
        }
      }
    } catch (err) {
      this.logger.error('Dev test chat stream failed', err);
      this.writeSse(res, 'error', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      res.off('close', onClose);
      res.end();
    }

    // If we somehow streamed tokens but never got a finish event (edge case:
    // stream aborted mid-flight), clean up the partial assistant message.
    if (!assistantMessageId && finalText.length > 0) {
      this.logger.warn(
        `Stream aborted with ${finalText.length} partial chars; not persisting`,
      );
    }
  }

  @Post('test-chat')
  @HttpCode(200)
  async sendChat(@Body() dto: TestChatRequest) {
    this.assertDevRoutesEnabled();
    this.validateRequest(dto);

    const { id: agentId } = await this.chatService.resolveAgent(dto.agentId);
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
    });
    const session = await this.chatService.resolveOrCreateSession(
      agent.id,
      dto.sessionId,
      'DEMO',
    );

    void this.chatService.saveUserMessage(session.id, dto.message).catch((err) => {
      this.logger.warn(
        `saveUserMessage failed (session=${session.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const result = await this.directChat.send({
      agent,
      chatSessionId: session.id,
      externalSessionId: session.sessionId,
      newUserMessage: dto.message,
      recentHistory: dto.recentHistory,
      feature: 'chat',
    });

    const assistantMsg = await this.prisma.chatMessage.create({
      data: {
        chatSessionId: session.id,
        role: 'ASSISTANT',
        content: result.text,
        metadata: {
          streamingMode: 'direct-sync',
          traceId: result.traceId,
          model: result.model,
          cost: result.cost,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
      },
    });
    void this.chatService
      .updateSessionTimestamp(session.id)
      .catch((err) =>
        this.logger.warn(
          `updateSessionTimestamp failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.maybeGenerateTitle(session.id, agent.id, agent.organizationId);

    return {
      sessionId: session.sessionId,
      messageId: assistantMsg.id,
      traceId: result.traceId,
      response: result.text,
      model: result.model,
      usage: result.usage,
      cost: result.cost,
      latencyMs: result.latencyMs,
    };
  }

  @Get('traces/:traceId')
  async getTrace(@Param('traceId') traceId: string) {
    this.assertDevRoutesEnabled();
    const trace = await this.traceService.findByTraceId(traceId);
    if (!trace) {
      throw new NotFoundException('Trace not found');
    }
    return trace;
  }

  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    this.assertDevRoutesEnabled();
    const session = await this.prisma.chatSession.findUnique({
      where: { sessionId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        agent: { select: { id: true, name: true, publicId: true } },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Fail-closed gate for this dev-only surface. The routes are OFF everywhere
   * unless `ENABLE_DEV_ROUTES=true` is explicitly set — do this ONLY in your
   * local `.env`. Anything else (unset, empty, "false") → 404.
   *
   * This replaces the previous `NODE_ENV === 'production'` check, which was
   * fail-OPEN: any environment where NODE_ENV wasn't exactly "production"
   * (unset, "prod", a mis-set value, staging) exposed every route — including
   * cross-org reads of sessions/messages/traces. Opt-IN is safe by default:
   * you can't accidentally forget to opt out.
   */
  private assertDevRoutesEnabled(): void {
    if (this.config.get<string>('ENABLE_DEV_ROUTES') !== 'true') {
      throw new NotFoundException();
    }
  }

  private validateRequest(dto: TestChatRequest): void {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Request body required');
    }
    if (!dto.agentId || typeof dto.agentId !== 'string') {
      throw new BadRequestException('agentId required');
    }
    if (!dto.message || typeof dto.message !== 'string') {
      throw new BadRequestException('message required');
    }
    if (dto.message.length > 10_000) {
      throw new BadRequestException('message too long (max 10000 chars)');
    }
  }

  /**
   * Translate our internal DirectChatStreamChunk into SSE events the UI
   * understands. Keeps the wire protocol stable even if internal types
   * shift.
   */
  private emitChunk(res: Response, chunk: DirectChatStreamChunk): void {
    switch (chunk.type) {
      case 'trace':
        this.writeSse(res, 'trace', {
          step: chunk.step,
          durationMs: chunk.durationMs,
          data: chunk.data ?? {},
        });
        break;
      case 'text-delta':
        this.writeSse(res, 'chunk', { content: chunk.content });
        break;
      case 'finish':
        // `done` is emitted separately by the caller once the assistant message
        // is persisted — keeps messageId available in the done event.
        break;
      case 'error':
        this.writeSse(res, 'error', {
          message: chunk.error,
          code: chunk.code,
        });
        break;
    }
  }

  /**
   * Write a named SSE event. We use named events (`event: X\n`) so the client
   * can route each type to a different handler via addEventListener. The data
   * field is a single JSON line per spec (no newlines inside the JSON).
   */
  private writeSse(
    res: Response,
    eventName: string,
    data: Record<string, unknown>,
  ): void {
    const payload = JSON.stringify(data);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${payload}\n\n`);
  }
}

interface TestChatRequest {
  agentId: string;
  message: string;
  sessionId?: string;
  /**
   * Optional client-supplied recent history (oldest → newest). When present,
   * the orchestrator skips its DB history lookup — saves one Supabase RTT.
   * The client must NOT include the message being sent now — that's `message`.
   */
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}
