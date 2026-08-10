import { Test, TestingModule } from '@nestjs/testing';
import { PermissionCatalogService } from '../../../src/common/rbac/permission-catalog.service';
import { PrismaService } from '../../../src/services/prisma.service';

const ROLES = [
  {
    key: 'org.owner',
    name: 'Owner',
    description: 'Full control',
    orgAllowed: true,
    clientGrantable: false,
    permissions: [{ permissionKey: 'Agent:Read' }, { permissionKey: 'Agent:Update' }],
  },
  {
    key: 'org.analyst',
    name: 'Analyst',
    description: null,
    orgAllowed: true,
    clientGrantable: true,
    // Overlaps org.owner on Agent:Read — the union must dedupe.
    permissions: [{ permissionKey: 'Agent:Read' }, { permissionKey: 'Analytics:Read' }],
  },
  {
    key: 'platform.ops',
    name: 'Platform Ops',
    description: null,
    orgAllowed: false,
    clientGrantable: false,
    permissions: [{ permissionKey: 'Organization:Update' }],
  },
];

const PERMISSIONS = [
  { key: 'Agent:Read', resource: 'Agent', action: 'Read', description: null, orgAllowed: true },
  { key: 'Agent:Update', resource: 'Agent', action: 'Update', description: null, orgAllowed: true },
  { key: 'Analytics:Read', resource: 'Analytics', action: 'Read', description: null, orgAllowed: true },
  {
    key: 'Organization:Update',
    resource: 'Organization',
    action: 'Update',
    description: null,
    orgAllowed: false,
  },
];

describe('PermissionCatalogService', () => {
  let service: PermissionCatalogService;

  const mockPrisma = {
    appRole: { findMany: jest.fn() },
    permission: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionCatalogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(PermissionCatalogService);
    jest.clearAllMocks();
    mockPrisma.appRole.findMany.mockResolvedValue(ROLES);
    mockPrisma.permission.findMany.mockResolvedValue(PERMISSIONS);
  });

  describe('onModuleInit', () => {
    it('loads the catalog at boot', async () => {
      await service.onModuleInit();
      expect(service.size).toBe(3);
      expect(service.getRole('org.owner')?.name).toBe('Owner');
      expect(service.getPermission('Agent:Read')?.orgAllowed).toBe(true);
    });

    it('throws when the very first load fails, since there is nothing to serve', async () => {
      mockPrisma.appRole.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.onModuleInit()).rejects.toThrow('db down');
    });
  });

  describe('resolvePermissions', () => {
    beforeEach(() => service.onModuleInit());

    it('returns the union of every role held', () => {
      const result = service.resolvePermissions(['org.owner', 'org.analyst']);
      expect([...result].sort()).toEqual(['Agent:Read', 'Agent:Update', 'Analytics:Read']);
    });

    it('dedupes an overlapping grant rather than treating it as an error', () => {
      // Both roles grant Agent:Read.
      const result = service.resolvePermissions(['org.owner', 'org.analyst']);
      expect([...result].filter((p) => p === 'Agent:Read')).toHaveLength(1);
    });

    it('returns an empty set for no roles', () => {
      expect(service.resolvePermissions([]).size).toBe(0);
    });

    /** A role removed from the catalog must never lock its holders out. */
    it('ignores an unknown role key instead of throwing', () => {
      const result = service.resolvePermissions(['org.owner', 'role.deleted.last.week']);
      expect([...result].sort()).toEqual(['Agent:Read', 'Agent:Update']);
    });

    it('is order-independent', () => {
      const a = service.resolvePermissions(['org.owner', 'org.analyst']);
      const b = service.resolvePermissions(['org.analyst', 'org.owner']);
      expect([...a].sort()).toEqual([...b].sort());
    });

    it('memoizes by role set', () => {
      const a = service.resolvePermissions(['org.owner']);
      const b = service.resolvePermissions(['org.owner']);
      expect(a).toBe(b);
    });
  });

  describe('filtered listings', () => {
    beforeEach(() => service.onModuleInit());

    it('listOrgAllowedRoles excludes platform roles', () => {
      expect(service.listOrgAllowedRoles().map((r) => r.key).sort()).toEqual([
        'org.analyst',
        'org.owner',
      ]);
    });

    it('listClientGrantableRoles excludes org.owner, which orgs may hold but not grant', () => {
      expect(service.listClientGrantableRoles().map((r) => r.key)).toEqual(['org.analyst']);
    });
  });

  describe('refresh', () => {
    beforeEach(() => service.onModuleInit());

    it('keeps the previous snapshot when a later refresh fails', async () => {
      mockPrisma.appRole.findMany.mockRejectedValue(new Error('transient'));

      // Must not throw: emptying the catalog would deny every request in the app.
      await expect(service.refresh()).resolves.toBeUndefined();
      expect(service.size).toBe(3);
      expect(service.resolvePermissions(['org.owner']).size).toBe(2);
    });

    it('drops the memoized unions when definitions change', async () => {
      const before = service.resolvePermissions(['org.owner']);
      expect([...before].sort()).toEqual(['Agent:Read', 'Agent:Update']);

      mockPrisma.appRole.findMany.mockResolvedValue([
        { ...ROLES[0], permissions: [{ permissionKey: 'Agent:Read' }] },
      ]);
      await service.refresh();

      expect([...service.resolvePermissions(['org.owner'])]).toEqual(['Agent:Read']);
    });

    it('shares one in-flight load between concurrent callers', async () => {
      mockPrisma.appRole.findMany.mockClear();
      mockPrisma.permission.findMany.mockClear();

      await Promise.all([service.refresh(), service.refresh(), service.refresh()]);

      expect(mockPrisma.appRole.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
