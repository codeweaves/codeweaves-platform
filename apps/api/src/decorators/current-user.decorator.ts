import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessScope, Role } from '@prisma/client';

export interface CurrentUserData {
  // From JWT (Clerk)
  clerkId: string;
  email: string;

  // From database (populated by UserSyncGuard)
  id: string;
  /**
   * DEPRECATED for authorization. Kept because invitations still carry it.
   * Use `accessScope` to decide which rows are visible and `roleKeys` (or the
   * PermissionGuard) to decide which actions are allowed.
   */
  role: Role;
  /** Which rows this account may touch: PLATFORM = all orgs, ORG = its own. */
  accessScope: AccessScope;
  /** Roles held. Resolve to permissions via PermissionCatalogService. */
  roleKeys: string[];
  organizationId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    return data ? user?.[data] : user;
  },
);
