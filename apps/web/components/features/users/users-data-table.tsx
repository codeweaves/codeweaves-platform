'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, RefreshCw, Building2, Globe } from 'lucide-react';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
} from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUsers, type ManagedUser } from '@/hooks/use-rbac';
import { formatDate } from '@/lib/utils';

/** How many role badges to show before collapsing the rest into a +N. */
const ROLE_BADGE_LIMIT = 2;

export function UsersDataTable() {
  const [fetchParams, setFetchParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 10,
    sorting: [],
    search: '',
    filters: {},
  });

  const { data, isLoading, isError, refetch, isFetching } = useUsers({
    page: fetchParams.page + 1,
    limit: fetchParams.pageSize,
    search: fetchParams.search || undefined,
  });

  const handleFetch = useCallback((params: DataTableFetchParams) => {
    setFetchParams(params);
  }, []);

  const columns: ColumnDef<ManagedUser>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      // A real link rather than a row click handler, so keyboard and
      // middle-click both work.
      cell: ({ row }) => (
        <Link
          href={`/dashboard/users/${row.original.id}`}
          className="block min-w-0 hover:underline"
        >
          <div className="truncate font-medium">{row.original.name ?? 'Unnamed'}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {row.original.email}
          </div>
        </Link>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'organization',
      header: 'Organization',
      cell: ({ row }) =>
        row.original.organization ? (
          <span className="text-sm">{row.original.organization.name}</span>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        ),
      enableSorting: false,
    },
    {
      accessorKey: 'accessScope',
      header: 'Scope',
      cell: ({ row }) => {
        const platform = row.original.accessScope === 'PLATFORM';
        return (
          <Badge variant="outline" className="gap-1 text-[11px]">
            {platform ? <Globe className="size-3" /> : <Building2 className="size-3" />}
            {row.original.accessScope}
          </Badge>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'roleKeys',
      header: 'Roles',
      cell: ({ row }) => {
        const keys = row.original.roleKeys;
        if (keys.length === 0) {
          return <span className="text-sm text-muted-foreground">None</span>;
        }
        const shown = keys.slice(0, ROLE_BADGE_LIMIT);
        const rest = keys.length - shown.length;
        return (
          <div className="flex flex-wrap items-center gap-1">
            {shown.map((key) => (
              <Badge key={key} variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
                {key}
              </Badge>
            ))}
            {rest > 0 && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                +{rest}
              </Badge>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: 'Joined',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDate(row.original.createdAt)}
        </span>
      ),
      enableSorting: false,
    },
  ];

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border p-10 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <span className="text-sm text-muted-foreground">Failed to load users</span>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className="mr-2 size-4" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={data?.data ?? []}
      pageCount={data?.meta.totalPages ?? 0}
      totalItems={data?.meta.total ?? 0}
      isLoading={isLoading}
      onFetch={handleFetch}
      initialPageSize={10}
      searchConfig={{
        placeholder: 'Search by name or email…',
        searchKey: 'search',
      }}
    />
  );
}
