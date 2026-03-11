import { Injectable, Logger, NotFoundException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgentsService } from './agents.service';
import { HmacService } from '../common/security/hmac.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { TracerService } from '../common/tracer/tracer.service';
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
    private readonly hmacService: HmacService,
    private readonly cryptoService: CryptoService,
    private readonly tracerService: TracerService,
  ) {}

  private buildMetadata(
    backendReceivedAt: Date,
    backendRespondedAt: Date,
    n8nResponse: { n8nReceivedAt?: string; agentRepliedAt?: string },
  ) {
    return {
      backendReceivedAt: backendReceivedAt.toISOString(),
      n8nReceivedAt: n8nResponse.n8nReceivedAt ?? null,
      agentRepliedAt: n8nResponse.agentRepliedAt ?? null,
      backendRespondedAt: backendRespondedAt.toISOString(),
      responseLatencyMs: backendRespondedAt.getTime() - backendReceivedAt.getTime(),
    };
  }

  private async resolveAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, hmacEnabled: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found or inactive');
    }
    return agent;
  }

  private async resolveOrCreateSession(agentId: string, sessionId?: string): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findFirst({
        where: { sessionId, agentId, status: 'ACTIVE' },
      });
      if (!existing) {
        throw new NotFoundException('Session not found or does not belong to this agent');
      }
      return existing;
    }
    return this.prisma.chatSession.create({
      data: {
        agentId,
        sessionId: randomUUID(),
        source: 'DEMO',
      },
    });
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
   * Send a message to an agent and get an AI response via n8n webhook.
   */
  async sendMessage(dto: SendMessageDto) {
    const backendReceivedAt = new Date();

    const agent = await this.resolveAgent(dto.agentId);
    const session = await this.resolveOrCreateSession(dto.agentId, dto.sessionId);

    // Call n8n webhook BEFORE storing messages to avoid orphaned user messages on failure
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
  async streamMessage(dto: SendMessageDto) {
    const backendReceivedAt = new Date();

    const agent = await this.resolveAgent(dto.agentId);
    const session = await this.resolveOrCreateSession(dto.agentId, dto.sessionId);

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
