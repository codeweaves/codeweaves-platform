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
});
