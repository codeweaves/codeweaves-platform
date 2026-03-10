import { Role } from '@prisma/client';
import { Resource, Action, PermissionKey } from './rbac.types';

const ALL_ROLES: readonly Role[] = Object.freeze([
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.CLIENT,
]);
const ADMIN_AND_ABOVE: readonly Role[] = Object.freeze([
  Role.SUPER_ADMIN,
  Role.ADMIN,
]);

/**
 * Permission matrix mapping every Resource:Action combination to allowed roles.
 * Frozen at module load to prevent runtime mutation of this security-critical structure.
 *
 * - SUPER_ADMIN: all permissions (platform-wide)
 * - ADMIN: all permissions (org-scoped enforcement is in TenantGuard)
 * - CLIENT: limited read/update on own resources only
 */
export const PERMISSION_MATRIX: Readonly<Record<PermissionKey, readonly Role[]>> =
  Object.freeze({
    // User
    'User:Create': ADMIN_AND_ABOVE,
    'User:Read': ALL_ROLES,
    'User:ReadAll': ADMIN_AND_ABOVE,
    'User:Update': ALL_ROLES,
    'User:Delete': ADMIN_AND_ABOVE,
    'User:Export': ADMIN_AND_ABOVE,

    // Organization
    'Organization:Create': ADMIN_AND_ABOVE,
    'Organization:Read': ALL_ROLES,
    'Organization:ReadAll': ADMIN_AND_ABOVE,
    'Organization:Update': ADMIN_AND_ABOVE,
    'Organization:Delete': ADMIN_AND_ABOVE,
    'Organization:Export': ADMIN_AND_ABOVE,

    // Agent
    'Agent:Create': ADMIN_AND_ABOVE,
    'Agent:Read': ALL_ROLES,
    'Agent:ReadAll': ALL_ROLES,
    'Agent:Update': ADMIN_AND_ABOVE,
    'Agent:Delete': ADMIN_AND_ABOVE,
    'Agent:Export': ADMIN_AND_ABOVE,

    // AgentTheme
    'AgentTheme:Create': ADMIN_AND_ABOVE,
    'AgentTheme:Read': ALL_ROLES,
    'AgentTheme:ReadAll': ADMIN_AND_ABOVE,
    'AgentTheme:Update': ADMIN_AND_ABOVE,
    'AgentTheme:Delete': ADMIN_AND_ABOVE,
    'AgentTheme:Export': ADMIN_AND_ABOVE,

    // AgentSecret
    'AgentSecret:Create': ADMIN_AND_ABOVE,
    'AgentSecret:Read': ADMIN_AND_ABOVE,
    'AgentSecret:ReadAll': ADMIN_AND_ABOVE,
    'AgentSecret:Update': ADMIN_AND_ABOVE,
    'AgentSecret:Delete': ADMIN_AND_ABOVE,
    'AgentSecret:Export': ADMIN_AND_ABOVE,

    // ChatSession
    'ChatSession:Create': ADMIN_AND_ABOVE,
    'ChatSession:Read': ALL_ROLES,
    'ChatSession:ReadAll': ALL_ROLES,
    'ChatSession:Update': ADMIN_AND_ABOVE,
    'ChatSession:Delete': ADMIN_AND_ABOVE,
    'ChatSession:Export': ADMIN_AND_ABOVE,

    // ChatMessage
    'ChatMessage:Create': ADMIN_AND_ABOVE,
    'ChatMessage:Read': ALL_ROLES,
    'ChatMessage:ReadAll': ADMIN_AND_ABOVE,
    'ChatMessage:Update': ADMIN_AND_ABOVE,
    'ChatMessage:Delete': ADMIN_AND_ABOVE,
    'ChatMessage:Export': ADMIN_AND_ABOVE,

    // Analytics
    'Analytics:Create': ADMIN_AND_ABOVE,
    'Analytics:Read': ALL_ROLES,
    'Analytics:ReadAll': ADMIN_AND_ABOVE,
    'Analytics:Update': ADMIN_AND_ABOVE,
    'Analytics:Delete': ADMIN_AND_ABOVE,
    'Analytics:Export': ADMIN_AND_ABOVE,

    // AuditLog
    'AuditLog:Create': ADMIN_AND_ABOVE,
    'AuditLog:Read': ALL_ROLES,
    'AuditLog:ReadAll': ADMIN_AND_ABOVE,
    'AuditLog:Update': ADMIN_AND_ABOVE,
    'AuditLog:Delete': ADMIN_AND_ABOVE,
    'AuditLog:Export': ADMIN_AND_ABOVE,

    // Invitation
    'Invitation:Create': ADMIN_AND_ABOVE,
    'Invitation:Read': ADMIN_AND_ABOVE,
    'Invitation:ReadAll': ADMIN_AND_ABOVE,
    'Invitation:Update': ADMIN_AND_ABOVE,
    'Invitation:Delete': ADMIN_AND_ABOVE,
    'Invitation:Export': ADMIN_AND_ABOVE,

    // File
    'File:Create': ADMIN_AND_ABOVE,
    'File:Read': ADMIN_AND_ABOVE,
    'File:ReadAll': ADMIN_AND_ABOVE,
    'File:Update': ADMIN_AND_ABOVE,
    'File:Delete': ADMIN_AND_ABOVE,
    'File:Export': ADMIN_AND_ABOVE,
  });

/** Pre-computed role-to-permissions lookup for O(1) access */
const ROLE_PERMISSIONS_MAP: ReadonlyMap<Role, readonly PermissionKey[]> =
  new Map(
    Object.values(Role).map((role) => [
      role,
      Object.freeze(
        (
          Object.entries(PERMISSION_MATRIX) as [
            PermissionKey,
            readonly Role[],
          ][]
        )
          .filter(([, roles]) => roles.includes(role))
          .map(([key]) => key),
      ),
    ]),
  );

export function hasPermission(
  role: Role,
  resource: Resource,
  action: Action,
): boolean {
  const key: PermissionKey = `${resource}:${action}`;
  const allowedRoles = PERMISSION_MATRIX[key];
  return allowedRoles.includes(role);
}

export function getPermissionsForRole(role: Role): readonly PermissionKey[] {
  return ROLE_PERMISSIONS_MAP.get(role) ?? [];
}
