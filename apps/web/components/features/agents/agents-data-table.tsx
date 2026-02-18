'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Bot } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
  type DataTableFilterConfig,
} from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { useAgents, type Agent } from '@/hooks/use-agents';
import { useProfile } from '@/hooks/use-profile';
import { useOrganizations } from '@/hooks/use-organizations';
import { formatDate } from '@/lib/utils';

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

interface AgentsDataTableProps {
  emptyAction?: React.ReactNode;
}

export function AgentsDataTable({ emptyAction }: AgentsDataTableProps) {
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  // Fetch organizations list for admin filter dropdown
  const { data: orgsData } = useOrganizations({ limit: 100 });

  // Map DataTable fetch params to API params
  const sortField = fetchParams.sorting[0];
  const sortBy = sortField
    ? (SORTABLE_COLUMNS[sortField.id] ?? sortField.id)
    : 'createdAt';
  const sortOrder = sortField ? (sortField.desc ? 'desc' : 'asc') : 'desc';

  const statusFilter = fetchParams.filters?.status as string | undefined;
  const orgFilter = fetchParams.filters?.organizationId as string | undefined;

  const { data, isLoading } = useAgents({
    page: fetchParams.page + 1, // API is 1-based
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
    status: statusFilter && statusFilter !== 'all'
      ? (statusFilter as 'ACTIVE' | 'INACTIVE')
      : undefined,
    organizationId: orgFilter && orgFilter !== 'all' ? orgFilter : undefined,
    sortBy: sortBy as 'name' | 'createdAt' | 'updatedAt',
    sortOrder,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  // Build columns based on role
  const columns: ColumnDef<Agent, unknown>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => (
        <Link
          href={`/dashboard/agents/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.getValue('name')}
        </Link>
      ),
    },
    // Organization column only for admins
    ...(isAdmin
      ? [
          {
            id: 'organization',
            accessorFn: (row: Agent) => row.organization?.name ?? '—',
            header: 'Organization',
            enableSorting: false,
          } satisfies ColumnDef<Agent, unknown>,
        ]
      : []),
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>
            {status === 'ACTIVE' ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => formatDate(row.getValue('createdAt')),
    },
  ];

  // Build filters based on role
  const filters: DataTableFilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      options: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' },
      ],
    },
    // Organization filter only for admins
    ...(isAdmin && orgsData?.data
      ? [
          {
            id: 'organizationId',
            label: 'Organization',
            options: orgsData.data.map((org) => ({
              label: org.name,
              value: org.id,
            })),
          },
        ]
      : []),
  ];

  const isEmpty =
    !isLoading && data?.meta.total === 0 && !fetchParams.search && !statusFilter && !orgFilter;

  if (isEmpty && emptyAction) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Bot className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">No agents found</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating your first agent.
        </p>
        <div className="mt-4">{emptyAction}</div>
      </div>
    );
  }

  return (
    <DataTable<Agent, unknown>
      columns={columns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? 0}
      totalItems={data?.meta.total ?? 0}
      isLoading={isLoading}
      onFetch={handleFetch}
      initialPageSize={10}
      pageSizeOptions={[5, 10, 50, 100]}
      searchConfig={{
        placeholder: 'Search agents...',
        searchKey: 'search',
      }}
      filters={filters}
      showHeader={false}
      hideSelectionCount
    />
  );
}
