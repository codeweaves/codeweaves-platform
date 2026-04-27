import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, Role } from '@prisma/client';
import type { CreateOrganizationDto, UpdateOrganizationDto, OrganizationListQuery } from '../models/organization.dto';
import { generateSlug, generateUniqueSlug } from '../utils/slug';
import { OrganizationLoggerService } from '../common/logger/organization.logger';
import type { CurrentUserData } from '../decorators/current-user.decorator';

const MAX_SLUG_RETRIES = 3;

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private readonly orgLogger: OrganizationLoggerService,
  ) {}

  async create(data: CreateOrganizationDto) {
    let baseSlug: string;
    try {
      baseSlug = data.slug ?? generateSlug(data.name);
    } catch {
      throw new BadRequestException(
        'Name must contain at least one alphanumeric character to generate a slug',
      );
    }

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = attempt === 0
        ? await this.resolveUniqueSlug(baseSlug)
        : generateUniqueSlug(this.trimSlugBase(baseSlug));

      try {
        const org = await this.prisma.organization.create({
          data: {
            name: data.name,
            slug,
          },
        });
        await this.orgLogger.logOrganizationCreated(org.id, { org, request: data });
        return org;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          if (attempt === MAX_SLUG_RETRIES - 1) {
            throw new ConflictException('Unable to generate a unique slug. Please provide one manually.');
          }
          continue;
        }
        await this.orgLogger.logOrganizationCreationException(
          data.name ?? 'unknown',
          error,
          { request: data },
        );
        throw error;
      }
    }

    throw new ConflictException('Unable to generate a unique slug. Please provide one manually.');
  }

  async findAll(query: OrganizationListQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }) {
    const { page, limit, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.OrganizationOrderByWithRelationInput =
      sortBy === 'usersCount'
        ? { users: { _count: sortOrder } }
        : sortBy === 'agentsCount'
          ? { agents: { _count: sortOrder } }
          : { [sortBy]: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: {
          _count: {
            select: {
              users: true,
              agents: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.organization.count({ where }),
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

  async findById(id: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            users: true,
            agents: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  /**
   * Counts the active agents and members in an organization. Used by the
   * frontend to populate the delete-confirmation modal ("This org has N
   * active agents and M members. Type the org name to confirm.").
   * Permission checks live alongside the corresponding `delete()` call.
   */
  async getDeletePreview(id: string, user: CurrentUserData) {
    this.assertCanDelete(id, user);

    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: {
          select: {
            agents: { where: { deletedAt: null } },
            users: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      activeAgentsCount: org._count.agents,
      membersCount: org._count.users,
    };
  }

  /**
   * Soft-delete an organization in a single transaction:
   *   1. Mark the org `deletedAt`.
   *   2. Cascade `deletedAt` to all its agents — they stop accepting widget
   *      traffic immediately because the public agent lookup filters
   *      `deletedAt: null` AND `status: 'ACTIVE'`.
   *   3. Cascade `deletedAt` to all its members — `findByAuth0Id` also filters
   *      `deletedAt: null`, so on the next 60s cache miss in UserSyncGuard
   *      they're treated as unauthenticated and get bounced to login.
   *
   * Permission: SUPER_ADMIN can delete any org. ADMIN can delete only their
   * own. CLIENT users never reach here (controller-level role gate).
   */
  async delete(id: string, user: CurrentUserData) {
    this.assertCanDelete(id, user);

    const existing = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });

    if (!existing) {
      throw new NotFoundException('Organization not found');
    }

    const now = new Date();

    const [, agentsResult, usersResult] = await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id },
        data: { deletedAt: now },
      }),
      this.prisma.agent.updateMany({
        where: { organizationId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.user.updateMany({
        where: { organizationId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);

    await this.orgLogger.logOrganizationDeleted(id, {
      org: existing,
      userId: user.id,
      cascadedAgents: agentsResult.count,
      cascadedUsers: usersResult.count,
    });

    return {
      id: existing.id,
      name: existing.name,
      cascadedAgents: agentsResult.count,
      cascadedUsers: usersResult.count,
    };
  }

  /**
   * Throws ForbiddenException unless the user is allowed to delete this org.
   * SUPER_ADMIN only. ADMIN/CLIENT users are also blocked at the controller
   * level via @Roles; this service-side check is defense in depth.
   */
  private assertCanDelete(_orgId: string, user: CurrentUserData): void {
    if (user.role === Role.SUPER_ADMIN) return;
    throw new ForbiddenException('You do not have permission to delete this organization');
  }

  async update(id: string, data: UpdateOrganizationDto) {
    if (data.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: data.slug, NOT: { id }, deletedAt: null },
      });
      if (existing) {
        throw new ConflictException('Slug is already in use');
      }
    }

    try {
      const org = await this.prisma.organization.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.slug !== undefined && { slug: data.slug }),
        },
      });
      await this.orgLogger.logOrganizationUpdated(org.id, { org, request: data });
      return org;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Organization not found');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Slug is already in use');
      }
      await this.orgLogger.logOrganizationUpdateException(id, error, { request: data });
      throw error;
    }
  }

  private async resolveUniqueSlug(baseSlug: string): Promise<string> {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: baseSlug },
    });

    if (!existing) {
      return baseSlug;
    }

    return generateUniqueSlug(this.trimSlugBase(baseSlug));
  }

  private trimSlugBase(slug: string): string {
    const maxBaseLength = 100 - 7; // 100 max slug - "-" - 6-char suffix
    if (slug.length <= maxBaseLength) return slug;
    return slug.slice(0, maxBaseLength).replace(/-$/, '');
  }
}
