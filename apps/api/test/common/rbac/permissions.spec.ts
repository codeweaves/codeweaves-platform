import { Role } from '@prisma/client';
import {
  Resource,
  Action,
  PERMISSION_MATRIX,
  hasPermission,
  getPermissionsForRole,
} from '../../../src/common/rbac';
import type { PermissionKey } from '../../../src/common/rbac';

describe('PERMISSION_MATRIX', () => {
  const allResources = Object.values(Resource);
  const allActions = Object.values(Action);

  describe('matrix completeness', () => {
    it('should have an entry for every Resource x Action combination', () => {
      for (const resource of allResources) {
        for (const action of allActions) {
          const key: PermissionKey = `${resource}:${action}`;
          expect(PERMISSION_MATRIX[key]).toBeDefined();
          expect(Array.isArray(PERMISSION_MATRIX[key])).toBe(true);
        }
      }
    });

    it('should have exactly Resource count * Action count entries', () => {
      const expectedCount = allResources.length * allActions.length;
      expect(Object.keys(PERMISSION_MATRIX)).toHaveLength(expectedCount);
    });
  });

  describe('SUPER_ADMIN permissions', () => {
    it('should have all permissions on all resources', () => {
      for (const resource of allResources) {
        for (const action of allActions) {
          const key: PermissionKey = `${resource}:${action}`;
          expect(PERMISSION_MATRIX[key]).toContain(Role.SUPER_ADMIN);
        }
      }
    });
  });

  describe('ADMIN permissions', () => {
    it('should have all permissions on all resources', () => {
      for (const resource of allResources) {
        for (const action of allActions) {
          const key: PermissionKey = `${resource}:${action}`;
          expect(PERMISSION_MATRIX[key]).toContain(Role.ADMIN);
        }
      }
    });
  });

  describe('CLIENT permissions', () => {
    const clientAllowed: PermissionKey[] = [
      'User:Read',
      'User:Update',
      'Organization:Read',
      'Agent:Read',
      'Agent:ReadAll',
      'AgentTheme:Read',
      'ChatSession:Read',
      'ChatSession:ReadAll',
      'ChatMessage:Read',
      'Analytics:Read',
      'AuditLog:Read',
    ];

    it('should have only the explicitly listed permissions', () => {
      const clientPermissions = [...getPermissionsForRole(Role.CLIENT)];
      expect(clientPermissions.sort()).toEqual([...clientAllowed].sort());
    });

    it.each(clientAllowed)(
      'should have permission for %s',
      (key: PermissionKey) => {
        expect(PERMISSION_MATRIX[key]).toContain(Role.CLIENT);
      },
    );

    it('should NOT have Delete on any resource', () => {
      for (const resource of allResources) {
        const key: PermissionKey = `${resource}:${Action.Delete}`;
        expect(PERMISSION_MATRIX[key]).not.toContain(Role.CLIENT);
      }
    });

    it('should NOT have Create on any resource', () => {
      for (const resource of allResources) {
        const key: PermissionKey = `${resource}:${Action.Create}`;
        expect(PERMISSION_MATRIX[key]).not.toContain(Role.CLIENT);
      }
    });

    it('should NOT have Export on any resource', () => {
      for (const resource of allResources) {
        const key: PermissionKey = `${resource}:${Action.Export}`;
        expect(PERMISSION_MATRIX[key]).not.toContain(Role.CLIENT);
      }
    });

    it('should NOT have Update on resources other than User', () => {
      const nonUserResources = allResources.filter((r) => r !== Resource.User);
      for (const resource of nonUserResources) {
        const key: PermissionKey = `${resource}:${Action.Update}`;
        expect(PERMISSION_MATRIX[key]).not.toContain(Role.CLIENT);
      }
    });
  });
});

describe('hasPermission', () => {
  it('should return true for SUPER_ADMIN on any resource/action', () => {
    expect(
      hasPermission(Role.SUPER_ADMIN, Resource.Agent, Action.Delete),
    ).toBe(true);
  });

  it('should return true for ADMIN on any resource/action', () => {
    expect(hasPermission(Role.ADMIN, Resource.File, Action.Create)).toBe(true);
  });

  it('should return true for CLIENT on allowed resource/action', () => {
    expect(hasPermission(Role.CLIENT, Resource.User, Action.Read)).toBe(true);
  });

  it('should return false for CLIENT on disallowed resource/action', () => {
    expect(hasPermission(Role.CLIENT, Resource.Agent, Action.Delete)).toBe(
      false,
    );
  });

  it('should return false for CLIENT creating an Agent', () => {
    expect(hasPermission(Role.CLIENT, Resource.Agent, Action.Create)).toBe(
      false,
    );
  });

  it('should return false for CLIENT creating an Organization', () => {
    expect(
      hasPermission(Role.CLIENT, Resource.Organization, Action.Create),
    ).toBe(false);
  });
});

describe('getPermissionsForRole', () => {
  it('should return all permission keys for SUPER_ADMIN', () => {
    const allResources = Object.values(Resource);
    const allActions = Object.values(Action);
    const expectedCount = allResources.length * allActions.length;
    const permissions = getPermissionsForRole(Role.SUPER_ADMIN);
    expect(permissions).toHaveLength(expectedCount);
  });

  it('should return all permission keys for ADMIN', () => {
    const allResources = Object.values(Resource);
    const allActions = Object.values(Action);
    const expectedCount = allResources.length * allActions.length;
    const permissions = getPermissionsForRole(Role.ADMIN);
    expect(permissions).toHaveLength(expectedCount);
  });

  it('should return limited permission keys for CLIENT', () => {
    const permissions = getPermissionsForRole(Role.CLIENT);
    expect(permissions.length).toBe(11);
    expect(permissions).toContain('User:Read');
    expect(permissions).toContain('User:Update');
    expect(permissions).toContain('Organization:Read');
    expect(permissions).toContain('Agent:Read');
    expect(permissions).toContain('Agent:ReadAll');
    expect(permissions).toContain('AgentTheme:Read');
    expect(permissions).toContain('ChatSession:Read');
    expect(permissions).toContain('ChatSession:ReadAll');
    expect(permissions).toContain('ChatMessage:Read');
    expect(permissions).toContain('Analytics:Read');
    expect(permissions).toContain('AuditLog:Read');
  });

  it('should not contain Delete permissions for CLIENT', () => {
    const permissions = getPermissionsForRole(Role.CLIENT);
    const deletePermissions = permissions.filter((p) => p.endsWith(':Delete'));
    expect(deletePermissions).toHaveLength(0);
  });
});
