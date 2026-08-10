import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AccessScope, Role } from '@prisma/client';
import { UserRolesService } from '../../../src/services/user-roles.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { PermissionCatalogService } from '../../../src/common/rbac/permission-catalog.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { UserSyncGuard } from '../../../src/guards/user-sync.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

/** Mirrors the shape of the seeded catalog closely enough for the grant rules. */
const CATALOG = {
  'platform.super_admin': { orgAllowed: false, clientGrantable: false, permissions: ['Agent:Read'] },
  'platform.ops': { orgAllowed: false, clientGrantable: false, permissions: ['Organization:Update'] },
  'org.owner': { orgAllowed: true, clientGrantable: false, permissions: ['Agent:Read', 'Agent:Update'] },
  'org.agent_editor': { orgAllowed: true, clientGrantable: true, permissions: ['Agent:Read', 'Agent:Update'] },
  'org.inbox_agent': { orgAllowed: true, clientGrantable: true, permissions: ['Handover:Take'] },
  'org.viewer': { orgAllowed: true, clientGrantable: true, permissions: ['Agent:Read'] },
};

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function actor(overrides: Partial<CurrentUserData>): CurrentUserData {
  return {
    clerkId: 'clerk_actor',
    email: 'actor@test.com',
    id: 'actor-id',
    role: Role.CLIENT,
    accessScope: AccessScope.ORG,
    roleKeys: [],
    organizationId: ORG_A,
    organization: { id: ORG_A, name: 'Acme', slug: 'acme' },
    ...overrides,
  };
}

const SUPER_ADMIN = actor({
  id: 'super-id',
  role: Role.SUPER_ADMIN,
  accessScope: AccessScope.PLATFORM,
  roleKeys: ['platform.super_admin'],
  organizationId: null,
  organization: null,
});

// An ordinary org account. Holds no grant-capable role, because none exist for
// organizations any more.
const ORG_MANAGER = actor({ id: 'org-user-id', roleKeys: ['org.owner'] });

