'use client';

import { useMemo } from 'react';
import { useProfile } from '@/hooks/use-profile';

/**
 * A permission key as the API defines it, e.g. `Agent:Update`.
 *
 * Deliberately a plain string rather than a generated union: the catalog lives
 * in the database, so the browser has no compile-time knowledge of it. The
 * server is the authority, and `RouteAuthorizationAssertion` catches a typo on
 * the API side at boot. A typo here fails closed — the check simply returns
 * false — which is the safe direction.
 */
export type PermissionKey = string;

/**
 * Reads the permission set the API computed for the current user.
 *
 * The browser never re-implements an authorization rule. It asks whether a
 * permission is present and renders accordingly. This replaced six inline
 * `profile.role === 'SUPER_ADMIN'` comparisons that could drift out of step with
 * the API the moment a role's contents changed.
 *
 * Gating here is UX ONLY. The API is the boundary; hiding a button stops a
 * misclick, not an attacker.
 */
export function usePermissions() {
  const { profile, isLoading } = useProfile();

  const granted = useMemo(
    () => new Set(profile?.permissions ?? []),
    [profile?.permissions],
  );

  return useMemo(
    () => ({
      isLoading,
      /** Does the current user hold this permission? */
      can: (permission: PermissionKey) => granted.has(permission),
      /** Any one of these. Use for a nav item that several permissions unlock. */
      canAny: (...permissions: PermissionKey[]) =>
        permissions.some((p) => granted.has(p)),
      /** All of these. */
      canAll: (...permissions: PermissionKey[]) =>
        permissions.every((p) => granted.has(p)),
      /** True when this account can see beyond its own organization. */
      isPlatform: profile?.accessScope === 'PLATFORM',
      roleKeys: profile?.roleKeys ?? [],
      permissions: granted,
    }),
    [granted, isLoading, profile?.accessScope, profile?.roleKeys],
  );
}
