'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WidgetTheme } from '@repo/validation';
import { useApiClient } from '@/lib/api-client';

interface ThemeResponse {
  config: WidgetTheme;
  version: number;
}

export function useUpdateAgentTheme() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<
    ThemeResponse,
    Error,
    { agentId: string; config: WidgetTheme }
  >({
    mutationFn: ({ agentId, config }) =>
      api.put(`/agents/${agentId}/theme`, config),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-theme', agentId] });
    },
  });
}

export function useResetAgentTheme() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ThemeResponse, Error, { agentId: string }>({
    mutationFn: ({ agentId }) =>
      api.post(`/agents/${agentId}/theme/reset`),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-theme', agentId] });
    },
  });
}