describe('UserRolesService', () => {
  let service: UserRolesService;

  const mockPrisma = {
    user: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    userRoleAssignment: { count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockCatalog = {
    listRolesFresh: jest.fn(),
    getRole: jest.fn(),
    resolvePermissions: jest.fn(),
  };

  const mockTracer = { logAuditEvent: jest.fn() };
  const mockUserSync = { evict: jest.fn() };

  /** A target user row as findFirst returns it. */
  function targetUser(overrides: Record<string, unknown> = {}) {
    return {
      id: 'target-id',
      clerkId: 'clerk_target',
      email: 'target@test.com',
      name: 'Target',
      accessScope: AccessScope.ORG,
      organizationId: ORG_A,
      organization: { id: ORG_A, name: 'Acme', slug: 'acme' },
      createdAt: new Date('2026-01-01'),
      roleAssignments: [{ roleKey: 'org.viewer' }],
      ...overrides,
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRolesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionCatalogService, useValue: mockCatalog },
        { provide: TracerService, useValue: mockTracer },
        { provide: UserSyncGuard, useValue: mockUserSync },
      ],
    }).compile();

    service = module.get(UserRolesService);
    jest.clearAllMocks();

    mockCatalog.listRolesFresh.mockResolvedValue(
      Object.entries(CATALOG).map(([key, v]) => ({
        key,
        name: key,
        description: null,
        ...v,
      })),
    );
    mockCatalog.getRole.mockImplementation((key: string) =>
      CATALOG[key as keyof typeof CATALOG]
        ? { key, name: key, description: null, ...CATALOG[key as keyof typeof CATALOG] }
        : undefined,
    );
    mockCatalog.resolvePermissions.mockReturnValue(new Set(['Agent:Read']));
    // Another owner exists unless a test says otherwise.
    mockPrisma.userRoleAssignment.count.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        userRoleAssignment: {
          deleteMany: mockPrisma.userRoleAssignment.deleteMany,
          createMany: mockPrisma.userRoleAssignment.createMany,
        },
        user: { update: mockPrisma.user.update },
      }),
    );
  });

  // -------------------------------------------------------------------
  // Catalog filtering — "cannot enumerate", not merely "cannot assign"
  // -------------------------------------------------------------------

  describe('listAssignableRoles', () => {
    it('gives a super admin every role', async () => {
      const roles = await service.listAssignableRoles(SUPER_ADMIN);
      expect(roles.map((r) => r.key).sort()).toEqual(Object.keys(CATALOG).sort());
    });


    it('OMITS platform role names entirely for an org account', async () => {
      const roles = await service.listAssignableRoles(ORG_MANAGER);
      const keys = roles.map((r) => r.key);
      // Absent, not disabled — the names must not travel in the response body.
      expect(keys).not.toContain('platform.ops');
      expect(keys).not.toContain('platform.super_admin');
    });

    it('gives an org-scoped user nothing, since only platform staff grant roles', async () => {
      const roles = await service.listAssignableRoles(ORG_MANAGER);
      expect(roles).toEqual([]);
    });

    it('gives nothing to a user with no administrative role', async () => {
      const roles = await service.listAssignableRoles(actor({ roleKeys: ['org.viewer'] }));
      expect(roles).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Invariants
  // -------------------------------------------------------------------

  describe('setRoles invariants', () => {
    it('(1) refuses self-modification', async () => {
      await expect(
        service.setRoles(ORG_MANAGER, ORG_MANAGER.id, ['org.viewer']),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('(1) allows a super admin to change their own roles', async () => {
      // Target starts on org.viewer, so assign something different or the
      // service correctly short-circuits as a no-op.
      mockPrisma.user.findFirst.mockResolvedValue(targetUser({ id: SUPER_ADMIN.id }));
      await service.setRoles(SUPER_ADMIN, SUPER_ADMIN.id, ['org.agent_editor']);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('(2) refuses to let an org account grant even a client-grantable role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await expect(
        service.setRoles(ORG_MANAGER, 'target-id', ['org.agent_editor']),
      ).rejects.toThrow(/cannot assign/i);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('(2) refuses to let an org manager grant a platform role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await expect(
        service.setRoles(ORG_MANAGER, 'target-id', ['platform.ops']),
      ).rejects.toThrow(ForbiddenException);
    });


    /**
     * An organization is NOT required to keep an owner. Stripping the last one is
     * allowed — it leaves the org's agents unmanaged until someone is granted the
     * role again, which is a product decision, not an invariant to enforce here.
     */
    it('allows removing the last owner of an organization', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        targetUser({ roleAssignments: [{ roleKey: 'org.owner' }] }),
      );
      mockPrisma.userRoleAssignment.count.mockResolvedValue(0);
      await service.setRoles(SUPER_ADMIN, 'target-id', ['org.viewer']);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('(4) returns 404, not 403, for a target outside the caller org', async () => {
      // findFirst is org-scoped, so a foreign target simply does not resolve.
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.setRoles(ORG_MANAGER, 'foreign-id', ['org.viewer']),
      ).rejects.toThrow(NotFoundException);
    });



    it('rejects a role key that is not in the catalog', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await expect(
        service.setRoles(SUPER_ADMIN, 'target-id', ['org.does_not_exist']),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a platform role for an ORG-scoped target', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser({ accessScope: AccessScope.ORG }));
      await expect(
        service.setRoles(SUPER_ADMIN, 'target-id', ['platform.ops']),
      ).rejects.toThrow(/not available to organization users/i);
    });

    it('(8) audits the change with both the before and after sets', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await service.setRoles(SUPER_ADMIN, 'target-id', ['org.agent_editor']);

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        'target-id',
        'USER_ROLES_UPDATED',
        expect.objectContaining({
          actorUserId: SUPER_ADMIN.id,
          before: ['org.viewer'],
          after: ['org.agent_editor'],
          added: ['org.agent_editor'],
          removed: ['org.viewer'],
        }),
        expect.objectContaining({ organizationId: ORG_A }),
      );
    });

    it('(9) evicts the target cache so the change is immediate', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await service.setRoles(SUPER_ADMIN, 'target-id', ['org.agent_editor']);
      expect(mockUserSync.evict).toHaveBeenCalledWith('clerk_target');
    });

    it('writes nothing and audits nothing when the set is unchanged', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser());
      await service.setRoles(SUPER_ADMIN, 'target-id', ['org.viewer']);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTracer.logAuditEvent).not.toHaveBeenCalled();
    });

    it('replaces rather than merges', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        targetUser({ roleAssignments: [{ roleKey: 'org.viewer' }, { roleKey: 'org.inbox_agent' }] }),
      );
      await service.setRoles(SUPER_ADMIN, 'target-id', ['org.agent_editor']);

      expect(mockPrisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'target-id' },
      });
      expect(mockPrisma.userRoleAssignment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ roleKey: 'org.agent_editor', grantedBy: SUPER_ADMIN.id }),
        ],
      });
    });
  });

  // -------------------------------------------------------------------
  // Access scope
  // -------------------------------------------------------------------

  describe('setAccessScope', () => {
    it('(3) refuses anyone who is not a super admin', async () => {
      await expect(
        service.setAccessScope(ORG_MANAGER, 'target-id', AccessScope.PLATFORM),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses self-modification even for a super admin', async () => {
      await expect(
        service.setAccessScope(SUPER_ADMIN, SUPER_ADMIN.id, AccessScope.ORG),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to scope a user to an org they do not belong to', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        targetUser({ accessScope: AccessScope.PLATFORM, organizationId: null, organization: null }),
      );
      await expect(
        service.setAccessScope(SUPER_ADMIN, 'target-id', AccessScope.ORG),
      ).rejects.toThrow(/assign the user to an organization/i);
    });

    it('drops platform roles when narrowing to ORG, so the account stays coherent', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        targetUser({
          accessScope: AccessScope.PLATFORM,
          roleAssignments: [{ roleKey: 'platform.ops' }, { roleKey: 'org.viewer' }],
        }),
      );

      await service.setAccessScope(SUPER_ADMIN, 'target-id', AccessScope.ORG);

      expect(mockPrisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'target-id', roleKey: { in: ['platform.ops'] } },
      });
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        'target-id',
        'USER_ACCESS_SCOPE_UPDATED',
        expect.objectContaining({ droppedRoleKeys: ['platform.ops'] }),
        expect.anything(),
      );
    });

    it('is a no-op when the scope already matches', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(targetUser({ accessScope: AccessScope.ORG }));
      await service.setAccessScope(SUPER_ADMIN, 'target-id', AccessScope.ORG);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  describe('listUsers', () => {
    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);
    });

    it('pins an ORG caller to their own organization, ignoring a passed orgId', async () => {
      await service.listUsers(ORG_MANAGER, {
        page: 1,
        limit: 20,
        organizationId: ORG_B,
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A }),
        }),
      );
    });

    it('lets a PLATFORM caller narrow to a chosen organization', async () => {
      await service.listUsers(SUPER_ADMIN, { page: 1, limit: 20, organizationId: ORG_B });
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_B }),
        }),
      );
    });
  });

  describe('getUser', () => {
    it('returns the derived permission union alongside the role keys', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        targetUser({ roleAssignments: [{ roleKey: 'org.agent_editor' }] }),
      );
      mockCatalog.resolvePermissions.mockReturnValue(new Set(['Agent:Update', 'Agent:Read']));

      const result = await service.getUser(SUPER_ADMIN, 'target-id');

      expect(result.roleKeys).toEqual(['org.agent_editor']);
      expect(result.permissions).toEqual(['Agent:Read', 'Agent:Update']);
    });

    it('404s for a target outside an ORG caller organization', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getUser(ORG_MANAGER, 'foreign-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
