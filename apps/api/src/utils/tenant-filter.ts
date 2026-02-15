import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface TenantFilterUser {
  role: Role;
  organizationId: string | null;
}

export type TenantFilter =
  | { organizationId: string; deletedAt: null }
  | { deletedAt: null };

/**
 * Build a Prisma where-clause fragment that enforces tenant isolation.
 *
 * - CLIENT: returns { organizationId, deletedAt: null } (throws if no org)
 * - ADMIN / SUPER_ADMIN: returns { deletedAt: null } (no org filter, sees all)
 *
 * Always excludes soft-deleted records.
 */
export function buildTenantFilter(user: TenantFilterUser): TenantFilter {
  if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
    return { deletedAt: null };
  }

  if (!user.organizationId) {
    throw new ForbiddenException(
      'Client user must be associated with an organization',
    );
  }

  return { organizationId: user.organizationId, deletedAt: null };
}
