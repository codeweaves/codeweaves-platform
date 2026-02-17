import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, Role, Agent } from '@prisma/client';
import type { CreateAgentDto, UpdateAgentDto, AgentListQuery } from '../models/agent.dto';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { generatePublicId } from '../utils/public-id';
import { deduplicateDomains, isValidDomain } from '../utils/domain';
import { AgentLoggerService } from '../common/logger/agent.logger';

const MAX_PUBLIC_ID_RETRIES = 3;

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
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
    const agent = await this.findByIdRaw(id, user);
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
