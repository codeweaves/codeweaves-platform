'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, Building2, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
} from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useOrganizations,
  type Organization,
} from '@/hooks/use-organizations';
import { usePermissions } from '@/hooks/use-permissions';
import { formatDate } from '@/lib/utils';
import { DeleteOrganizationDialog } from './delete-organization-dialog';
import { RenameOrganizationDialog } from './rename-organization-dialog';
import { toast } from 'sonner';

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  usersCount: 'usersCount',
  agentsCount: 'agentsCount',
};

interface OrganizationsDataTableProps {
  emptyAction?: React.ReactNode;
}

export function OrganizationsDataTable({
  emptyAction,
}: OrganizationsDataTableProps) {
  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 20,
    sorting: [],
    search: '',
    filters: {},
  });
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);
  const [renameTarget, setRenameTarget] = useState<Organization | null>(null);

  // Mirrors the API: `Organization:Delete` sits on platform.ops too, but
  // OrganizationsService.assertCanDelete narrows dropping an org (and everything
  // under it) to platform.super_admin. Match that here so we never render a
  // button the server will 403. Cosmetic only; the API is the boundary.
  const { roleKeys } = usePermissions();
  const canMutate = roleKeys.includes('platform.super_admin');
  const showActionsColumn = canMutate;

  const columns = useMemo<ColumnDef<Organization, unknown>[]>(() => {
    const base: ColumnDef<Organization, unknown>[] = [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <span className="block max-w-xs break-all font-semibold py-1">{row.getValue('name')}</span>
        ),
      },
      {
        id: 'agentsCount',
        accessorFn: (row) => row._count.agents,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Agents" className="justify-center" />
        ),
        cell: ({ row }) => <div className="text-center py-1">{row.original._count.agents}</div>,
      },
      {
        id: 'usersCount',
        accessorFn: (row) => row._count.users,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Users" className="justify-center" />
        ),
        cell: ({ row }) => <div className="text-center py-1">{row.original._count.users}</div>,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => <div className="py-1">{formatDate(row.getValue('createdAt'))}</div>,
      },
    ];

    if (!showActionsColumn) return base;

    return [
      ...base,
      {
        id: 'actions',
        header: () => <div className="text-center">Actions</div>,
        enableSorting: false,
        cell: ({ row }) => {
          const org = row.original;
          return (
            <TooltipProvider>
              <div className="flex items-center justify-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setRenameTarget(org)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(org)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          );
        },
      },
    ];
  }, [showActionsColumn]);

  // Map DataTable fetch params to API params
  const sortField = fetchParams.sorting[0];
  const sortBy = sortField
    ? (SORTABLE_COLUMNS[sortField.id] ?? sortField.id)
    : 'createdAt';
  const sortOrder = sortField ? (sortField.desc ? 'desc' : 'asc') : 'desc';

  const { data, isLoading, isError, refetch, isFetching } = useOrganizations({
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
    sortBy: sortBy as 'name' | 'slug' | 'createdAt' | 'usersCount' | 'agentsCount',
    sortOrder,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  const isEmpty = !isLoading && !isError && data?.meta.total === 0 && !fetchParams.search;

  if (isEmpty && emptyAction) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">No organizations yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating your first organization.
        </p>
        <div className="mt-4">{emptyAction}</div>
      </div>
    );
  }

  return (
    <>
      <DataTable<Organization, unknown>
        columns={columns}
        data={data?.data ?? []}
        pageCount={data?.meta.totalPages ?? 0}
        totalItems={data?.meta.total ?? 0}
        // isFetching covers both first load AND subsequent refetches (sort,
        // search, pagination). React Query's `isLoading` is only true on the
        // very first fetch — without this we'd never see a spinner during sort.
        isLoading={isFetching}
        renderLoading={() => (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        // Only override the default empty state when there's a real error.
        // Otherwise DataTable's built-in "No results" message handles it.
        {...(isError && {
          renderEmpty: () => (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <AlertCircle className="size-6 text-destructive" />
              <span className="text-sm text-muted-foreground">Failed to load organizations</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-1 size-3 ${isFetching ? 'animate-spin' : ''}`} />
                Try again
              </Button>
            </div>
          ),
        })}
        onFetch={handleFetch}
        initialPageSize={10}
        searchConfig={{
          placeholder: 'Search organizations...',
          searchKey: 'search',
        }}
        showHeader={false}
        hideSelectionCount
      />

      {deleteTarget && (
        <DeleteOrganizationDialog
          open
          onOpenChange={(next) => !next && setDeleteTarget(null)}
          organizationId={deleteTarget.id}
          organizationName={deleteTarget.name}
          onDeleted={(result) => {
            toast.success(
              `Deleted "${result.name}". ${result.cascadedAgents} agent${result.cascadedAgents === 1 ? '' : 's'} and ${result.cascadedUsers} member${result.cascadedUsers === 1 ? '' : 's'} affected.`,
            );
            setDeleteTarget(null);
          }}
        />
      )}

      {renameTarget && (
        <RenameOrganizationDialog
          open
          onOpenChange={(next) => !next && setRenameTarget(null)}
          organizationId={renameTarget.id}
          currentName={renameTarget.name}
          onRenamed={(updated) => {
            toast.success(`Renamed to "${updated.name}"`);
            setRenameTarget(null);
          }}
        />
      )}
    </>
  );
}
