import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AccessScope, Role } from '@prisma/client';
import { RbacController } from '../../../src/controllers/rbac/rbac.controller';
import { UserRolesService } from '../../../src/services/user-roles.service';
import { PermissionGuard } from '../../../src/guards/permission.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('RbacController', () => {
  let controller: RbacController;

  const mockService = {
    listAssignableRoles: jest.fn(),
    listUsers: jest.fn(),
    getUser: jest.fn(),
    setRoles: jest.fn(),
    setAccessScope: jest.fn(),
  };

  const superAdmin: CurrentUserData = {
    clerkId: 'clerk_sa',
    email: 'sa@test.com',
    id: 'sa-id',
    role: Role.SUPER_ADMIN,
    accessScope: AccessScope.PLATFORM,
    roleKeys: ['platform.super_admin'],
    organizationId: null,
    organization: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [{ provide: UserRolesService, useValue: mockService }, Reflector],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(RbacController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listRoles', () => {
    it('delegates to the service with the caller, so filtering happens server-side', async () => {
      mockService.listAssignableRoles.mockResolvedValue([{ key: 'org.viewer' }]);
      const result = await controller.listRoles(superAdmin);
      expect(result).toEqual([{ key: 'org.viewer' }]);
      expect(mockService.listAssignableRoles).toHaveBeenCalledWith(superAdmin);
    });
  });

  describe('listUsers', () => {
    it('passes the query and caller through', async () => {
      const query = { page: 1, limit: 20 };
      mockService.listUsers.mockResolvedValue({ data: [], meta: {} });
      await controller.listUsers(query, superAdmin);
      expect(mockService.listUsers).toHaveBeenCalledWith(superAdmin, query);
    });
  });

  describe('getUser', () => {
    it('passes the id and caller through', async () => {
      mockService.getUser.mockResolvedValue({ id: 'u1' });
      await controller.getUser({ id: 'u1' }, superAdmin);
      expect(mockService.getUser).toHaveBeenCalledWith(superAdmin, 'u1');
    });
  });

  describe('setRoles', () => {
    it('forwards the complete role set, matching PUT replace semantics', async () => {
      mockService.setRoles.mockResolvedValue({ id: 'u1' });
      await controller.setRoles({ id: 'u1' }, { roleKeys: ['org.viewer'] }, superAdmin);
      expect(mockService.setRoles).toHaveBeenCalledWith(superAdmin, 'u1', ['org.viewer']);
    });
  });

  describe('setAccessScope', () => {
    it('forwards the requested scope', async () => {
      mockService.setAccessScope.mockResolvedValue({ id: 'u1' });
      await controller.setAccessScope(
        { id: 'u1' },
        { accessScope: AccessScope.PLATFORM },
        superAdmin,
      );
      expect(mockService.setAccessScope).toHaveBeenCalledWith(
        superAdmin,
        'u1',
        AccessScope.PLATFORM,
      );
    });
  });

  describe('authorization declarations', () => {
    it('declares a permission on every route', () => {
      for (const method of [
        'listRoles',
        'listUsers',
        'getUser',
        'setRoles',
        'setAccessScope',
      ]) {
        const permission = Reflect.getMetadata(
          'permission',
          (RbacController.prototype as unknown as Record<string, unknown>)[method] as object,
        );
        expect(permission).toBeDefined();
      }
    });

    it('gates scope changes behind User:ManageScope, apart from role editing', () => {
      const permission = Reflect.getMetadata(
        'permission',
        RbacController.prototype.setAccessScope,
      );
      expect(permission).toEqual({ resource: 'User', action: 'ManageScope' });
    });

    it('gates role assignment behind Member:Manage', () => {
      const permission = Reflect.getMetadata(
        'permission',
        RbacController.prototype.setRoles,
      );
      expect(permission).toEqual({ resource: 'Member', action: 'Manage' });
    });
  });
});
