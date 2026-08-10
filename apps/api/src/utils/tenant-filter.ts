import { ForbiddenException } from '@nestjs/common';
import { AccessScope } from '@prisma/client';

export interface TenantFilterUser {
  accessScope: AccessScope;
  organizationId: string | null;
}

export type TenantFilter =
  | { organizationId: string; deletedAt: null }
  | { deletedAt: null };

/**
 * Is this account confined to a single organization?
 *
 * The one place tenant scope is decided. Every query that narrows rows by
 * organization should ask this rather than comparing roles, so "which rows" and
 * "which actions" stay separate concerns: a user can gain or lose roles without
 * that ever changing what data they can see.
 */
export function isOrgScoped(user: TenantFilterUser): boolean {
  return user.accessScope === AccessScope.ORG;
}

/**
 * Build a Prisma where-clause fragment that enforces tenant isolation.
 *
 * - ORG scope: { organizationId, deletedAt: null }, throwing when no org is set
 * - PLATFORM scope: { deletedAt: null }, i.e. every organization
 *
 * Always excludes soft-deleted records.
 */
export function buildTenantFilter(user: TenantFilterUser): TenantFilter {
  if (!isOrgScoped(user)) {
    return { deletedAt: null };
  }

  if (!user.organizationId) {
    throw new ForbiddenException(
      'Client user must be associated with an organization',
    );
  }

  return { organizationId: user.organizationId, deletedAt: null };
}
