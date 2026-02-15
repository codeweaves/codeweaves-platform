import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma } from '@prisma/client';
import type { CreateOrganizationDto, UpdateOrganizationDto } from '../models/organization.dto';
import { generateSlug, generateUniqueSlug } from '../utils/slug';

const MAX_SLUG_RETRIES = 3;

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOrganizationDto) {
    const baseSlug = data.slug ?? generateSlug(data.name);

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = attempt === 0
        ? await this.resolveUniqueSlug(baseSlug)
        : generateUniqueSlug(baseSlug);

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

  async findAll() {
    return this.prisma.organization.findMany({
      include: {
        _count: {
          select: {
            users: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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

    return generateUniqueSlug(baseSlug);
  }
}
