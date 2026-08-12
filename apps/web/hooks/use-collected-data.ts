'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
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
    // Paging and sorting change the key, so without this the table empties and
    // remounts on every page turn. Keeping the previous page on screen while the
    // next one loads means one spinner in the toolbar instead of a layout jump.
    placeholderData: (previous) => previous,
  });
}

/**
 * Downloads the agent's full captured-data set as a CSV.
 *
 * The whole set, not the page on screen: the server streams every row, so this
 * is one request regardless of how much data there is. Pagination is a viewport
 * and is deliberately NOT sent; the sort order is, because that is a choice the
 * user made about the data itself.
 *
 * The browser's IANA zone rides along so timestamps come back local rather than
 * UTC. Gated by the same `CollectedData:Read` permission as the table.
 */
export function useExportCollectedData(agentId: string | undefined) {
  const api = useApiClient();

  return useMutation<string, Error, { sortOrder?: 'asc' | 'desc' } | void>({
    mutationFn: (options) => {
      if (!agentId) throw new Error('No agent selected');

      const qs = new URLSearchParams();
      if (options?.sortOrder) qs.set('sortOrder', options.sortOrder);
      // Undefined in exotic runtimes; the API falls back to UTC.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timeZone) qs.set('tz', timeZone);

      return api.download(
        `/agents/${agentId}/data-fields/collected/export?${qs.toString()}`,
        'collected-data.csv',
      );
    },
  });
}
