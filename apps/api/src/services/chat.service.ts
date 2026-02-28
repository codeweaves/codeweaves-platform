import { Injectable, Logger, NotFoundException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgentsService } from './agents.service';
import type { SendMessageDto } from '@repo/validation';
import type { ChatSession } from '@prisma/client';
import { randomUUID } from 'crypto';

const N8N_TIMEOUT_MS = 10_000;
const MAX_LOG_RESPONSE_LENGTH = 500;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * Send a message to an agent and get an AI response via n8n webhook.
   */
  async sendMessage(dto: SendMessageDto) {
    const backendReceivedAt = new Date();

    // Resolve agent — must be active and not deleted
    const agent = await this.prisma.agent.findFirst({
      where: { id: dto.agentId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found or inactive');
    }

    // Resolve or create session
    let session: ChatSession;
    if (dto.sessionId) {
      const existing = await this.prisma.chatSession.findFirst({
        where: { sessionId: dto.sessionId, agentId: dto.agentId, status: 'ACTIVE' },
      });
      if (!existing) {
        throw new NotFoundException('Session not found or does not belong to this agent');
      }
      session = existing;
    } else {
      session = await this.prisma.chatSession.create({
        data: {
          agentId: dto.agentId,
          sessionId: randomUUID(),
          source: 'DEMO',
        },
      });
    }

    // Call n8n webhook BEFORE storing messages to avoid orphaned user messages on failure
    const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(dto.agentId);
    const n8nResponse = await this.callN8nWebhook(webhookUrl, dto.chatInput, session.sessionId);

    const backendRespondedAt = new Date();
    const responseLatencyMs = backendRespondedAt.getTime() - backendReceivedAt.getTime();

    const metadata = {
      backendReceivedAt: backendReceivedAt.toISOString(),
      n8nReceivedAt: n8nResponse.n8nReceivedAt ?? null,
      agentRepliedAt: n8nResponse.agentRepliedAt ?? null,
      backendRespondedAt: backendRespondedAt.toISOString(),
      responseLatencyMs,
    };

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
   * Call n8n webhook with chat input and session ID.
   * Handles timeout, network errors, and response parsing.
   */
  private async callN8nWebhook(
    webhookUrl: string,
    chatInput: string,
    sessionId: string,
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
      const data = await response.json();

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
