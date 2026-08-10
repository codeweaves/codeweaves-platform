import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, AccessScope } from '@prisma/client';
import { OrganizationMembersController } from '../../../src/controllers/organizations/organization-members.controller';
import { OrganizationMembersService } from '../../../src/services/organization-members.service';
import { PermissionGuard } from '../../../src/guards/permission.guard';
import { TenantGuard } from '../../../src/guards/tenant.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('OrganizationMembersController', () => {
  let controller: OrganizationMembersController;

  const mockMembersService = {
    listMembers: jest.fn(),
    assignMember: jest.fn(),
    removeMember: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const userId = '223e4567-e89b-12d3-a456-426614174001';

  const mockSuperAdmin: CurrentUserData = {
    clerkId: 'user_super',
    email: 'super@example.com',
    id: '333e4567-e89b-12d3-a456-426614174003',
    role: Role.SUPER_ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.super_admin'],
    organizationId: null,
    organization: null,
  };

  const mockAdmin: CurrentUserData = {
    clerkId: 'user_admin',
    email: 'admin@example.com',
    id: '444e4567-e89b-12d3-a456-426614174004',
    role: Role.ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.support', 'platform.ops', 'platform.privacy', 'platform.agent_admin'],
    organizationId: orgId,
    organization: { id: orgId, name: 'Acme Corp', slug: 'acme-corp' },
  };

  const mockClient: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@example.com',
    id: '555e4567-e89b-12d3-a456-426614174005',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    organizationId: orgId,
    organization: { id: orgId, name: 'Acme Corp', slug: 'acme-corp' },
  };

  const mockMembers = [
    {
      id: userId,
      email: 'user@example.com',
      name: 'Test User',
      role: Role.CLIENT,

      accessScope: AccessScope.ORG,

      roleKeys: ['org.owner'],
      createdAt: new Date('2026-01-01'),
    },
  ];

  const mockMemberResponse = {
    id: userId,
    email: 'user@example.com',
    name: 'Test User',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationMembersController],
      providers: [
        { provide: OrganizationMembersService, useValue: mockMembersService },
        Reflector,
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrganizationMembersController>(
      OrganizationMembersController,
    );
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listMembers', () => {
    it('should return members for SUPER_ADMIN', async () => {
      mockMembersService.listMembers.mockResolvedValue(mockMembers);

      const result = await controller.listMembers(orgId, mockSuperAdmin);

      expect(result).toEqual(mockMembers);
      expect(mockMembersService.listMembers).toHaveBeenCalledWith(orgId, {
        accessScope: AccessScope.PLATFORM,
        organizationId: null,
      });
    });

    it('should return members for ADMIN', async () => {
      mockMembersService.listMembers.mockResolvedValue(mockMembers);

      const result = await controller.listMembers(orgId, mockAdmin);

      expect(result).toEqual(mockMembers);
      expect(mockMembersService.listMembers).toHaveBeenCalledWith(orgId, {
        accessScope: AccessScope.PLATFORM,
        organizationId: orgId,
      });
    });

    it('should return members for CLIENT user', async () => {
      mockMembersService.listMembers.mockResolvedValue(mockMembers);

      const result = await controller.listMembers(orgId, mockClient);

      expect(result).toEqual(mockMembers);
      expect(mockMembersService.listMembers).toHaveBeenCalledWith(orgId, {
        accessScope: AccessScope.ORG,
        organizationId: orgId,
      });
    });

    it('should propagate NotFoundException from service', async () => {
      mockMembersService.listMembers.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        controller.listMembers(orgId, mockClient),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignMember', () => {
    it('should assign user to organization', async () => {
      mockMembersService.assignMember.mockResolvedValue(mockMemberResponse);

      const result = await controller.assignMember(orgId, userId);

      expect(result).toEqual(mockMemberResponse);
      expect(mockMembersService.assignMember).toHaveBeenCalledWith(orgId, userId);
    });

    it('should propagate NotFoundException from service', async () => {
      mockMembersService.assignMember.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.assignMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException from service', async () => {
      mockMembersService.assignMember.mockRejectedValue(
        new ConflictException('User is already assigned to another organization'),
      );

      await expect(
        controller.assignMember(orgId, userId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    it('should remove user from organization', async () => {
      mockMembersService.removeMember.mockResolvedValue(undefined);

      await controller.removeMember(orgId, userId);

      expect(mockMembersService.removeMember).toHaveBeenCalledWith(orgId, userId);
    });

    it('should propagate NotFoundException from service', async () => {
      mockMembersService.removeMember.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.removeMember(orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('role authorization', () => {
    it('declares a permission on listMembers', () => {
      const permission = Reflect.getMetadata(
        'permission',
        OrganizationMembersController.prototype.listMembers,
      );
      expect(permission).toEqual({ resource: 'Member', action: 'Read' });
    });

    it('declares a permission on assignMember', () => {
      const permission = Reflect.getMetadata(
        'permission',
        OrganizationMembersController.prototype.assignMember,
      );
      expect(permission).toEqual({ resource: 'Member', action: 'Manage' });
    });

    it('declares a permission on removeMember', () => {
      const permission = Reflect.getMetadata(
        'permission',
        OrganizationMembersController.prototype.removeMember,
      );
      expect(permission).toEqual({ resource: 'Member', action: 'Manage' });
    });
  });
});
