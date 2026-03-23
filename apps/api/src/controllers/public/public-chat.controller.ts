import { Controller, Post, Body, Res, Req, HttpException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { ChatService } from '../../services/chat.service';
import { AgentsService } from '../../services/agents.service';
import { N8nStreamingService } from '../../services/n8n-streaming.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { sendMessageSchema, type SendMessageDto } from '@repo/validation';

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

    return this.chatService.sendMessage(dto);
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
      const session = await this.chatService.resolveOrCreateSession(dto.agentId, dto.sessionId);
      const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(agent.id);

      // IG1: Warn when HMAC is enabled — streaming responses cannot be HMAC-verified
      if (agent.hmacEnabled) {
        this.logger.warn(
          `Agent ${agent.id} has HMAC enabled but streaming responses cannot be verified. ` +
          `HMAC verification only applies to non-streaming (sendMessage) path.`,
        );
      }

      // P3: Use ChatService for DB operations instead of direct Prisma
      const userMessage = await this.chatService.saveUserMessage(session.id, dto.chatInput);
      userMessageId = userMessage.id;

      let fullResponse = '';
      let n8nReceivedAt: number | null = null;
      let agentRepliedAt: number | null = null;
      let firstTokenTime: number | null = null;
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
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          chunkCount++;
          fullResponse += chunk.content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
        } else if (chunk.type === 'end') {
          agentRepliedAt = chunk.metadata?.timestamp ?? null;
        }
      }

      // P2: Send done event even when fullResponse is empty (e.g., n8n returns begin+end with no items)
      if (!closed) {
        const metadata = {
          backendReceivedAt: backendReceivedAt.toISOString(),
          n8nReceivedAt: n8nReceivedAt ? new Date(n8nReceivedAt).toISOString() : null,
          agentRepliedAt: agentRepliedAt ? new Date(agentRepliedAt).toISOString() : null,
          backendRespondedAt: new Date().toISOString(),
          responseLatencyMs: Date.now() - backendReceivedAt.getTime(),
          timeToFirstToken: firstTokenTime ? firstTokenTime - backendReceivedAt.getTime() : null,
          totalChunks: chunkCount,
          streamDurationMs: agentRepliedAt && n8nReceivedAt ? agentRepliedAt - n8nReceivedAt : null,
        };

        // Save assistant message AFTER stream completes (even if empty)
        const assistantMessage = await this.chatService.saveAssistantMessage(
          session.id,
          fullResponse,
          metadata,
        );
        await this.chatService.updateSessionTimestamp(session.id);

        // P1: Send assistant message ID (not user message ID) in done event
        res.write(`data: ${JSON.stringify({
          type: 'done',
          sessionId: session.sessionId,
          messageId: assistantMessage.id,
          metadata,
        })}\n\n`);
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
