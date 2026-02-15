import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { buildTenantFilter } from '../../src/utils/tenant-filter';

describe('Tenant Filter Utility', () => {
  describe('buildTenantFilter', () => {
    it('should return organizationId filter for CLIENT with org', () => {
      const user = { role: Role.CLIENT, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ organizationId: 'org-uuid-1', deletedAt: null });
    });

    it('should throw ForbiddenException for CLIENT without organizationId', () => {
      const user = { role: Role.CLIENT, organizationId: null };
      expect(() => buildTenantFilter(user)).toThrow(ForbiddenException);
      expect(() => buildTenantFilter(user)).toThrow(
        'Client user must be associated with an organization',
      );
    });

    it('should return deletedAt-only filter for ADMIN', () => {
      const user = { role: Role.ADMIN, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for ADMIN without organizationId', () => {
      const user = { role: Role.ADMIN, organizationId: null };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for SUPER_ADMIN', () => {
      const user = { role: Role.SUPER_ADMIN, organizationId: null };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should return deletedAt-only filter for SUPER_ADMIN with organizationId', () => {
      const user = { role: Role.SUPER_ADMIN, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should produce a filter spreadable into Prisma where clause', () => {
      const user = { role: Role.CLIENT, organizationId: 'org-uuid-1' };
      const filter = buildTenantFilter(user);
      const where = { ...filter, active: true };
      expect(where).toEqual({
        organizationId: 'org-uuid-1',
        deletedAt: null,
        active: true,
      });
    });

    it('should produce deletedAt-only spread for ADMIN/SUPER_ADMIN', () => {
      const user = { role: Role.ADMIN, organizationId: null };
      const filter = buildTenantFilter(user);
      const where = { ...filter, active: true };
      expect(where).toEqual({ deletedAt: null, active: true });
    });
  });
});
