import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { RbacService, Resource, Action } from '../../../src/common/rbac';

describe('RbacService', () => {
  let service: RbacService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacService],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkPermission', () => {
    it('should return true for SUPER_ADMIN on any resource/action', () => {
      expect(
        service.checkPermission(Role.SUPER_ADMIN, Resource.Agent, Action.Delete),
      ).toBe(true);
    });

    it('should return true for ADMIN on any resource/action', () => {
      expect(
        service.checkPermission(Role.ADMIN, Resource.File, Action.Create),
      ).toBe(true);
    });

    it('should return true for CLIENT on allowed permission', () => {
      expect(
        service.checkPermission(Role.CLIENT, Resource.User, Action.Read),
      ).toBe(true);
    });

    it('should return false for CLIENT on disallowed permission', () => {
      expect(
        service.checkPermission(Role.CLIENT, Resource.Agent, Action.Delete),
      ).toBe(false);
    });

    it('should delegate to the permission matrix correctly', () => {
      // CLIENT can read agents but not create them
      expect(
        service.checkPermission(Role.CLIENT, Resource.Agent, Action.Read),
      ).toBe(true);
      expect(
        service.checkPermission(Role.CLIENT, Resource.Agent, Action.Create),
      ).toBe(false);
    });
  });

  describe('getPermissionsForRole', () => {
    it('should return all permissions for SUPER_ADMIN', () => {
      const permissions = service.getPermissionsForRole(Role.SUPER_ADMIN);
      const allResources = Object.values(Resource);
      const allActions = Object.values(Action);
      expect(permissions).toHaveLength(allResources.length * allActions.length);
    });

    it('should return limited permissions for CLIENT', () => {
      const permissions = service.getPermissionsForRole(Role.CLIENT);
      expect(permissions.length).toBe(11);
      expect(permissions).toContain('User:Read');
      expect(permissions).not.toContain('User:Delete');
    });
  });
});
