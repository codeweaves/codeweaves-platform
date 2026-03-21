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
