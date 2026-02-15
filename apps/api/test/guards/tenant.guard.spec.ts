import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { TenantGuard } from '../../src/guards/tenant.guard';
import { Role } from '@prisma/client';

describe('TenantGuard', () => {
  let guard: TenantGuard;

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
      providers: [TenantGuard],
    }).compile();

    guard = module.get<TenantGuard>(TenantGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow SUPER_ADMIN without organizationId', () => {
    const context = createMockContext({
      role: Role.SUPER_ADMIN,
      organizationId: null,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow SUPER_ADMIN with organizationId', () => {
    const context = createMockContext({
      role: Role.SUPER_ADMIN,
      organizationId: 'org-uuid',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow ADMIN without organizationId', () => {
    const context = createMockContext({
      role: Role.ADMIN,
      organizationId: null,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow ADMIN with organizationId', () => {
    const context = createMockContext({
      role: Role.ADMIN,
      organizationId: 'org-uuid',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow CLIENT with valid organizationId', () => {
    const context = createMockContext({
      role: Role.CLIENT,
      organizationId: 'org-uuid',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException for CLIENT without organizationId', () => {
    const context = createMockContext({
      role: Role.CLIENT,
      organizationId: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Client user must be associated with an organization',
    );
  });

  it('should deny when there is no user on the request', () => {
    const context = createMockContext(null);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny when user is undefined', () => {
    const context = createMockContext(undefined);
    expect(guard.canActivate(context)).toBe(false);
  });
});
