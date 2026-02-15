import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { User, Role, InvitationStatus, Prisma } from '@prisma/client';
import type { UpdateUserProfileDto, UserProfileResponse } from '../models/user.dto';
import { buildTenantFilter, TenantFilterUser } from '../utils/tenant-filter';

const USER_WITH_ORG_SELECT = {
  include: {
    organization: {
      select: {
        id: true,
        name: true,
        slug: true,
      },
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { auth0Id, deletedAt: null },
      include: { organization: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createFromAuth0(data: {
    auth0Id: string;
    email: string;
    name?: string;
    role: Role;
    organizationId?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: data.organizationId
        ? {
            auth0Id: data.auth0Id,
            email: data.email,
            name: data.name,
            role: data.role,
            organizationId: data.organizationId,
          }
        : {
            auth0Id: data.auth0Id,
            email: data.email,
            name: data.name,
            role: data.role,
          },
    });
  }

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      ...USER_WITH_ORG_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toProfileResponse(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    const sanitizedName = dto.name ? this.sanitizeName(dto.name) : undefined;

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: sanitizedName,
        },
        ...USER_WITH_ORG_SELECT,
      });

      return this.toProfileResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async findByOrganization(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllForTenant(user: TenantFilterUser): Promise<User[]> {
    const tenantFilter = buildTenantFilter(user);
    return this.prisma.user.findMany({
      where: { ...tenantFilter },
      orderBy: { createdAt: 'desc' },
    });
  }

  async syncOrCreateUser(jwtUser: { auth0Id: string; email: string }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { auth0Id: jwtUser.auth0Id },
      include: { organization: true },
    });

    if (existingUser) {
      if (existingUser.deletedAt) {
        throw new UnauthorizedException('Account has been deactivated');
      }
      return existingUser;
    }

    return this.createFromInvitation(jwtUser);
  }

  private toProfileResponse(user: {
    id: string;
    email: string;
    name: string | null;
    role: Role;
    organization: { id: string; name: string; slug: string } | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserProfileResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organization: user.organization,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private sanitizeName(name: string): string {
    return name.replace(/<[^>]*>?/g, '').trim();
  }

  private async createFromInvitation(jwtUser: {
    auth0Id: string;
    email: string;
  }) {
    const email = jwtUser.email.toLowerCase();

    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      throw new UnauthorizedException(
        'No valid invitation found. Please contact your administrator.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            auth0Id: jwtUser.auth0Id,
            email,
            role: invitation.role,
            organizationId: invitation.organizationId,
          },
          include: { organization: true },
        });

        await tx.userInvitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.ACCEPTED },
        });

        return newUser;
      });
    } catch (error) {
      // Handle race condition: concurrent first-login requests for same user
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raceUser = await this.prisma.user.findUnique({
          where: { auth0Id: jwtUser.auth0Id },
          include: { organization: true },
        });
        if (raceUser) return raceUser;
      }
      throw error;
    }
  }
}
