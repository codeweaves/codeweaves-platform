'use client';

import { useProfile } from '@/hooks/use-profile';

export function useCurrentOrganization() {
  const { profile, isLoading, error, refetch } = useProfile();

  return {
    organization: profile?.organization ?? null,
    isLoading,
    error,
    refetch,
  };
}
