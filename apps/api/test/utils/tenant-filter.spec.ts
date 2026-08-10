import { ForbiddenException } from '@nestjs/common';
import { AccessScope } from '@prisma/client';
import { buildTenantFilter } from '../../src/utils/tenant-filter';

describe('Tenant Filter Utility', () => {
  describe('buildTenantFilter', () => {
    it('should return organizationId filter for an ORG-scoped user with an org', () => {
      const user = { accessScope: AccessScope.ORG, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ organizationId: 'org-uuid-1', deletedAt: null });
    });

    it('should throw ForbiddenException for an ORG-scoped user without an org', () => {
      const user = { accessScope: AccessScope.ORG, organizationId: null };
      expect(() => buildTenantFilter(user)).toThrow(ForbiddenException);
      expect(() => buildTenantFilter(user)).toThrow(
        'Client user must be associated with an organization',
      );
    });

    it('should return deletedAt-only filter for a PLATFORM-scoped user', () => {
      const user = { accessScope: AccessScope.PLATFORM, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for a PLATFORM-scoped user without organizationId', () => {
      const user = { accessScope: AccessScope.PLATFORM, organizationId: null };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for a PLATFORM-scoped super admin', () => {
      const user = { accessScope: AccessScope.PLATFORM, organizationId: null };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for a PLATFORM-scoped super admin with organizationId', () => {
      const user = { accessScope: AccessScope.PLATFORM, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should produce a filter spreadable into Prisma where clause', () => {
      const user = { accessScope: AccessScope.ORG, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      const where = { ...filter, active: true };
      expect(where).toEqual({
        organizationId: 'org-uuid-1',
        deletedAt: null,
        active: true,
      });
    });

    it('should produce deletedAt-only spread for a PLATFORM-scoped user/SUPER_ADMIN', () => {
      const user = { accessScope: AccessScope.PLATFORM, organizationId: null };
      const filter = buildTenantFilter(user);
      const where = { ...filter, active: true };
      expect(where).toEqual({ deletedAt: null, active: true });
    });
  });
});
