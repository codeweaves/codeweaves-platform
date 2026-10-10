import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AccessScope, Role } from "@prisma/client";
import { PermissionGuard } from "../../../src/guards/permission.guard";
import type { PermissionCatalogService } from "../../../src/common/rbac/permission-catalog.service";
import type { CurrentUserData } from "../../../src/decorators/current-user.decorator";

/**
 * Mirrors the seeded grants that matter here: AuditLog:Read sits on
 * platform.super_admin and platform.ops only. Every org role lacks it.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  "platform.super_admin": ["AuditLog:Read", "Organization:ReadAll"],
  "platform.ops": ["AuditLog:Read", "Organization:ReadAll"],
  "platform.support": ["Organization:ReadAll"],
  "org.owner": ["Agent:Read", "Analytics:Read"],
};

export function realPermissionGuard(): PermissionGuard {
  const catalog = {
    resolvePermissions: (roleKeys: readonly string[]) =>
      new Set(roleKeys.flatMap((k) => ROLE_PERMISSIONS[k] ?? [])),
  } as unknown as PermissionCatalogService;
  return new PermissionGuard(new Reflector(), catalog);
}

/** An ExecutionContext pointing at a real controller handler. */
export function contextFor(
  controller: new (...args: never[]) => unknown,
  handler: (...args: never[]) => unknown,
  user: CurrentUserData,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

export const platformOps: CurrentUserData = {
  clerkId: "clerk_ops",
  email: "ops@test.com",
  id: "ops-id",
  role: Role.ADMIN,
  accessScope: AccessScope.PLATFORM,
  roleKeys: ["platform.ops"],
  organizationId: null,
  organization: null,
};

export const orgOwner: CurrentUserData = {
  clerkId: "clerk_owner",
  email: "owner@acme.test",
  id: "owner-id",
  role: Role.CLIENT,
  accessScope: AccessScope.ORG,
  roleKeys: ["org.owner"],
  organizationId: "org-1",
  organization: { id: "org-1", name: "Acme", slug: "acme" },
};

/** An org-scoped account that was (wrongly) granted AuditLog:Read. */
export const misGrantedOrgUser: CurrentUserData = {
  ...orgOwner,
  roleKeys: ["org.owner", "platform.ops"],
};

export const platformSupport: CurrentUserData = {
  ...platformOps,
  roleKeys: ["platform.support"],
};
