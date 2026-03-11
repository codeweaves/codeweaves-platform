import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/guards/roles.guard';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../src/decorators/roles.decorator';
import { PERMISSION_KEY } from '../../src/decorators/require-permission.decorator';

describe('RolesGuard', () => {
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

  /** Helper: mock reflector to return undefined for PERMISSION_KEY and given roles for ROLES_KEY */
  function mockRolesOnly(roles: Role[] | undefined) {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === PERMISSION_KEY) return undefined;
      if (key === ROLES_KEY) return roles;
      return undefined;
    });
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

  it('should allow access when no roles are required', () => {
    mockRolesOnly(undefined);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    mockRolesOnly([]);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    mockRolesOnly([Role.SUPER_ADMIN]);
    const context = createMockContext({ role: Role.SUPER_ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    mockRolesOnly([Role.SUPER_ADMIN]);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny access when user has no role', () => {
    mockRolesOnly([Role.SUPER_ADMIN]);
    const context = createMockContext({});

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny access when there is no user', () => {
    mockRolesOnly([Role.SUPER_ADMIN]);
    const context = createMockContext(null);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow when user has one of multiple required roles', () => {
    mockRolesOnly([Role.SUPER_ADMIN, Role.ADMIN]);
    const context = createMockContext({ role: Role.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  describe('RBAC Permission Matrix', () => {
    describe('SUPER_ADMIN-only endpoints (Organizations, Invitations)', () => {
      beforeEach(() => {
        mockRolesOnly([Role.SUPER_ADMIN]);
      });

      it('should allow SUPER_ADMIN', () => {
        const context = createMockContext({ role: Role.SUPER_ADMIN });
        expect(guard.canActivate(context)).toBe(true);
      });

      it('should deny ADMIN', () => {
        const context = createMockContext({ role: Role.ADMIN });
        expect(guard.canActivate(context)).toBe(false);
      });

      it('should deny CLIENT', () => {
        const context = createMockContext({ role: Role.CLIENT });
        expect(guard.canActivate(context)).toBe(false);
      });
    });

    describe('SUPER_ADMIN + ADMIN endpoints', () => {
      beforeEach(() => {
        mockRolesOnly([Role.SUPER_ADMIN, Role.ADMIN]);
      });

      it('should allow SUPER_ADMIN', () => {
        const context = createMockContext({ role: Role.SUPER_ADMIN });
        expect(guard.canActivate(context)).toBe(true);
      });

      it('should allow ADMIN', () => {
        const context = createMockContext({ role: Role.ADMIN });
        expect(guard.canActivate(context)).toBe(true);
      });

      it('should deny CLIENT', () => {
        const context = createMockContext({ role: Role.CLIENT });
        expect(guard.canActivate(context)).toBe(false);
      });
    });

    describe('all-roles endpoints (no @Roles decorator)', () => {
      beforeEach(() => {
        mockRolesOnly(undefined);
      });

      it('should allow SUPER_ADMIN', () => {
        const context = createMockContext({ role: Role.SUPER_ADMIN });
        expect(guard.canActivate(context)).toBe(true);
      });

      it('should allow ADMIN', () => {
        const context = createMockContext({ role: Role.ADMIN });
        expect(guard.canActivate(context)).toBe(true);
      });

      it('should allow CLIENT', () => {
        const context = createMockContext({ role: Role.CLIENT });
        expect(guard.canActivate(context)).toBe(true);
      });
    });

    describe('edge cases in RBAC', () => {
      it('should deny user with undefined role against SUPER_ADMIN requirement', () => {
        mockRolesOnly([Role.SUPER_ADMIN]);
        const context = createMockContext({ role: undefined });
        expect(guard.canActivate(context)).toBe(false);
      });

      it('should deny null user against any role requirement', () => {
        mockRolesOnly([Role.CLIENT]);
        const context = createMockContext(null);
        expect(guard.canActivate(context)).toBe(false);
      });

      it('should deny user with invalid string role', () => {
        mockRolesOnly([Role.SUPER_ADMIN]);
        const context = createMockContext({ role: 'INVALID_ROLE' });
        expect(guard.canActivate(context)).toBe(false);
      });
    });
  });
});
