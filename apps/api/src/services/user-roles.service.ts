import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AccessScope, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { PermissionCatalogService } from '../common/rbac/permission-catalog.service';
import { TracerService } from '../common/tracer/tracer.service';
import { UserSyncGuard } from '../guards/user-sync.guard';
import { AppLogger } from '../common/logger/app-logger';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import type {
  RoleView,
  UserDetail,
  UserListItem,
  UserListQuery,
} from '../models/rbac.dto';

/** Role keys with meaning to the grant rules. */
const SUPER_ADMIN = 'platform.super_admin';
const PLATFORM_OPS = 'platform.ops';

@Injectable()
export class UserRolesService {
  private readonly log = new AppLogger(UserRolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PermissionCatalogService,
    private readonly tracer: TracerService,
    private readonly userSync: UserSyncGuard,
  ) {}

  private holds(actor: CurrentUserData, roleKey: string): boolean {
    return (actor.roleKeys ?? []).includes(roleKey);
  }

  // ---------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------

  /**
   * The role list this caller may hand out.
   *
   * Filtering happens HERE rather than in the UI: hiding a checkbox client-side
   * would still ship every internal role name in the response body.
   *
   * Only platform staff can grant anything today. The filter is kept rather than
   * hard-coded to super admin so re-opening role assignment to customers is a
   * catalog change, not a code change.
   */
  async listAssignableRoles(actor: CurrentUserData): Promise<RoleView[]> {
    const roles = await this.catalog.listRolesFresh();

    let visible: readonly RoleView[];
    if (this.holds(actor, SUPER_ADMIN) || this.holds(actor, PLATFORM_OPS)) {
      visible = roles;
    } else {
      visible = [];
    }

    return visible.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      orgAllowed: r.orgAllowed,
      clientGrantable: r.clientGrantable,
      permissions: r.permissions,
    }));
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async listUsers(actor: CurrentUserData, query: UserListQuery) {
    const { page, limit, search, organizationId, accessScope } = query;

    // An ORG-scope caller only ever sees their own organization, whatever they
    // pass. A PLATFORM caller may narrow to one org.
    const orgFilter =
      actor.accessScope === AccessScope.ORG
        ? { organizationId: actor.organizationId }
        : organizationId
          ? { organizationId }
          : {};

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...orgFilter,
      ...(accessScope && { accessScope }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          roleAssignments: { where: { deletedAt: null }, select: { roleKey: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const data: UserListItem[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      accessScope: u.accessScope,
      organization: u.organization,
      roleKeys: u.roleAssignments.map((a) => a.roleKey),
      createdAt: u.createdAt,
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUser(actor: CurrentUserData, userId: string): Promise<UserDetail> {
    const user = await this.findVisibleUser(actor, userId);
    const roleKeys = user.roleAssignments.map((a) => a.roleKey);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      accessScope: user.accessScope,
      organization: user.organization,
      roleKeys,
      createdAt: user.createdAt,
      // Derived, never stored. This is the answer to "why can this person do X",
      // and the reason permissions are not assignable individually.
      permissions: [...this.catalog.resolvePermissions(roleKeys)].sort(),
    };
  }

  /**
   * Resolve a target the actor is allowed to see. A caller acting outside their
   * own organization gets 404 rather than 403 — a 403 would confirm the account
   * exists, which is an enumeration oracle.
   */
  private async findVisibleUser(actor: CurrentUserData, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        ...(actor.accessScope === AccessScope.ORG && {
          organizationId: actor.organizationId,
        }),
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        roleAssignments: { where: { deletedAt: null }, select: { roleKey: true } },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ---------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------

  /**
   * Replace a user's role set.
   *
   * Every invariant that keeps this from becoming a privilege-escalation surface
   * lives here; see the numbered comments. The DB triggers from the RBAC
   * migration are the backstop underneath, not a substitute.
   */
  async setRoles(
    actor: CurrentUserData,
    targetUserId: string,
    roleKeys: string[],
  ): Promise<UserDetail> {
    // (1) No self-modification. Nobody edits their own grants except a super
    // admin, who could grant themselves anything anyway.
    if (actor.id === targetUserId && !this.holds(actor, SUPER_ADMIN)) {
      throw new ForbiddenException('You cannot change your own roles');
    }

    // (4) Org containment: 404, not 403, for a target outside the caller's org.
    const target = await this.findVisibleUser(actor, targetUserId);
    const before = target.roleAssignments.map((a) => a.roleKey).sort();

    // Every key must exist in the catalog.
    const unknown = roleKeys.filter((k) => !this.catalog.getRole(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown role(s): ${unknown.join(', ')}`);
    }

    // (2, 3) The caller may only grant roles their own standing allows, taken
    // from the same filtered catalog the dialog renders — so the UI and the
    // enforcement can never disagree.
    const grantable = new Set((await this.listAssignableRoles(actor)).map((r) => r.key));
    const forbidden = roleKeys.filter((k) => !grantable.has(k));
    if (forbidden.length > 0) {
      this.log.warn('setRoles', 'grant denied — role not assignable by actor', {
        actorId: actor.id,
        targetUserId,
        forbidden,
      });
      throw new ForbiddenException(
        `You cannot assign: ${forbidden.join(', ')}`,
      );
    }

    // An ORG-scope account can only hold org-allowed roles. The assignment
    // trigger enforces this too; failing here gives a usable message instead of
    // a raw database error.
    if (target.accessScope === AccessScope.ORG) {
      const platformOnly = roleKeys.filter((k) => !this.catalog.getRole(k)?.orgAllowed);
      if (platformOnly.length > 0) {
        throw new BadRequestException(
          `Not available to organization users: ${platformOnly.join(', ')}`,
        );
      }
    }

    const after = [...roleKeys].sort();
    const added = after.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !after.includes(k));

    if (added.length === 0 && removed.length === 0) {
      return this.getUser(actor, targetUserId);
    }

    // Replace in one transaction so a partial write cannot leave a user with no
    // roles between the delete and the insert.
    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { userId: targetUserId } });
      await tx.userRoleAssignment.createMany({
        data: after.map((roleKey) => ({
          userId: targetUserId,
          roleKey,
          organizationId:
            target.accessScope === AccessScope.ORG ? target.organizationId : null,
          grantedBy: actor.id,
        })),
      });
    });

    // (8) Accountability: who changed whose roles, from what to what.
    await this.tracer.logAuditEvent(
      targetUserId,
      'USER_ROLES_UPDATED',
      {
        actorUserId: actor.id,
        targetUserId,
        before,
        after,
        added,
        removed,
      },
      { organizationId: target.organizationId ?? undefined },
    );

    // (9) Drop the target's cached entry so the change is effective immediately
    // rather than after the 60s UserSyncGuard TTL.
    this.userSync.evict(target.clerkId);

    this.log.info('setRoles', 'roles updated', {
      actorId: actor.id,
      targetUserId,
      added,
      removed,
    });

    return this.getUser(actor, targetUserId);
  }

  /**
   * Change a user's access scope. Super admin only, and deliberately a separate
   * endpoint from the role dialog: scope decides which rows an account can
   * reach, so it must never be a stray checkbox.
   */
  async setAccessScope(
    actor: CurrentUserData,
    targetUserId: string,
    accessScope: AccessScope,
  ): Promise<UserDetail> {
    if (!this.holds(actor, SUPER_ADMIN)) {
      throw new ForbiddenException('Only a super admin can change access scope');
    }
    if (actor.id === targetUserId) {
      throw new ForbiddenException('You cannot change your own access scope');
    }

    const target = await this.findVisibleUser(actor, targetUserId);
    if (target.accessScope === accessScope) {
      return this.getUser(actor, targetUserId);
    }

    if (accessScope === AccessScope.ORG && !target.organizationId) {
      throw new BadRequestException(
        'Assign the user to an organization before scoping them to it',
      );
    }

    // Narrowing to ORG strands any platform role they hold, and the assignment
    // trigger would reject the scope change outright. Clear them in the same
    // transaction so the account lands in a coherent state.
    const currentKeys = target.roleAssignments.map((a) => a.roleKey);
    const keptKeys =
      accessScope === AccessScope.ORG
        ? currentKeys.filter((k) => this.catalog.getRole(k)?.orgAllowed)
        : currentKeys;
    const droppedKeys = currentKeys.filter((k) => !keptKeys.includes(k));

    await this.prisma.$transaction(async (tx) => {
      if (droppedKeys.length > 0) {
        await tx.userRoleAssignment.deleteMany({
          where: { userId: targetUserId, roleKey: { in: droppedKeys } },
        });
      }
      await tx.user.update({
        where: { id: targetUserId },
        data: { accessScope },
      });
    });

    await this.tracer.logAuditEvent(
      targetUserId,
      'USER_ACCESS_SCOPE_UPDATED',
      {
        actorUserId: actor.id,
        targetUserId,
        before: target.accessScope,
        after: accessScope,
        droppedRoleKeys: droppedKeys,
      },
      { organizationId: target.organizationId ?? undefined },
    );

    this.userSync.evict(target.clerkId);

    this.log.info('setAccessScope', 'access scope updated', {
      actorId: actor.id,
      targetUserId,
      before: target.accessScope,
      after: accessScope,
      droppedRoleKeys: droppedKeys,
    });

    return this.getUser(actor, targetUserId);
  }
}
