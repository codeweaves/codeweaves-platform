import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { TenantGuard } from '../../src/guards/tenant.guard';
import { AccessScope } from '@prisma/client';

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

  it('should allow PLATFORM scope without organizationId', () => {
    const context = createMockContext({
      accessScope: AccessScope.PLATFORM,
      organizationId: null,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow PLATFORM scope with organizationId', () => {
    const context = createMockContext({
      accessScope: AccessScope.PLATFORM,
      organizationId: 'org-uuid',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow ORG scope with valid organizationId', () => {
    const context = createMockContext({
      accessScope: AccessScope.ORG,
      organizationId: 'org-uuid',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException for ORG scope without organizationId', () => {
    const context = createMockContext({
      accessScope: AccessScope.ORG,
      organizationId: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(
      'Client user must be associated with an organization',
    );
  });

  /**
   * The guard reads accessScope, not the deprecated `role` column. A holder of
   * the old top-tier role who has since been demoted to ORG scope must be
   * treated as ORG-scoped, otherwise `PATCH /users/:id/scope` would silently
   * fail to take effect on every tenant-scoped route.
   */
  it('should ignore the legacy role column when deciding scope', () => {
    const context = createMockContext({
      role: 'SUPER_ADMIN',
      accessScope: AccessScope.ORG,
      organizationId: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
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
