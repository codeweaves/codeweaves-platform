'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import type { AccessScope } from '@/hooks/use-profile';

export interface RoleView {
  key: string;
  name: string;
  description: string | null;
  orgAllowed: boolean;
  clientGrantable: boolean;
  permissions: string[];
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  accessScope: AccessScope;
  organization: { id: string; name: string; slug: string } | null;
  roleKeys: string[];
  createdAt: string;
}

export interface ManagedUserDetail extends ManagedUser {
  /** Derived union of the held roles. Read-only. */
  permissions: string[];
}

export interface UserListResponse {
  data: ManagedUser[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Roles the CURRENT user may assign.
 *
 * Already filtered by the API: an org manager receives neither platform roles
 * nor `org.manager`. The dialog renders whatever it is handed and makes no
 * visibility decision of its own, which is what stops internal role names
 * travelling in a response body.
 */
export function useAssignableRoles(enabled = true) {
  const api = useApiClient();

  return useQuery<RoleView[]>({
    queryKey: ['rbac', 'roles'],
    queryFn: () => api.get('/rbac/roles'),
    enabled,
    // The catalog only changes on deploy, so this is effectively static within a
    // session.
    staleTime: 10 * 60_000,
  });
}

export function useUsers(params: {
  page: number;
  limit: number;
  search?: string;
  enabled?: boolean;
}) {
  const api = useApiClient();
  const { page, limit, search, enabled = true } = params;

  return useQuery<UserListResponse>({
    queryKey: ['rbac', 'users', page, limit, search ?? ''],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) qs.set('search', search);
      return api.get(`/users?${qs.toString()}`);
    },
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useUser(userId: string | null) {
  const api = useApiClient();

  return useQuery<ManagedUserDetail>({
    queryKey: ['rbac', 'user', userId],
    queryFn: () => api.get(`/users/${userId}`),
    enabled: !!userId,
  });
}

/**
 * Replace a user's role set.
 *
 * PUT, not PATCH: the dialog submits everything ticked, so replace semantics
 * avoid two managers silently overwriting each other's edit.
 */
export function useSetUserRoles(userId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ManagedUserDetail, Error, string[]>({
    mutationFn: (roleKeys) => api.put(`/users/${userId}/roles`, { roleKeys }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['rbac', 'user', userId], updated);
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
      // If the caller edited themselves (super admin only), their own permission
      // set just changed and every gate in the UI reads from it.
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useSetUserScope(userId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ManagedUserDetail, Error, AccessScope>({
    mutationFn: (accessScope) => api.patch(`/users/${userId}/scope`, { accessScope }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['rbac', 'user', userId], updated);
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
    },
  });
}
