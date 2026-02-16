'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableServerState,
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
      <span className="break-all">{row.getValue('name')}</span>
    ),
  },
  {
    accessorKey: 'slug',
    header: 'Slug',
    cell: ({ row }) => (
      <span className="break-all">{row.getValue('slug')}</span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => formatDate(row.getValue('createdAt')),
  },
  {
    id: 'usersCount',
    accessorFn: (row) => row._count.users,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Users" />
    ),
    cell: ({ row }) => row.original._count.users,
  },
];

const SORTABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  usersCount: 'usersCount',
};

interface OrganizationsDataTableProps {
  emptyAction?: React.ReactNode;
}

export function OrganizationsDataTable({
  emptyAction,
}: OrganizationsDataTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const state: DataTableServerState = useMemo(
    () => ({
      page: Number(searchParams.get('page')) || 1,
      limit: Number(searchParams.get('limit')) || 20,
      search: searchParams.get('search') || undefined,
      sortBy: searchParams.get('sortBy') || 'createdAt',
      sortOrder:
        (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
    }),
    [searchParams],
  );

  const { data, isLoading } = useOrganizations({
    ...state,
    sortBy: state.sortBy as 'name' | 'slug' | 'createdAt' | 'usersCount',
  });

  const handleStateChange = useCallback(
    (next: DataTableServerState) => {
      const sp = new URLSearchParams();
      if (next.page > 1) sp.set('page', String(next.page));
      if (next.limit !== 20) sp.set('limit', String(next.limit));
      if (next.search) sp.set('search', next.search);
      if (next.sortBy && next.sortBy !== 'createdAt')
        sp.set('sortBy', next.sortBy);
      if (next.sortOrder && next.sortOrder !== 'desc')
        sp.set('sortOrder', next.sortOrder);
      const qs = sp.toString();
      router.replace(`/dashboard/organizations${qs ? `?${qs}` : ''}`);
    },
    [router],
  );

  return (
    <DataTable<Organization>
      mode="server"
      columns={columns}
      data={data?.data ?? []}
      meta={
        data?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 }
      }
      isLoading={isLoading}
      state={state}
      onStateChange={handleStateChange}
      sortableColumns={SORTABLE_COLUMNS}
      toolbar={{ searchPlaceholder: 'Search organizations...' }}
      emptyState={{
        icon: Building2,
        title: 'No organizations yet',
        description: 'Get started by creating your first organization.',
        action: emptyAction,
      }}
      onRowClick={(org) =>
        router.push(`/dashboard/organizations/${org.id}`)
      }
    />
  );
}
