'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DataTableProps } from './data-table.types';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';
import { DataTableEmptyState } from './data-table-empty-state';

export function DataTable<TData>(props: DataTableProps<TData>) {
  const {
    columns,
    toolbar,
    emptyState,
    onRowClick,
    skeletonRowCount,
    className,
    initialColumnVisibility,
  } = props;

  const isServer = props.mode === 'server';

  // Extract server-mode props for stable hook dependencies
  const serverState = isServer ? props.state : undefined;
  const serverSortableColumns = isServer ? props.sortableColumns : undefined;
  const serverOnStateChange = isServer ? props.onStateChange : undefined;
  const serverMeta = isServer ? props.meta : undefined;
  const serverPageSizeOptions = isServer ? props.pageSizeOptions : undefined;

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );

  // Sorting state for simple mode
  const [localSorting, setLocalSorting] = useState<SortingState>([]);

  // Derive sorting from server state
  const serverSorting: SortingState = useMemo(() => {
    if (!serverState) return [];
    const { sortBy, sortOrder } = serverState;
    if (!sortBy) return [];

    // Reverse-map: find the column ID for this server sort field
    const sortColumns = serverSortableColumns ?? {};
    const columnId =
      Object.entries(sortColumns).find(
        ([, serverField]) => serverField === sortBy,
      )?.[0] ?? sortBy;

    return [{ id: columnId, desc: sortOrder !== 'asc' }];
  }, [serverState, serverSortableColumns]);

  // Handle sorting change for server mode
  const handleServerSortingChange = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      if (!serverState || !serverOnStateChange) return;
      const newSorting =
        typeof updater === 'function' ? updater(serverSorting) : updater;
      if (newSorting.length > 0) {
        const sort = newSorting[0]!;
        const sortColumns = serverSortableColumns ?? {};
        const serverField = sortColumns[sort.id] ?? sort.id;
        serverOnStateChange({
          ...serverState,
          page: 1,
          sortBy: serverField,
          sortOrder: sort.desc ? 'desc' : 'asc',
        });
      }
    },
    [serverState, serverOnStateChange, serverSortableColumns, serverSorting],
  );

  const sorting = isServer ? serverSorting : localSorting;
  const enableSorting =
    isServer || ('enableSorting' in props && props.enableSorting);

  const table = useReactTable({
    data: props.data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(isServer
      ? {
          manualSorting: true,
          onSortingChange: handleServerSortingChange,
        }
      : enableSorting
        ? {
            getSortedRowModel: getSortedRowModel(),
            onSortingChange: setLocalSorting,
          }
        : {}),
    state: {
      sorting,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  // Loading states: skeleton for first load, inline spinner if data already exists
  const isLoading = isServer ? props.isLoading : (props.isLoading ?? false);
  const hasData = props.data.length > 0;
  const isInitialLoad = isLoading && !hasData;
  const isRefetching = isLoading && hasData;

  if (isInitialLoad) {
    return (
      <DataTableSkeleton
        columnCount={columns.length}
        rowCount={skeletonRowCount}
        showToolbar={!!toolbar}
      />
    );
  }

  // Empty state (only when no active search)
  const isEmpty = props.data.length === 0;
  const hasActiveSearch = serverState?.search;
  if (isEmpty && !hasActiveSearch && emptyState) {
    return <DataTableEmptyState config={emptyState} />;
  }

  const rows = table.getRowModel().rows;

  // Search change handler for server mode
  const handleSearchChange = serverOnStateChange && serverState
    ? (value: string) =>
        serverOnStateChange({
          ...serverState,
          page: 1,
          search: value || undefined,
        })
    : undefined;

  return (
    <div className={cn('space-y-4', className)}>
      {toolbar && (
        <DataTableToolbar
          table={table}
          config={toolbar}
          searchValue={serverState?.search ?? ''}
          onSearchChange={handleSearchChange}
        />
      )}

      <div className="relative overflow-hidden rounded-md border">
        {isRefetching && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {serverMeta && serverMeta.totalPages > 1 && serverOnStateChange && serverState && (
        <DataTablePagination
          meta={serverMeta}
          onPageChange={(page) =>
            serverOnStateChange({ ...serverState, page })
          }
          onPageSizeChange={(size) =>
            serverOnStateChange({ ...serverState, page: 1, limit: size })
          }
          pageSizeOptions={serverPageSizeOptions}
        />
      )}
    </div>
  );
}
