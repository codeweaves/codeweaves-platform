import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';
import type { CreateOrganizationDto, UpdateOrganizationDto, OrganizationListQuery } from '../models/organization.dto';
import { generateSlug, generateUniqueSlug } from '../utils/slug';

const MAX_SLUG_RETRIES = 3;

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

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
        return await this.prisma.organization.create({
          data: {
            name: data.name,
            slug,
          },
        });
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
        throw error;
      }
    }

    throw new ConflictException('Unable to generate a unique slug. Please provide one manually.');
  }

  async findAll(query: OrganizationListQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }) {
    const { page, limit, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const orderBy: Prisma.OrganizationOrderByWithRelationInput =
      sortBy === 'usersCount'
        ? { users: { _count: sortOrder } }
        : { [sortBy]: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: {
          _count: {
            select: {
              users: true,
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
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async update(id: string, data: UpdateOrganizationDto) {
    if (data.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: data.slug, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException('Slug is already in use');
      }
    }

    try {
      return await this.prisma.organization.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.slug !== undefined && { slug: data.slug }),
        },
      });
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
