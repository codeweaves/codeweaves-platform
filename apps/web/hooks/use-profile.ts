'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'CLIENT';

/** Which rows this account may touch. PLATFORM sees every org, ORG sees its own. */
export type AccessScope = 'PLATFORM' | 'ORG';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  /**
   * Legacy. Do not gate on this. Use `usePermissions().can(...)`, which reads
   * the server-computed permission set below.
   */
  role: Role;
  accessScope: AccessScope;
  roleKeys: string[];
  /** Everything the held roles add up to, computed by the API. */
  permissions: string[];
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export function useProfile() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const { data: profile, isLoading, error, refetch } = useQuery<UserProfile>({
    queryKey: ['profile'],
    queryFn: () => api.get('/auth/users/me'),
    enabled: isAuthenticated && !authLoading,
    // This response carries the permission set every gate in the UI reads, so it
    // overrides the global 5-minute staleTime. Without this, a revoked role kept
    // showing its sections for minutes: harmless (the API evicts its own cache on
    // the role change and rejects immediately) but it looks broken.
    //
    // Refetching on focus matters more here than elsewhere for the same reason:
    // coming back to the tab is exactly when someone's access may have changed.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return { profile: profile ?? null, isLoading: isLoading || authLoading, error, refetch };
}
