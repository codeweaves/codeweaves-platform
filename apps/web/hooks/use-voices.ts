'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import type { VoiceListResponseDto, VoicePreviewRequestDto } from '@repo/validation';

export function useVoices() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<VoiceListResponseDto>({
    queryKey: ['voices'],
    queryFn: async () => (await api.get('/voices')) as VoiceListResponseDto,
    enabled: isAuthenticated && !authLoading,
    staleTime: 60 * 60 * 1000,        // 1h — voice catalog is near-static
    gcTime: 24 * 60 * 60 * 1000,      // keep cached across editor opens within a day
  });
}

export interface VoicePreviewResult {
  audio: string; // base64
  format: string;
}

export function usePreviewVoice() {
  const api = useApiClient();
  return useCallback(
    async (params: VoicePreviewRequestDto): Promise<VoicePreviewResult> =>
      (await api.post('/voices/preview', params)) as VoicePreviewResult,
    [api],
  );
}
