import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AccessScope, Role } from '@prisma/client';
import { UserLoggerService } from '../common/logger/user.logger';
import { AppLogger } from '../common/logger/app-logger';
import { isOrgScoped } from '../utils/tenant-filter';

export interface MemberResponse {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
}

export interface MembersListCaller {
  accessScope: AccessScope;
  organizationId: string | null;
}

@Injectable()
export class OrganizationMembersService {
  private readonly log = new AppLogger(OrganizationMembersService.name);

  constructor(
    private prisma: PrismaService,
    private readonly userLogger: UserLoggerService,
  ) {}

  async listMembers(
    orgId: string,
    caller: MembersListCaller,
  ): Promise<MemberResponse[]> {
    // CLIENT users can only list their own org's members
    if (
      isOrgScoped(caller) &&
      caller.organizationId !== orgId
    ) {
      throw new NotFoundException('Organization not found');
    }

    await this.ensureOrgExists(orgId);

    const users = await this.prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  async assignMember(
    orgId: string,
    userId: string,
  ): Promise<MemberResponse> {
    await this.ensureOrgExists(orgId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    if (user.role === Role.SUPER_ADMIN) {
      throw new BadRequestException(
        'Cannot assign a SUPER_ADMIN user to an organization',
      );
    }

    if (user.organizationId && user.organizationId !== orgId) {
      throw new ConflictException(
        'User is already assigned to another organization',
      );
    }

    if (user.organizationId === orgId) {
      // Already in this org, return current state
      return this.toMemberResponse(user);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { organizationId: orgId },
    });

    await this.userLogger.logMemberAssigned(userId, { organizationId: orgId });
    this.log.info('assignMember', 'member assigned to organization', { userId, organizationId: orgId });
    return this.toMemberResponse(updated);
  }

  async removeMember(
    orgId: string,
    userId: string,
  ): Promise<void> {
    await this.ensureOrgExists(orgId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    if (user.organizationId !== orgId) {
      throw new NotFoundException('User is not a member of this organization');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { organizationId: null },
    });
    await this.userLogger.logMemberRemoved(userId, { organizationId: orgId });
    this.log.info('removeMember', 'member removed from organization', { userId, organizationId: orgId });
  }

  private async ensureOrgExists(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }
  }

  private toMemberResponse(user: {
    id: string;
    email: string;
    name: string | null;
    role: Role;
    createdAt: Date;
  }): MemberResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
