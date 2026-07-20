import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { User, Role, InvitationStatus, Prisma } from '@prisma/client';
import type { UpdateUserProfileDto, UserProfileResponse } from '../models/user.dto';
import { buildTenantFilter, TenantFilterUser } from '../utils/tenant-filter';
import { UserLoggerService } from '../common/logger/user.logger';
import { AppLogger } from '../common/logger/app-logger';
import { ClerkManagementService } from './clerk-management.service';

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
  private readonly log = new AppLogger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly userLogger: UserLoggerService,
    private readonly clerkManagement: ClerkManagementService,
  ) {}

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { clerkId, deletedAt: null },
      include: { organization: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createFromClerk(data: {
    clerkId: string;
    email: string;
    name?: string;
    role: Role;
    organizationId?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: data.organizationId
        ? {
            clerkId: data.clerkId,
            email: data.email,
            name: data.name,
            role: data.role,
            organizationId: data.organizationId,
          }
        : {
            clerkId: data.clerkId,
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

      await this.userLogger.logUserProfileUpdated(userId, { response: user, request: dto });
      this.log.info('updateProfile', 'user profile updated', { userId });
      return this.toProfileResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User not found');
      }
      this.log.error('updateProfile', 'user profile update failed', error, { userId });
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

  async syncOrCreateUser(jwtUser: { clerkId: string; email: string }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { clerkId: jwtUser.clerkId },
      include: { organization: true },
    });

    if (existingUser) {
      if (existingUser.deletedAt) {
        throw new UnauthorizedException('Account has been deactivated');
      }
      return existingUser;
    }

    // No user linked to this Clerk account yet — create one from a pending
    // invitation (sign-up is invitation-only).
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
    clerkId: string;
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

    // Object-level authz: the invitation grants a role + org, and it is matched
    // ONLY by email. Before we hand those out, confirm this Clerk account
    // actually owns AND has verified this email — otherwise a token bearing an
    // unverified email claim could claim someone else's invite (and its role,
    // up to ADMIN). Fail CLOSED: any error (Clerk unreachable, unverified) =
    // no provisioning. First-login only, so this Clerk call is not on the hot path.
    let emailVerified = false;
    try {
      emailVerified = await this.clerkManagement.isEmailVerified(
        jwtUser.clerkId,
        email,
      );
    } catch (error) {
      this.log.error(
        'createFromInvitation',
        'Clerk email-verification check failed; refusing to provision',
        error,
        { clerkId: jwtUser.clerkId },
      );
      throw new UnauthorizedException(
        'Could not verify your email right now. Please try again.',
      );
    }
    if (!emailVerified) {
      this.log.warn(
        'createFromInvitation',
        'invitation acceptance blocked: email not verified for this account',
        { clerkId: jwtUser.clerkId, invitationId: invitation.id },
      );
      throw new UnauthorizedException(
        'Your email must be verified before accepting an invitation.',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            clerkId: jwtUser.clerkId,
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

        await this.userLogger.logUserCreatedFromInvitation(newUser.id, {
          response: newUser,
          invitationId: invitation.id,
        });
        this.log.info('createFromInvitation', 'user created from invitation', {
          userId: newUser.id,
          invitationId: invitation.id,
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
          where: { clerkId: jwtUser.clerkId },
          include: { organization: true },
        });
        if (raceUser) {
          this.log.warn('createFromInvitation', 'concurrent first-login race resolved', {
            userId: raceUser.id,
          });
          return raceUser;
        }
      }
      this.log.error('createFromInvitation', 'user creation from invitation failed', error, {
        invitationId: invitation.id,
      });
      throw error;
    }
  }
}
