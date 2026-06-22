'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, Database, Loader2, RefreshCw } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
} from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useAgents } from '@/hooks/use-agents';
import {
  useCollectedData,
  type CollectedDataRow,
} from '@/hooks/use-collected-data';
import { formatDate } from '@/lib/utils';

/**
 * Collected-data viewer: pick an agent (required), then see one row per
 * conversation with a column per captured field. Agent list is role-scoped by
 * the backend (CLIENT → own org, ADMIN/SUPER_ADMIN → all). Columns are dynamic —
 * whatever distinct keys exist in that agent's data — with `—` for blanks.
 */
export function CollectedDataView() {
  const [agentId, setAgentId] = useState<string | undefined>(undefined);

  // Role-scoped agent list for the selector (backend enforces who sees what).
  const { data: agentsData, isLoading: agentsLoading } = useAgents({
    limit: 100,
    sortBy: 'name',
    sortOrder: 'asc',
  });
  const agents = agentsData?.data ?? [];

  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  // Only the "Captured" column is sortable; map its sort state to the API.
  const capturedSort = fetchParams.sorting.find((s) => s.id === '__capturedAt');
  const sortOrder = capturedSort
    ? capturedSort.desc
      ? 'desc'
      : 'asc'
    : undefined;

  const { data, isError, refetch, isFetching } = useCollectedData(agentId, {
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    sortOrder,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  // Dynamic columns: one per captured key (labelled), plus a "Captured" time.
  const columns = useMemo<ColumnDef<CollectedDataRow, unknown>[]>(() => {
    const cols: ColumnDef<CollectedDataRow, unknown>[] = (
      data?.columns ?? []
    ).map((col) => ({
      id: col.key,
      header: col.label,
      accessorFn: (row) => row.data?.[col.key],
      enableSorting: false,
      cell: ({ row }) => {
        const value = row.original.data?.[col.key];
        if (value === null || value === undefined || value === '') {
          return <span className="text-muted-foreground">—</span>;
        }
        return <span>{String(value)}</span>;
      },
    }));
    cols.push({
      id: '__capturedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Captured" />
      ),
      accessorFn: (row) => row.extractedAt,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.extractedAt)}
        </span>
      ),
    });
    return cols;
  }, [data?.columns]);

  return (
    <div className="space-y-6">
      <div className="max-w-sm space-y-2">
        <Label className="text-sm font-medium">
          Agent <span className="text-destructive">*</span>
        </Label>
        <SearchableSelect
          options={agents.map((agent) => ({
            value: agent.id,
            label: agent.name,
          }))}
          value={agentId}
          onValueChange={(v) => setAgentId(v || undefined)}
          placeholder={agentsLoading ? 'Loading agents…' : 'Select an agent'}
          searchPlaceholder="Search agents…"
          emptyMessage="No agents found"
          triggerClassName="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Pick an agent to see the data captured from its conversations.
        </p>
      </div>

      {!agentId ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground">
          <Database className="size-6" />
          <span className="text-sm">
            Select an agent above to view its collected data.
          </span>
        </div>
      ) : (
        <DataTable<CollectedDataRow, unknown>
          columns={columns}
          data={data?.rows ?? []}
          pageCount={data ? Math.ceil(data.total / data.limit) : 0}
          totalItems={data?.total ?? 0}
          isLoading={isFetching}
          onFetch={handleFetch}
          initialPageSize={10}
          pageSizeOptions={[5, 10, 50, 100]}
          showHeader={false}
          showToolbar={false}
          hideSelectionCount
          renderLoading={() => (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {...(isError && {
            renderEmpty: () => (
              <div className="flex h-32 flex-col items-center justify-center gap-2">
                <AlertCircle className="size-6 text-destructive" />
                <span className="text-sm text-muted-foreground">
                  Failed to load collected data
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw
                    className={`mr-1 size-3 ${isFetching ? 'animate-spin' : ''}`}
                  />
                  Try again
                </Button>
              </div>
            ),
          })}
        />
      )}
    </div>
  );
}
