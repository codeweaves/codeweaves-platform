'use client';

import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/config/api';

export function useHealthCheck() {
  const { data, isLoading, error, isSuccess, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/public/health'));
      if (!res.ok) throw new Error('API unavailable');
      return res.json();
    },
    retry: 5,
    retryDelay: 3000,
    staleTime: 1000 * 60,
  });

  return { isReady: isSuccess, isLoading, error, data, refetch };
}
