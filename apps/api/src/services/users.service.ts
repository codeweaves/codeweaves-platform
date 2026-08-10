import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { User, Role, AccessScope, InvitationStatus, Prisma } from '@prisma/client';
import type { UpdateUserProfileDto, UserProfileResponse } from '../models/user.dto';
import { buildTenantFilter, TenantFilterUser } from '../utils/tenant-filter';
import { UserLoggerService } from '../common/logger/user.logger';
import { AppLogger } from '../common/logger/app-logger';
import { ClerkManagementService } from './clerk-management.service';
import { PermissionCatalogService } from '../common/rbac/permission-catalog.service';

/**
 * Starting access scope + role set for a newly provisioned account, derived from
 * the role its invitation carried. Mirrors the RBAC backfill migration exactly,
 * so a user created today lands in the same state as one migrated yesterday.
 *
 * Invitations still carry the legacy `Role` enum. When invitations gain an
 * explicit `roleKeys` list, this becomes the fallback for older pending rows.
 */
function startingRolesFor(role: Role): {
  accessScope: AccessScope;
  roleKeys: string[];
} {
  switch (role) {
    case Role.SUPER_ADMIN:
      return { accessScope: AccessScope.PLATFORM, roleKeys: ['platform.super_admin'] };
    case Role.ADMIN:
      return {
        accessScope: AccessScope.PLATFORM,
        roleKeys: [
          'platform.support',
          'platform.ops',
          'platform.privacy',
          'platform.agent_admin',
        ],
      };
    case Role.CLIENT:
    default:
      return { accessScope: AccessScope.ORG, roleKeys: ['org.owner'] };
  }
}

const USER_WITH_ORG_SELECT = {
  include: {
    organization: {
      select: {
        id: true,
        name: true,
        slug: true,
      },
    },
    // The profile endpoint serves the caller's permission set, so it needs the
    // role keys to resolve against the catalog.
    roleAssignments: {
      where: { deletedAt: null },
      select: { roleKey: true },
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
    private readonly catalog: PermissionCatalogService,
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
      // Role assignments ride along on the query that already runs, so
      // authorization costs no extra round trip. UserSyncGuard caches the result.
      include: {
        organization: true,
        roleAssignments: {
          where: { deletedAt: null },
          select: { roleKey: true },
        },
      },
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
    accessScope: AccessScope;
    roleAssignments?: { roleKey: string }[];
    organization: { id: string; name: string; slug: string } | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserProfileResponse {
    const roleKeys = (user.roleAssignments ?? []).map((a) => a.roleKey);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      accessScope: user.accessScope,
      roleKeys,
      // Resolved server-side so the browser never re-implements a rule. This is
      // what `usePermissions()` reads; the UI decides nothing from role names.
      permissions: [...this.catalog.resolvePermissions(roleKeys)].sort(),
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
        // Prefer the role set chosen when the invite was sent. Falling back to
        // the legacy mapping keeps invitations issued before roleKeys existed
        // resolving exactly as they did, so no data migration was needed.
        const invitedRoleKeys = invitation.roleKeys ?? [];
        const { accessScope, roleKeys } =
          invitedRoleKeys.length > 0
            ? {
                accessScope: invitedRoleKeys.every((k) => k.startsWith('org.'))
                  ? AccessScope.ORG
                  : AccessScope.PLATFORM,
                roleKeys: invitedRoleKeys,
              }
            : startingRolesFor(invitation.role);

        const newUser = await tx.user.create({
          data: {
            clerkId: jwtUser.clerkId,
            email,
            role: invitation.role,
            accessScope,
            organizationId: invitation.organizationId,
            // Seed the role set in the same transaction as the user, so a new
            // account is never left with zero roles and a dead dashboard.
            roleAssignments: {
              create: roleKeys.map((roleKey) => ({
                roleKey,
                // Platform grants are not tied to an org; org grants are.
                organizationId:
                  accessScope === AccessScope.ORG ? invitation.organizationId : null,
              })),
            },
          },
          include: {
            organization: true,
            roleAssignments: { where: { deletedAt: null }, select: { roleKey: true } },
          },
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
          // Same shape as the create above — the winning request already seeded
          // the role set, and UserSyncGuard needs it on every return path.
          include: {
            organization: true,
            roleAssignments: { where: { deletedAt: null }, select: { roleKey: true } },
          },
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
