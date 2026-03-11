import { Controller, Post, Body, Res, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { ChatService } from '../../services/chat.service';
import { MessageRateLimitService } from '../../services/message-rate-limit.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { sendMessageSchema, type SendMessageDto } from '@repo/validation';

const STREAM_TIMEOUT_MS = 30_000;
const CHUNK_DELAY_MS = 30;

@ApiTags('Public Chat')
@Public()
@Controller('public/chat')
export class PublicChatController {
  constructor(
    private readonly chatService: ChatService,
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

    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    const timeout = setTimeout(() => {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream timeout - response took too long' })}\n\n`);
        res.end();
        closed = true;
      }
    }, STREAM_TIMEOUT_MS);

    try {
      const result = await this.chatService.streamMessage(dto);

      for (const chunk of result.chunks) {
        if (closed) break;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
      }

      if (!closed) {
        res.write(`data: ${JSON.stringify({ type: 'done', sessionId: result.sessionId, messageId: result.messageId })}\n\n`);
      }
    } catch (error) {
      if (!closed) {
        const message = error instanceof HttpException
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
