'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface Agent {
  id: string;
  publicId: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  organizationId: string;
  organization?: { id: string; name: string };
  systemPrompt: string | null;
  welcomeMessage: string | null;
  allowedDomains: string[];
  voiceEnabled: boolean;
  voiceConfig: import('@repo/validation').VoiceConfigDto | null;
  /**
   * AI orchestration config: routing mode (n8n vs direct LLM), model selection,
   * sampling, context strategy. Stored as a JSONB blob on the agent row.
   * Null or absent means "use n8n defaults" — agents pre-dating the direct-mode
   * epic are grandfathered as n8n-mode.
   */
  aiConfig: import('@repo/validation').AgentAiConfigDto | null;
  /** Category labels used by the post-session classifier; empty disables it. */
  categoryKeywords: string[];
  /** ISO 639-1 codes + `hinglish`; empty disables language detection. */
  supportedLanguages: string[];
  /** Max chat-session lifetime from createdAt, in hours. 6-24, default 6. */
  sessionLifetimeHours: number;
  /** Phrases the agent replies with when it can't answer; empty disables tracking. */
  fallbackPhrases: string[];
  /** Human handover (live agent takeover). */
  humanTakeoverEnabled: boolean;
  showTalkToHumanButton: boolean;
  humanConnectedLabel: string | null;
  /** Email the team on a handover request. Recipients empty = whole org. */
  handoverEmailEnabled: boolean;
  handoverEmailRecipients: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAgents {
  data: Agent[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AgentListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  organizationId?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export function useAgents(params: AgentListParams = {}) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.limit) queryParams.set('limit', String(params.limit));
  if (params.search) queryParams.set('search', params.search);
  if (params.status) queryParams.set('status', params.status);
  if (params.organizationId) queryParams.set('organizationId', params.organizationId);
  if (params.sortBy) queryParams.set('sortBy', params.sortBy);
  if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);

  const queryString = queryParams.toString();
  const endpoint = `/agents${queryString ? `?${queryString}` : ''}`;

  return useQuery<PaginatedAgents>({
    queryKey: ['agents', params],
    queryFn: () => api.get(endpoint),
    enabled: isAuthenticated && !authLoading,
  });
}

export function useAgent(id: string) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<Agent>({
    queryKey: ['agents', id],
    queryFn: () => api.get(`/agents/${id}`),
    enabled: isAuthenticated && !authLoading && !!id,
  });
}

export function useCreateAgent() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Agent, Error, { name: string; organizationId: string }>({
    mutationFn: (data) => api.post('/agents', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgent() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/agents/${id}`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', variables.id] });
      // Toggling human takeover changes whether the Inbox has anything to show.
      queryClient.invalidateQueries({ queryKey: ['handover', 'enabled'] });
    },
  });
}

export function useDeleteAgent() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<null, Error, string>({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
