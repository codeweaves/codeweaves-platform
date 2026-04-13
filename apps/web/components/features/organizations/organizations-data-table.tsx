'use client';

import { useCallback, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
} from '@/components/ui/data-table';
import {
  useOrganizations,
  type Organization,
} from '@/hooks/use-organizations';
import { formatDate } from '@/lib/utils';

const columns: ColumnDef<Organization, unknown>[] = [
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

  // Map DataTable fetch params to API params
  const sortField = fetchParams.sorting[0];
  const sortBy = sortField
    ? (SORTABLE_COLUMNS[sortField.id] ?? sortField.id)
    : 'createdAt';
  const sortOrder = sortField ? (sortField.desc ? 'desc' : 'asc') : 'desc';

  const { data, isLoading } = useOrganizations({
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
    sortBy: sortBy as 'name' | 'slug' | 'createdAt' | 'usersCount' | 'agentsCount',
    sortOrder,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  const isEmpty = !isLoading && data?.meta.total === 0 && !fetchParams.search;

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
    <DataTable<Organization, unknown>
      columns={columns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? 0}
      totalItems={data?.meta.total ?? 0}
      isLoading={isLoading}
      onFetch={handleFetch}
      initialPageSize={10}
      searchConfig={{
        placeholder: 'Search organizations...',
        searchKey: 'search',
      }}
      showHeader={false}
      hideSelectionCount
    />
  );
}
