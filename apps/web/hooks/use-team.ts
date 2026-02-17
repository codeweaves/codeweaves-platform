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

export function usePendingInvitations(organizationId: string | undefined) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  return useQuery<Invitation[]>({
    queryKey: ['invitations', organizationId ?? 'all'],
    queryFn: () => api.get('/invitations'),
    enabled: isAuthenticated && !authLoading,
    select: organizationId
      ? (data) => data.filter((inv) => inv.organizationId === organizationId)
      : undefined,
  });
}

export function useInviteMember() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; role: string; organizationId?: string }) =>
      api.post('/invitations', data),
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
