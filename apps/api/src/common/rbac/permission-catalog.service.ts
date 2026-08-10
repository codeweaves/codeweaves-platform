import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../services/prisma.service';
import { AppLogger } from '../logger/app-logger';

export interface RoleDefinition {
  key: string;
  name: string;
  description: string | null;
  orgAllowed: boolean;
  clientGrantable: boolean;
  permissions: readonly string[];
}

export interface PermissionDefinition {
  key: string;
  resource: string;
  action: string;
  description: string | null;
  orgAllowed: boolean;
}

/**
 * In-memory mirror of the roles/permissions tables.
 *
 * The catalog is small (tens of rows), changes only by migration, and is read on
 * every authorized request — so it is loaded once at boot and refreshed on a
 * long TTL rather than queried per request. That keeps authorization at zero
 * extra database round trips regardless of traffic.
 *
 * A refresh failure keeps the previous snapshot. Serving slightly stale
 * permissions beats failing every request in the app because one query timed
 * out; the data only changes on deploy anyway.
 */
@Injectable()
export class PermissionCatalogService implements OnModuleInit {
  private readonly log = new AppLogger(PermissionCatalogService.name);

  static readonly REFRESH_INTERVAL_MS = 5 * 60_000;

  private roles = new Map<string, RoleDefinition>();
  private permissions = new Map<string, PermissionDefinition>();
  private permissionsByRoleSet = new Map<string, ReadonlySet<string>>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Reload from the database. Concurrent callers share one in-flight load. */
  async refresh(): Promise<void> {
    if (this.loading) return this.loading;

    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const [roles, permissions] = await Promise.all([
        this.prisma.appRole.findMany({
          include: { permissions: { select: { permissionKey: true } } },
        }),
        this.prisma.permission.findMany(),
      ]);

      const nextRoles = new Map<string, RoleDefinition>();
      for (const role of roles) {
        nextRoles.set(role.key, {
          key: role.key,
          name: role.name,
          description: role.description,
          orgAllowed: role.orgAllowed,
          clientGrantable: role.clientGrantable,
          permissions: Object.freeze(role.permissions.map((p) => p.permissionKey)),
        });
      }

      const nextPermissions = new Map<string, PermissionDefinition>();
      for (const permission of permissions) {
        nextPermissions.set(permission.key, {
          key: permission.key,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
          orgAllowed: permission.orgAllowed,
        });
      }

      this.roles = nextRoles;
      this.permissions = nextPermissions;
      // Memoized unions are keyed by role set, so they must be dropped whenever
      // the underlying role definitions change.
      this.permissionsByRoleSet = new Map();
      this.loadedAt = Date.now();

      this.log.info('load', 'permission catalog loaded', {
        roles: nextRoles.size,
        permissions: nextPermissions.size,
      });
    } catch (error) {
      // Keep the previous snapshot rather than emptying the catalog, which would
      // deny every request in the app.
      this.log.error('load', 'permission catalog refresh failed, keeping previous snapshot', error, {
        hasSnapshot: this.roles.size > 0,
      });
      if (this.roles.size === 0) throw error;
    }
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.loadedAt > PermissionCatalogService.REFRESH_INTERVAL_MS) {
      await this.refresh();
    }
  }

  /**
   * Union of the permissions granted by every role held. Overlapping roles
   * dedupe here, which is what makes the model additive: holding two roles that
   * both grant Agent:Update is not an error, it is the normal case.
   *
   * Unknown role keys are skipped and logged rather than throwing. A role
   * removed from the catalog must never lock its holders out of the app.
   */
  resolvePermissions(roleKeys: readonly string[]): ReadonlySet<string> {
    if (roleKeys.length === 0) return EMPTY_PERMISSIONS;

    const cacheKey = [...roleKeys].sort().join('|');
    const cached = this.permissionsByRoleSet.get(cacheKey);
    if (cached) return cached;

    const resolved = new Set<string>();
    for (const roleKey of roleKeys) {
      const role = this.roles.get(roleKey);
      if (!role) {
        this.log.warn('resolvePermissions', 'unknown role key ignored', { roleKey });
        continue;
      }
      for (const permission of role.permissions) resolved.add(permission);
    }

    const frozen: ReadonlySet<string> = resolved;
    this.permissionsByRoleSet.set(cacheKey, frozen);
    return frozen;
  }

  getRole(key: string): RoleDefinition | undefined {
    return this.roles.get(key);
  }

  getPermission(key: string): PermissionDefinition | undefined {
    return this.permissions.get(key);
  }

  /** Every role, unfiltered. Callers serving this to a user must filter it. */
  listRoles(): readonly RoleDefinition[] {
    return [...this.roles.values()];
  }

  listPermissions(): readonly PermissionDefinition[] {
    return [...this.permissions.values()];
  }

  /** Roles marked grantable to customers: org-allowed AND client-grantable. */
  listClientGrantableRoles(): readonly RoleDefinition[] {
    return this.listRoles().filter((r) => r.orgAllowed && r.clientGrantable);
  }

  /** Roles an ORG-scope account may hold at all, grantable by a manager or not. */
  listOrgAllowedRoles(): readonly RoleDefinition[] {
    return this.listRoles().filter((r) => r.orgAllowed);
  }

  /** Awaits a TTL refresh when needed. Use on admin reads, not the hot path. */
  async listRolesFresh(): Promise<readonly RoleDefinition[]> {
    await this.ensureFresh();
    return this.listRoles();
  }

  get size(): number {
    return this.roles.size;
  }
}

const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set<string>();
