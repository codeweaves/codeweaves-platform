import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, Role } from '@prisma/client';
import type { CreateAgentDto, UpdateAgentDto, AgentListQuery } from '../models/agent.dto';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import { generatePublicId } from '../utils/public-id';
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
      data,
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
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }

  async update(id: string, dto: UpdateAgentDto, user: CurrentUserData) {
    await this.findById(id, user);

    try {
      const updated = await this.prisma.agent.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
        },
      });
      await this.agentLogger.logAgentUpdated(updated.id, { agent: updated, request: dto, userId: user.id });
      return updated;
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
    await this.findById(id, user);

    const deleted = await this.prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.agentLogger.logAgentDeleted(deleted.id, { agent: deleted, userId: user.id });
    return deleted;
  }
}
