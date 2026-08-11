import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Role, AccessScope } from '@prisma/client';
import { OrganizationMembersService } from '../../../src/services/organization-members.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { UserLoggerService } from '../../../src/common/logger/user.logger';

describe('OrganizationMembersService', () => {
  let service: OrganizationMembersService;

  const mockPrismaService = {
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '223e4567-e89b-12d3-a456-426614174001';
  const otherOrgId = '323e4567-e89b-12d3-a456-426614174002';

  const mockOrganization = {
    id: orgId,
    name: 'Acme Corp',
    slug: 'acme-corp',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockUser = {
    id: userId,
    email: 'user@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    accessScope: AccessScope.ORG,
    clerkId: 'user_123',
    organizationId: null as string | null,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockMemberResponse = {
    id: userId,
    email: 'user@example.com',
    name: 'Test User',
    role: Role.CLIENT,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationMembersService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: UserLoggerService,
          useValue: {
            logMemberAssigned: jest.fn(),
            logMemberRemoved: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrganizationMembersService>(
      OrganizationMembersService,
    );
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listMembers', () => {
    const members = [
      { id: userId, email: 'user@example.com', name: 'Test User', role: Role.CLIENT, createdAt: new Date('2026-01-01') },
    ];

    it('should return members for SUPER_ADMIN accessing any org', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findMany.mockResolvedValue(members);

      const result = await service.listMembers(orgId, {
        accessScope: AccessScope.PLATFORM,
        organizationId: null,
      });

      expect(result).toEqual(members);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return members for ADMIN accessing any org', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findMany.mockResolvedValue(members);

      const result = await service.listMembers(orgId, {
        accessScope: AccessScope.PLATFORM,
        organizationId: otherOrgId,
      });

      expect(result).toEqual(members);
    });

    it('should return members for CLIENT accessing their own org', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findMany.mockResolvedValue(members);

      const result = await service.listMembers(orgId, {
        accessScope: AccessScope.ORG,
        organizationId: orgId,
      });

      expect(result).toEqual(members);
    });

    it('should throw NotFoundException when CLIENT accesses another org', async () => {
      await expect(
        service.listMembers(orgId, {
          accessScope: AccessScope.ORG,
          organizationId: otherOrgId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.listMembers(orgId, {
          accessScope: AccessScope.PLATFORM,
          organizationId: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return empty array when org has no members', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.listMembers(orgId, {
        accessScope: AccessScope.PLATFORM,
        organizationId: null,
      });

      expect(result).toEqual([]);
    });
  });

  describe('assignMember', () => {
    it('should assign a user to an organization', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        organizationId: orgId,
      });

      const result = await service.assignMember(orgId, userId);

      expect(result).toEqual(mockMemberResponse);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { organizationId: orgId },
      });
    });

    it('should return current state if user is already in the target org', async () => {
      const userInOrg = { ...mockUser, organizationId: orgId };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(userInOrg);

      const result = await service.assignMember(orgId, userId);

      expect(result).toEqual(mockMemberResponse);
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when user is in another org', async () => {
      const userInOtherOrg = { ...mockUser, organizationId: otherOrgId };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(userInOtherOrg);

      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow('User is already assigned to another organization');
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow('User not found');
    });

    it('should throw NotFoundException when user is soft-deleted', async () => {
      const deletedUser = { ...mockUser, deletedAt: new Date() };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(deletedUser);

      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when assigning a PLATFORM-scoped user', async () => {
      const platformUser = { ...mockUser, accessScope: AccessScope.PLATFORM };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(platformUser);

      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assignMember(orgId, userId),
      ).rejects.toThrow('Cannot assign a platform-scoped user to an organization');
    });

    /**
     * The check reads accessScope, not the deprecated role column. A user who
     * still carries the old top-tier role but has been moved to ORG scope is a
     * legitimate member and must be assignable.
     */
    it('should ignore the legacy role column and assign an ORG-scoped user', async () => {
      const demoted = { ...mockUser, role: Role.SUPER_ADMIN, accessScope: AccessScope.ORG };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(demoted);
      mockPrismaService.user.update.mockResolvedValue({ ...demoted, organizationId: orgId });

      await expect(service.assignMember(orgId, userId)).resolves.toBeDefined();
    });
  });

  describe('removeMember', () => {
    it('should remove user from organization by setting organizationId to null', async () => {
      const userInOrg = { ...mockUser, organizationId: orgId };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(userInOrg);
      mockPrismaService.user.update.mockResolvedValue({
        ...userInOrg,
        organizationId: null,
      });

      await service.removeMember(orgId, userId);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { organizationId: null },
      });
    });

    it('should throw NotFoundException when organization does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow('User not found');
    });

    it('should throw NotFoundException when user is soft-deleted', async () => {
      const deletedUser = { ...mockUser, deletedAt: new Date() };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(deletedUser);

      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user is not in the specified org', async () => {
      const userInOtherOrg = { ...mockUser, organizationId: otherOrgId };
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(userInOtherOrg);

      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow('User is not a member of this organization');
    });

    it('should throw NotFoundException when user has no organization', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser); // organizationId: null

      await expect(
        service.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
