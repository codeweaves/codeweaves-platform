import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/guards/roles.guard';
import { Role } from '@prisma/client';
import { PERMISSION_KEY } from '../../src/decorators/require-permission.decorator';
import { ROLES_KEY } from '../../src/decorators/roles.decorator';
import { Resource, Action } from '../../src/common/rbac/rbac.types';

describe('RolesGuard - @RequirePermission', () => {
  let guard: RolesGuard;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  function createMockContext(user: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as unknown,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({} as never),
      switchToWs: () => ({} as never),
      getType: () => 'http' as const,
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('Permission granted', () => {
    it('should allow ADMIN when ADMIN is in PERMISSION_MATRIX for Agent:Create', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.ADMIN });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow CLIENT when CLIENT is in PERMISSION_MATRIX for Agent:Read', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Read };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.CLIENT });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Permission denied', () => {
    it('should throw ForbiddenException when CLIENT tries Agent:Create', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.CLIENT });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Forbidden: requires [Agent:Create] permission',
      );
    });

    it('should throw ForbiddenException when CLIENT tries Organization:Create', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Organization, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.CLIENT });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Forbidden: requires [Organization:Create] permission',
      );
    });
  });

  describe('SUPER_ADMIN bypass', () => {
    it('should always allow SUPER_ADMIN regardless of matrix entry', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.SUPER_ADMIN });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow SUPER_ADMIN for any resource/action combination', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Invitation, action: Action.Delete };
        }
        return undefined;
      });

      const context = createMockContext({ role: Role.SUPER_ADMIN });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Backward compatibility with @Roles()', () => {
    it('should fall back to @Roles check when no @RequirePermission is set', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) return undefined;
        if (key === ROLES_KEY) return [Role.ADMIN, Role.SUPER_ADMIN];
        return undefined;
      });

      const context = createMockContext({ role: Role.ADMIN });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny via @Roles when user role is not in required roles', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) return undefined;
        if (key === ROLES_KEY) return [Role.SUPER_ADMIN];
        return undefined;
      });

      const context = createMockContext({ role: Role.CLIENT });
      expect(guard.canActivate(context)).toBe(false);
    });

    it('should prioritize @RequirePermission over @Roles when both are set', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        // @RequirePermission allows ADMIN_AND_ABOVE for Agent:Create
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        // @Roles would allow CLIENT too
        if (key === ROLES_KEY) {
          return [Role.CLIENT, Role.ADMIN, Role.SUPER_ADMIN];
        }
        return undefined;
      });

      // CLIENT should be denied by @RequirePermission even though @Roles would allow
      const context = createMockContext({ role: Role.CLIENT });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('No decorator default', () => {
    it('should allow access when neither @RequirePermission nor @Roles is applied', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const context = createMockContext({ role: Role.CLIENT });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access for any role when no decorators are present', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const context = createMockContext({ role: Role.ADMIN });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should throw ForbiddenException when user is null with @RequirePermission', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext(null);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user role is undefined with @RequirePermission', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({ role: undefined });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user has no role property with @RequirePermission', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) {
          return { resource: Resource.Agent, action: Action.Create };
        }
        return undefined;
      });

      const context = createMockContext({});
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny via @Roles when user has no role', () => {
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === PERMISSION_KEY) return undefined;
        if (key === ROLES_KEY) return [Role.ADMIN];
        return undefined;
      });

      const context = createMockContext({ role: undefined });
      expect(guard.canActivate(context)).toBe(false);
    });
  });
});
