'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  organization: {
    id: string;
    name: string;
  } | null;
}

export function useProfile() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const { data: profile, isLoading, error } = useQuery<UserProfile>({
    queryKey: ['profile'],
    queryFn: () => api.get('/auth/users/me'),
    enabled: isAuthenticated && !authLoading,
  });

  return { profile: profile ?? null, isLoading: isLoading || authLoading, error };
}
