import { Controller, Post, Body, Res, Req, HttpException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Public } from '../../decorators/public.decorator';
import { ChatService } from '../../services/chat.service';
import { PrismaService } from '../../services/prisma.service';
import { AgentsService } from '../../services/agents.service';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { DirectChatService } from '../../modules/ai/direct-chat.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { sendMessageSchema, type SendMessageDto, resolveRoutingMode } from '@repo/validation';
import type { ChatMessageMetadata } from '../../services/chat-metadata.interface';

const STREAM_TIMEOUT_MS = 30_000;

@ApiTags('Public Chat')
@Public()
@Controller('public/chat')
export class PublicChatController {
  private readonly logger = new Logger(PublicChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly agentsService: AgentsService,
    private readonly n8nStreamingService: N8nStreamingService,
    private readonly messageRateLimitService: MessageRateLimitService,
    private readonly directChatService: DirectChatService,
    private readonly prisma: PrismaService,
  ) {}

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

    const deviceId = this.messageRateLimitService.getDeviceIdentifier(req);
    const rateLimitResult = await this.messageRateLimitService.checkMessageRateLimit(
      deviceId,
      dto.agentId,
    );

    if (!rateLimitResult.allowed) {
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

    let userMessageId: string | null = null;

    try {
      const agent = await this.chatService.resolveAgent(dto.agentId);
      const visitorIp = ChatService.extractVisitorIp(req);
      const session = await this.chatService.resolveOrCreateSession(agent.id, dto.sessionId, dto.source ?? 'WIDGET', visitorIp);
      const routingMode = resolveRoutingMode(agent.aiConfig);

      // IG1: Warn when HMAC is enabled — streaming responses cannot be HMAC-verified.
      // Direct mode has no webhook so HMAC is moot; only warn for n8n mode.
      if (agent.hmacEnabled && routingMode === 'n8n') {
        this.logger.warn(
          `Agent ${agent.id} has HMAC enabled but streaming responses cannot be verified. ` +
          `HMAC verification only applies to non-streaming (sendMessage) path.`,
        );
      }

      // P3: Use ChatService for DB operations instead of direct Prisma
      const userMessage = await this.chatService.saveUserMessage(session.id, dto.chatInput);
      userMessageId = userMessage.id;

      // ----- Routing fork ---------------------------------------------------
      // Both branches eventually write `metadata: ChatMessageMetadata` with the
      // same key names so analytics queries don't need to know which engine
      // served the reply. The direct branch populates the richer native fields
      // (traceId, cost, cachedInputTokens, ...) in addition.
      let fullResponse = '';
      let metadata: ChatMessageMetadata;

      if (routingMode === 'direct') {
        const fullAgent = await this.prisma.agent.findUniqueOrThrow({
          where: { id: agent.id },
        });

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
        };
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
        })}\n\n`);

        // Persist in the background. Errors log but don't leak to the user
        // (the response is already closed at this point). If the write fails,
        // the trace + pino logs still have the response so analytics isn't
        // blind.
        void this.chatService
          .saveAssistantMessage(session.id, fullResponse, metadata, assistantMessageId)
          .catch((err) => {
            this.logger.warn(
              `Assistant message persist failed (sessionId=${session.sessionId}, messageId=${assistantMessageId}): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        void this.chatService
          .updateSessionTimestamp(session.id)
          .catch((err) => {
            this.logger.warn(
              `Session timestamp update failed (sessionId=${session.sessionId}): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    } catch (error) {
      // D1: Clean up orphaned user message on stream failure
      if (userMessageId) {
        try {
          await this.chatService.deleteMessage(userMessageId);
        } catch (cleanupError) {
          this.logger.warn(`Failed to clean up orphaned user message ${userMessageId}: ${cleanupError}`);
        }
      }

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
