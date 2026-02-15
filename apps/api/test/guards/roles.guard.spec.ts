import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/guards/roles.guard';
import { Role } from '@prisma/client';

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
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
    const context = createMockContext({ role: Role.SUPER_ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
    const context = createMockContext({ role: Role.CLIENT });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny access when user has no role', () => {
    mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
    const context = createMockContext({});

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny access when there is no user', () => {
    mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
    const context = createMockContext(null);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow when user has one of multiple required roles', () => {
    mockReflector.getAllAndOverride.mockReturnValue([
      Role.SUPER_ADMIN,
      Role.ADMIN,
    ]);
    const context = createMockContext({ role: Role.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  describe('RBAC Permission Matrix', () => {
    describe('SUPER_ADMIN-only endpoints (Organizations, Invitations)', () => {
      beforeEach(() => {
        mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
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
        mockReflector.getAllAndOverride.mockReturnValue([
          Role.SUPER_ADMIN,
          Role.ADMIN,
        ]);
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
        mockReflector.getAllAndOverride.mockReturnValue(undefined);
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
        mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
        const context = createMockContext({ role: undefined });
        expect(guard.canActivate(context)).toBe(false);
      });

      it('should deny null user against any role requirement', () => {
        mockReflector.getAllAndOverride.mockReturnValue([Role.CLIENT]);
        const context = createMockContext(null);
        expect(guard.canActivate(context)).toBe(false);
      });

      it('should deny user with invalid string role', () => {
        mockReflector.getAllAndOverride.mockReturnValue([Role.SUPER_ADMIN]);
        const context = createMockContext({ role: 'INVALID_ROLE' });
        expect(guard.canActivate(context)).toBe(false);
      });
    });
  });
});
