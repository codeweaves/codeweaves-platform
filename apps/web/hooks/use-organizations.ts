'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    users: number;
    agents: number;
  };
}

export interface PaginatedOrganizations {
  data: Organization[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface OrganizationListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'name' | 'slug' | 'createdAt' | 'usersCount' | 'agentsCount';
  sortOrder?: 'asc' | 'desc';
}

export function useOrganizations(
  params: OrganizationListParams = {},
  options: { enabled?: boolean } = {},
) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.limit) queryParams.set('limit', String(params.limit));
  if (params.search) queryParams.set('search', params.search);
  if (params.sortBy) queryParams.set('sortBy', params.sortBy);
  if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);

  const queryString = queryParams.toString();
  const endpoint = `/organizations${queryString ? `?${queryString}` : ''}`;

  // GET /organizations is ADMIN/SUPER_ADMIN only; callers can pass
  // enabled: false (e.g. for CLIENT users) to skip the doomed 403 request.
  const callerEnabled = options.enabled ?? true;

  return useQuery<PaginatedOrganizations>({
    queryKey: ['organizations', params],
    queryFn: () => api.get(endpoint),
    enabled: isAuthenticated && !authLoading && callerEnabled,
  });
}

export function useOrganization(id: string) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<Organization>({
    queryKey: ['organizations', id],
    queryFn: () => api.get(`/organizations/${id}`),
    enabled: isAuthenticated && !authLoading && !!id,
  });
}

export function useCreateOrganization() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; slug?: string }) =>
      api.post('/organizations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export interface DeleteOrganizationPreview {
  id: string;
  name: string;
  slug: string;
  activeAgentsCount: number;
  membersCount: number;
}

/**
 * Fetches the impact summary (active agent + member counts) shown in the
 * delete-confirmation dialog. Only fetched once `enabled` is true so the
 * request doesn't fire until the user opens the dialog.
 */
export function useOrganizationDeletePreview(id: string, enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<DeleteOrganizationPreview>({
    queryKey: ['organizations', id, 'delete-preview'],
    queryFn: () => api.get(`/organizations/${id}/delete-preview`),
    enabled: enabled && isAuthenticated && !authLoading && !!id,
    staleTime: 0,
  });
}

export interface DeleteOrganizationResult {
  id: string;
  name: string;
  cascadedAgents: number;
  cascadedUsers: number;
}

export interface UpdateOrganizationPayload {
  name?: string;
  slug?: string;
}

export function useUpdateOrganization() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Organization, Error, { id: string; data: UpdateOrganizationPayload }>({
    mutationFn: ({ id, data }) => api.patch(`/organizations/${id}`, data),
    onSuccess: () => {
      // Invalidate list + any cached single-org reads so the new name appears.
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export function useDeleteOrganization() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<DeleteOrganizationResult, Error, string>({
    mutationFn: (id: string) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      // Wipe both the list cache and any cached single-org reads.
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}
