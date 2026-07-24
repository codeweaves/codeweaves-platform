import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type WhatsappChannel } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { TracerService } from '../../common/tracer/tracer.service';
import { CurrentUserData } from '../../decorators/current-user.decorator';
import { AgentsService } from '../../services/agents.service';
import { PrismaService } from '../../services/prisma.service';

import {
  ConnectWhatsappChannelDto,
  UpdateWhatsappChannelDto,
  WhatsappChannelView,
} from './whatsapp-channel.dto';

/**
 * Dashboard-facing CRUD for an agent's WhatsApp channel. Authorization is
 * delegated to AgentsService.findById (org-scoping + role checks) so a user can
 * only touch channels for agents they own.
 *
 * The Graph API access token is encrypted at rest with CryptoService (AES-256-GCM),
 * the same mechanism AgentSecret uses for webhook URLs. The plaintext token never
 * leaves this service except into CryptoService — views never include it.
 */
@Injectable()
export class WhatsappChannelService {
  private readonly logger = new Logger(WhatsappChannelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly agentsService: AgentsService,
    private readonly tracer: TracerService,
  ) {}

  async getByAgent(
    agentId: string,
    user: CurrentUserData,
  ): Promise<WhatsappChannelView | null> {
    // Throws NotFound/Forbidden if the user can't access this agent.
    await this.agentsService.findById(agentId, user);

    const channel = await this.prisma.whatsappChannel.findUnique({
      where: { agentId },
    });
    return channel ? this.toView(channel) : null;
  }

  async connect(
    agentId: string,
    dto: ConnectWhatsappChannelDto,
    user: CurrentUserData,
  ): Promise<WhatsappChannelView> {
    await this.agentsService.findById(agentId, user);

    const accessTokenEnc = this.crypto.encrypt(dto.accessToken);
    const tokenExpiresAt = dto.tokenExpiresAt
      ? new Date(dto.tokenExpiresAt)
      : null;

    const data = {
      wabaId: dto.wabaId,
      phoneNumberId: dto.phoneNumberId,
      displayPhone: dto.displayPhone,
      verifiedName: dto.verifiedName ?? null,
      accessTokenEnc,
      tokenExpiresAt,
      status: 'CONNECTED' as const,
      ...(dto.voiceReplyEnabled !== undefined
        ? { voiceReplyEnabled: dto.voiceReplyEnabled }
        : {}),
    };

    try {
      const channel = await this.prisma.whatsappChannel.upsert({
        where: { agentId },
        create: { agentId, ...data },
        update: data,
      });
      this.logger.log(
        `WhatsApp channel connected for agent ${agentId} (phoneNumberId=${dto.phoneNumberId})`,
      );
      // Accountability: connecting a channel stores an encrypted API token and
      // binds a phone number — a security-relevant action. Never log the token.
      await this.tracer.logAuditEvent(
        agentId,
        'WHATSAPP_CHANNEL_CONNECTED',
        {
          response: {
            wabaId: dto.wabaId,
            phoneNumberId: dto.phoneNumberId,
            displayPhone: dto.displayPhone,
            userId: user.id,
          },
        },
        { agentId },
      );
      return this.toView(channel);
    } catch (err) {
      // phoneNumberId is globally unique — a collision means another agent
      // already owns this number.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This WhatsApp number is already connected to another agent.',
        );
      }
      throw err;
    }
  }

  async disconnect(agentId: string, user: CurrentUserData): Promise<void> {
    await this.agentsService.findById(agentId, user);

    // deleteMany (not delete) so disconnecting a never-connected agent is a no-op
    // rather than a P2025 "record not found" error.
    await this.prisma.whatsappChannel.deleteMany({ where: { agentId } });
    this.logger.log(`WhatsApp channel disconnected for agent ${agentId}`);
    await this.tracer.logAuditEvent(
      agentId,
      'WHATSAPP_CHANNEL_DISCONNECTED',
      { response: { userId: user.id } },
      { agentId },
    );
  }

  /** Toggle whether the agent replies to voice notes with a voice note (TTS). */
  async setVoiceReply(
    agentId: string,
    dto: UpdateWhatsappChannelDto,
    user: CurrentUserData,
  ): Promise<WhatsappChannelView> {
    await this.agentsService.findById(agentId, user);

    try {
      const channel = await this.prisma.whatsappChannel.update({
        where: { agentId },
        data: { voiceReplyEnabled: dto.voiceReplyEnabled },
      });
      await this.tracer.logAuditEvent(
        agentId,
        'WHATSAPP_CHANNEL_UPDATED',
        { response: { voiceReplyEnabled: dto.voiceReplyEnabled, userId: user.id } },
        { agentId },
      );
      return this.toView(channel);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(
          'No WhatsApp channel connected for this agent.',
        );
      }
      throw err;
    }
  }

  /** Strip the encrypted token + map to the wire shape. */
  private toView(channel: WhatsappChannel): WhatsappChannelView {
    return {
      id: channel.id,
      agentId: channel.agentId,
      wabaId: channel.wabaId,
      phoneNumberId: channel.phoneNumberId,
      displayPhone: channel.displayPhone,
      verifiedName: channel.verifiedName,
      status: channel.status,
      voiceReplyEnabled: channel.voiceReplyEnabled,
      tokenExpiresAt: channel.tokenExpiresAt?.toISOString() ?? null,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    };
  }
}
