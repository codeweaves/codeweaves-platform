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

export function useOrganizations(params: OrganizationListParams = {}) {
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

  return useQuery<PaginatedOrganizations>({
    queryKey: ['organizations', params],
    queryFn: () => api.get(endpoint),
    enabled: isAuthenticated && !authLoading,
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
