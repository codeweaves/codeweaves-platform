'use client';

import { useProfile } from '@/hooks/use-profile';
export type { Role } from '@/hooks/use-profile';

export function useCurrentRole() {
  const { profile, isLoading } = useProfile();

  const role = profile?.role ?? null;

  return {
    role,
    isLoading,
    isSuperAdmin: role === 'SUPER_ADMIN',
    isAdmin: role === 'ADMIN',
    isClient: role === 'CLIENT',
  };
}
