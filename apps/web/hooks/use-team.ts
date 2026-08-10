'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import type { Role } from '@/hooks/use-profile';

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

export function useTeamMembers() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { organization } = useCurrentOrganization();
  const api = useApiClient();

  return useQuery<TeamMember[]>({
    queryKey: ['team-members', organization?.id],
    queryFn: () => api.get(`/organizations/${organization!.id}/members`),
    enabled: isAuthenticated && !authLoading && !!organization?.id,
  });
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED';

export interface InvitationListParams {
  page?: number;
  limit?: number;
  search?: string;
  /** Single status filter (legacy) */
  status?: InvitationStatus;
  /** Multi-status filter (sent comma-separated; combined with `status` server-side) */
  statuses?: InvitationStatus[];
  sortBy?: 'email' | 'status' | 'createdAt' | 'expiresAt';
  sortOrder?: 'asc' | 'desc';
}

export interface InvitationListResponse {
  data: Invitation[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function useInvitations(params: InvitationListParams = {}) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.limit) queryParams.set('limit', String(params.limit));
  if (params.search) queryParams.set('search', params.search);
  if (params.status) queryParams.set('status', params.status);
  if (params.statuses && params.statuses.length > 0) queryParams.set('statuses', params.statuses.join(','));
  if (params.sortBy) queryParams.set('sortBy', params.sortBy);
  if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);

  const qs = queryParams.toString();

  return useQuery<InvitationListResponse>({
    queryKey: ['invitations', qs],
    queryFn: () => api.get(`/invitations${qs ? `?${qs}` : ''}`),
    enabled: isAuthenticated && !authLoading,
  });
}

export function useInviteMember() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    // roleKeys, not a single tier: the invited account is provisioned with
    // exactly these roles, so "inbox agent only" is invitable rather than a
    // demotion after the fact.
    mutationFn: (data: {
      email: string;
      roleKeys: string[];
      organizationId?: string;
    }) => api.post('/invitations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
  });
}

export function useResendInvitation() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.post(`/invitations/${id}/resend`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}

export function useCancelInvitation() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
}
