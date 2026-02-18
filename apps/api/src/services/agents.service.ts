import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { Prisma, Role, Agent } from '@prisma/client';
import type { CreateAgentDto, UpdateAgentDto, AgentListQuery } from '../models/agent.dto';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { generatePublicId } from '../utils/public-id';
import { deduplicateDomains, isValidDomain } from '../utils/domain';
import { AgentLoggerService } from '../common/logger/agent.logger';
import { CryptoService } from '../common/crypto/crypto.service';

const MAX_PUBLIC_ID_RETRIES = 3;
const WEBHOOK_TEST_TIMEOUT = 10_000;

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateAgentDto, user: CurrentUserData) {
    const org = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    for (let attempt = 0; attempt < MAX_PUBLIC_ID_RETRIES; attempt++) {
      const publicId = generatePublicId();

      try {
        const agent = await this.prisma.agent.create({
          data: {
            publicId,
            name: dto.name,
            organizationId: dto.organizationId,
          },
        });
        await this.agentLogger.logAgentCreated(agent.id, { agent, request: dto, userId: user.id });
        return agent;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          Array.isArray(error.meta?.['target']) &&
          (error.meta['target'] as string[]).includes('publicId')
        ) {
          if (attempt === MAX_PUBLIC_ID_RETRIES - 1) {
            throw new ConflictException('Unable to generate a unique public ID. Please try again.');
          }
          continue;
        }
        await this.agentLogger.logAgentCreationException(
          dto.organizationId,
          error,
          { request: dto, userId: user.id },
        );
        throw error;
      }
    }

    throw new ConflictException('Unable to generate a unique public ID. Please try again.');
  }

  async findAll(
    query: AgentListQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
    user: CurrentUserData,
  ) {
    const { page, limit, search, sortBy, sortOrder, status, organizationId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      ...(user.role !== Role.CLIENT && organizationId && { organizationId }),
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
      ...(status && { status }),
    };

    const orderBy: Prisma.AgentOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { organization: { select: { id: true, name: true } } },
      }),
      this.prisma.agent.count({ where }),
    ]);

    return {
      data: data.map((agent) => this.stripSensitiveFields(agent, user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return this.stripSensitiveFields(agent, user);
  }

  async update(id: string, dto: UpdateAgentDto, user: CurrentUserData) {
    const existing = await this.findByIdRaw(id, user);

    // Validate, normalize, and deduplicate domains before saving
    if (dto.allowedDomains !== undefined) {
      const invalidDomains = dto.allowedDomains.filter((d) => !isValidDomain(d));
      if (invalidDomains.length > 0) {
        throw new BadRequestException(
          `Invalid domain(s): ${invalidDomains.join(', ')}`,
        );
      }
    }
    const normalizedDomains =
      dto.allowedDomains !== undefined
        ? deduplicateDomains(dto.allowedDomains)
        : undefined;

    try {
      const updated = await this.prisma.agent.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(normalizedDomains !== undefined && { allowedDomains: normalizedDomains }),
        },
        include: { organization: { select: { id: true, name: true } } },
      });

      // Audit: domain changes
      if (normalizedDomains !== undefined) {
        await this.agentLogger.logDomainsUpdated(updated.id, {
          oldDomains: existing.allowedDomains,
          newDomains: normalizedDomains,
          userId: user.id,
        });
      }

      // Audit: status changes
      if (dto.status !== undefined && dto.status !== existing.status) {
        await this.agentLogger.logStatusChanged(updated.id, {
          oldStatus: existing.status,
          newStatus: dto.status,
        });
      }

      await this.agentLogger.logAgentUpdated(updated.id, { agent: updated, request: dto, userId: user.id });
      return this.stripSensitiveFields(updated, user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Agent not found');
      }
      await this.agentLogger.logAgentUpdateException(id, error, { request: dto, userId: user.id });
      throw error;
    }
  }

  async softDelete(id: string, user: CurrentUserData) {
    await this.findByIdRaw(id, user);

    const deleted = await this.prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.agentLogger.logAgentDeleted(deleted.id, { agent: deleted, userId: user.id });
    return deleted;
  }

  /**
   * Check if an agent is active. For future use by widget/chat API.
   */
  async checkAgentActive(agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { status: true },
    });
    return agent?.status === 'ACTIVE';
  }

  // ==========================================
  // Webhook Management
  // ==========================================

  async setWebhookUrl(agentId: string, webhookUrl: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    // Enforce HTTPS in production
    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      !webhookUrl.startsWith('https://')
    ) {
      throw new BadRequestException('Webhook URL must use HTTPS in production');
    }

    const encrypted = this.cryptoService.encrypt(webhookUrl);

    const existing = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    await this.prisma.agentSecret.upsert({
      where: { agentId },
      create: { agentId, webhookUrl: encrypted },
      update: { webhookUrl: encrypted },
    });

    if (existing) {
      await this.agentLogger.logSecretUpdated(agentId, user.id);
    } else {
      await this.agentLogger.logSecretCreated(agentId, user.id);
    }
    await this.agentLogger.logWebhookUpdated(agentId, user.id);

    return { message: 'Webhook URL updated' };
  }

  async getWebhookUrl(agentId: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    const secret = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    if (secret?.webhookUrl) {
      return { webhookUrl: this.cryptoService.decrypt(secret.webhookUrl) };
    }

    const fallback = this.configService.get<string>('DEFAULT_WEBHOOK_URL');
    if (fallback) {
      return { webhookUrl: fallback, isFallback: true };
    }

    return { webhookUrl: null };
  }

  /**
   * Get the effective webhook URL for internal use (resolves fallback).
   */
  async getEffectiveWebhookUrl(agentId: string): Promise<string> {
    const secret = await this.prisma.agentSecret.findUnique({
      where: { agentId },
    });

    if (secret?.webhookUrl) {
      return this.cryptoService.decrypt(secret.webhookUrl);
    }

    const fallback = this.configService.get<string>('DEFAULT_WEBHOOK_URL');
    if (!fallback) {
      throw new NotFoundException('No webhook URL configured for this agent');
    }
    return fallback;
  }

  async testWebhook(agentId: string, user: CurrentUserData) {
    await this.findByIdRaw(agentId, user);

    let url: string;
    try {
      url = await this.getEffectiveWebhookUrl(agentId);
    } catch {
      throw new NotFoundException('No webhook URL configured for this agent');
    }

    const payload = {
      type: 'test',
      agentId,
      timestamp: new Date().toISOString(),
    };

    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_TEST_TIMEOUT),
      });

      return {
        success: response.ok,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.warn(
        `Webhook test failed for agent ${agentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        success: false,
        statusCode: null,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================
  // Internal helpers
  // ==========================================

  /**
   * Internal: fetch agent without stripping sensitive fields.
   * Used by update/softDelete which need the full agent record.
   */
  private async findByIdRaw(id: string, user: CurrentUserData): Promise<Agent> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }

  /**
   * Strip sensitive fields from agent response for CLIENT users.
   * CLIENT users should not see allowedDomains.
   */
  private stripSensitiveFields(
    agent: Agent,
    user: CurrentUserData,
  ): Omit<Agent, 'allowedDomains'> | Agent {
    if (user.role === Role.CLIENT) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { allowedDomains, ...safe } = agent;
      return safe;
    }
    return agent;
  }
}
