'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, Building2, Search } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useOrganizations,
  type Organization,
  type OrganizationListParams,
} from '@/hooks/use-organizations';

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const SORT_BY_VALUES = ['name', 'slug', 'createdAt', 'usersCount'] as const;
type SortByValue = (typeof SORT_BY_VALUES)[number];

function isValidSortBy(value: string | null): value is SortByValue {
  return value !== null && SORT_BY_VALUES.includes(value as SortByValue);
}

const columns: ColumnDef<Organization>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-4"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        Name
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue('name')}</span>
    ),
  },
  {
    accessorKey: 'slug',
    header: 'Slug',
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-sm">
        {row.getValue('slug')}
      </span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-4"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        Created
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => formatDate(row.getValue('createdAt')),
  },
  {
    id: 'usersCount',
    accessorFn: (row) => row._count.users,
    header: ({ column }) => (
      <Button
        variant="ghost"
        className="-ml-4"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        Users
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => row.original._count.users,
  },
];

const sortByMap: Record<string, OrganizationListParams['sortBy']> = {
  name: 'name',
  slug: 'slug',
  createdAt: 'createdAt',
  usersCount: 'usersCount',
};

interface OrganizationsDataTableProps {
  emptyAction?: React.ReactNode;
}

export function OrganizationsDataTable({ emptyAction }: OrganizationsDataTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Derive state from URL search params
  const params: OrganizationListParams = useMemo(() => {
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 20;
    const search = searchParams.get('search') || undefined;
    const sortByParam = searchParams.get('sortBy');
    const sortBy = isValidSortBy(sortByParam) ? sortByParam : 'createdAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
    return { page, limit, search, sortBy, sortOrder };
  }, [searchParams]);

  const searchInput = searchParams.get('search') ?? '';

  const sorting: SortingState = useMemo(() => {
    const sortBy = params.sortBy ?? 'createdAt';
    const columnId = sortBy === 'usersCount' ? 'usersCount' : sortBy;
    return [{ id: columnId, desc: params.sortOrder !== 'asc' }];
  }, [params.sortBy, params.sortOrder]);

  const { data, isLoading } = useOrganizations(params);

  // Update URL search params (replaces history entry to avoid Back-button spam)
  const updateParams = useCallback(
    (updates: Partial<OrganizationListParams>) => {
      const next = { ...params, ...updates };
      const sp = new URLSearchParams();
      if (next.page && next.page > 1) sp.set('page', String(next.page));
      if (next.limit && next.limit !== 20) sp.set('limit', String(next.limit));
      if (next.search) sp.set('search', next.search);
      if (next.sortBy && next.sortBy !== 'createdAt') sp.set('sortBy', next.sortBy);
      if (next.sortOrder && next.sortOrder !== 'desc') sp.set('sortOrder', next.sortOrder);
      const qs = sp.toString();
      router.replace(`/dashboard/organizations${qs ? `?${qs}` : ''}`);
    },
    [params, router],
  );

  const handleSortingChange = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
      if (newSorting.length > 0) {
        const sort = newSorting[0]!;
        updateParams({
          page: 1,
          sortBy: sortByMap[sort.id] ?? 'createdAt',
          sortOrder: sort.desc ? 'desc' : 'asc',
        });
      }
    },
    [sorting, updateParams],
  );

  const handleSearch = useCallback(
    (value: string) => {
      updateParams({ page: 1, search: value || undefined });
    },
    [updateParams],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSearch(e.currentTarget.value);
    },
    [handleSearch],
  );

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    onSortingChange: handleSortingChange,
    state: { sorting },
  });

  const meta = data?.meta;

  if (isLoading) {
    return <TableSkeleton />;
  }

  const isEmpty = !data?.data.length && !params.search;
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">No organizations yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating your first organization.
        </p>
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search organizations..."
            defaultValue={searchInput}
            onKeyDown={handleSearchKeyDown}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            const input = (e.currentTarget.previousElementSibling as HTMLElement)?.querySelector('input');
            handleSearch(input?.value ?? '');
          }}
        >
          Search
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/dashboard/organizations/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No organizations found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => updateParams({ page: (params.page ?? 1) - 1 })}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => updateParams({ page: (params.page ?? 1) + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-72" />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                <TableCell><Skeleton className="h-5 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
