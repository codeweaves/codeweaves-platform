'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

/** A column in the collected-data view: the JSON key + a display label. */
export interface CollectedDataColumn {
  key: string;
  label: string;
}

/** One captured row — one conversation's worth of data. */
export interface CollectedDataRow {
  chatSessionId: string;
  data: Record<string, unknown>;
  extractedAt: string;
}

/** Paginated collected-data view returned by the backend. */
export interface CollectedDataView {
  columns: CollectedDataColumn[];
  rows: CollectedDataRow[];
  total: number;
  page: number;
  limit: number;
}

export interface CollectedDataParams {
  page?: number; // 1-based
  limit?: number;
  /** Sort direction for the "Captured at" column. Defaults to 'desc' server-side. */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Fetches the paginated collected-data view for an agent. The backend is
 * role-scoped (CLIENT only their own agents, ADMIN/SUPER_ADMIN any) and returns
 * dynamic columns (distinct keys, labelled) + a page of rows. Disabled until an
 * agent is selected.
 */
export function useCollectedData(
  agentId: string | undefined,
  params: CollectedDataParams = {},
) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();

  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.limit) queryParams.set('limit', String(params.limit));
  if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
  const queryString = queryParams.toString();

  return useQuery<CollectedDataView>({
    queryKey: ['collected-data', agentId, params],
    queryFn: () =>
      api.get(
        `/agents/${agentId}/data-fields/collected${queryString ? `?${queryString}` : ''}`,
      ),
    enabled: isAuthenticated && !authLoading && Boolean(agentId),
  });
}
