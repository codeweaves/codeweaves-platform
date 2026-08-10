import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../src/guards/permission.guard';
import { PERMISSION_KEY } from '../../src/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../../src/decorators/public.decorator';
import { SELF_ONLY_KEY } from '../../src/decorators/self-only.decorator';
import { Resource, Action } from '../../src/common/rbac/rbac.types';
import { PermissionCatalogService } from '../../src/common/rbac/permission-catalog.service';

/**
 * Stand-in for the DB-backed catalog. Mirrors the shape of the real seed closely
 * enough to exercise the union: org.owner and org.analyst overlap on
 * Analytics:Read, which is the case that proves additive roles dedupe.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  'platform.super_admin': [
    'Agent:Read',
    'Agent:Create',
    'Agent:Update',
    'Organization:Delete',
    'Analytics:Read',
  ],
  'org.owner': ['Agent:Read', 'Agent:Update', 'Analytics:Read'],
  'org.analyst': ['Analytics:Read', 'ChatSession:Read'],
  'org.viewer': ['Agent:Read'],
};

function makeCatalog(): PermissionCatalogService {
  return {
    resolvePermissions: (roleKeys: readonly string[]) => {
      const out = new Set<string>();
      for (const key of roleKeys) {
        for (const p of ROLE_PERMISSIONS[key] ?? []) out.add(p);
      }
      return out;
    },
  } as unknown as PermissionCatalogService;
}

describe('PermissionGuard', () => {
  let guard: PermissionGuard;

  const mockReflector = { getAllAndOverride: jest.fn() };

  function createMockContext(user: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as unknown,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({} as never),
      switchToWs: () => ({} as never),
      getType: () => 'http' as const,
    } as unknown as ExecutionContext;
  }

  /** Declares one authorization marker, as a real route annotation would. */
  function declare(markers: {
    isPublic?: boolean;
    selfOnly?: boolean;
    permission?: { resource: Resource; action: Action };
  }) {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return markers.isPublic;
      if (key === SELF_ONLY_KEY) return markers.selfOnly;
      if (key === PERMISSION_KEY) return markers.permission;
      return undefined;
    });
  }

  const userWith = (roleKeys: string[]) => ({ id: 'u1', roleKeys });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PermissionCatalogService, useValue: makeCatalog() },
      ],
    }).compile();

    guard = module.get<PermissionGuard>(PermissionGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  /**
   * The behaviour change that motivated making this guard global. The previous
   * RolesGuard returned true here, so a controller that forgot
   * @UseGuards(RolesGuard) served every authenticated user silently.
   */
  describe('default deny (undeclared routes)', () => {
    it('denies when the route declares nothing at all', () => {
      declare({});
      expect(() =>
        guard.canActivate(createMockContext(userWith(['platform.super_admin']))),
      ).toThrow(ForbiddenException);
    });

    it('denies an undeclared route even for a super admin', () => {
      declare({});
      expect(() =>
        guard.canActivate(createMockContext(userWith(['platform.super_admin']))),
      ).toThrow(/declares no authorization/);
    });
  });

  describe('@Public', () => {
    it('allows with no user at all', () => {
      declare({ isPublic: true });
      expect(guard.canActivate(createMockContext(null))).toBe(true);
    });

    it('takes precedence over a permission requirement', () => {
      declare({
        isPublic: true,
        permission: { resource: Resource.Organization, action: Action.Delete },
      });
      expect(guard.canActivate(createMockContext(null))).toBe(true);
    });
  });

  describe('@SelfOnly', () => {
    it('allows any authenticated user regardless of roles', () => {
      declare({ selfOnly: true });
      expect(guard.canActivate(createMockContext(userWith([])))).toBe(true);
    });
  });

  describe('@RequirePermission', () => {
    it('allows when a held role grants the permission', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Read } });
      expect(guard.canActivate(createMockContext(userWith(['org.owner'])))).toBe(true);
    });

    it('denies when no held role grants it', () => {
      declare({ permission: { resource: Resource.Organization, action: Action.Delete } });
      expect(() =>
        guard.canActivate(createMockContext(userWith(['org.owner']))),
      ).toThrow(ForbiddenException);
    });

    it('denies a user holding no roles at all', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Read } });
      expect(() => guard.canActivate(createMockContext(userWith([])))).toThrow(
        ForbiddenException,
      );
    });

    it('denies when there is no user on the request', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Read } });
      expect(() => guard.canActivate(createMockContext(null))).toThrow(
        ForbiddenException,
      );
    });

    it('tolerates a user with no roleKeys property', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Read } });
      expect(() => guard.canActivate(createMockContext({ id: 'u1' }))).toThrow(
        ForbiddenException,
      );
    });

    it('ignores unknown role keys rather than throwing', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Read } });
      expect(
        guard.canActivate(createMockContext(userWith(['org.owner', 'role.that.was.removed']))),
      ).toBe(true);
    });
  });

  /** The property that makes the model additive. */
  describe('additive roles', () => {
    it('unions permissions across every role held', () => {
      declare({ permission: { resource: Resource.ChatSession, action: Action.Read } });
      // org.owner alone does not grant ChatSession:Read; org.analyst does.
      expect(() =>
        guard.canActivate(createMockContext(userWith(['org.owner']))),
      ).toThrow(ForbiddenException);
      expect(
        guard.canActivate(createMockContext(userWith(['org.owner', 'org.analyst']))),
      ).toBe(true);
    });

    it('treats overlapping grants as one, not an error', () => {
      // Both roles grant Analytics:Read.
      declare({ permission: { resource: Resource.Analytics, action: Action.Read } });
      expect(
        guard.canActivate(createMockContext(userWith(['org.owner', 'org.analyst']))),
      ).toBe(true);
    });

    it('grants nothing extra for a role that adds nothing', () => {
      declare({ permission: { resource: Resource.Agent, action: Action.Create } });
      expect(() =>
        guard.canActivate(createMockContext(userWith(['org.owner', 'org.viewer', 'org.analyst']))),
      ).toThrow(ForbiddenException);
    });
  });
});
