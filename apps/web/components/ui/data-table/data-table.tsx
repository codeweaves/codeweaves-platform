import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  SortingState,
  FilterFn,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';

// Module augmentation to add custom filter function
declare module '@tanstack/react-table' {
  interface FilterFns {
    multipleFilter: FilterFn<unknown>;
  }
}
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';
import { DataTableExpandToggle } from './data-table-expand-toggle';
import {
  DataTableProps,
  DataTableTexts,
  DataTableHeaderRenderProps,
  DataTableFooterRenderProps,
  DataTableToolbarRenderProps,
} from './types';

const DEFAULT_TEXTS: Required<DataTableTexts> = {
  selected: 'row(s) selected',
  noResults: 'No results found.',
  rowsPerPage: 'Rows per page',
  of: 'of',
  page: 'Page',
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

export function DataTable<TData, TValue, TSubRow = unknown>({
  columns,
  data,
  title,
  totalItems = 0,
  pageCount,
  // Simplified API
  onFetch,
  initialPageSize = 10,
  // Controlled API (optional overrides)
  pageIndex: controlledPageIndex,
  pageSize: controlledPageSize,
  onPaginationChange: controlledOnPaginationChange,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  searchValue: controlledSearchValue,
  onSearchChange: controlledOnSearchChange,
  filterValues: controlledFilterValues,
  onFilterChange: controlledOnFilterChange,
  onClearAll: controlledOnClearAll,
  // Common props
  searchConfig,
  filters,
  exportConfig,
  enableRowSelection = false,
  rowSelection = {},
  onRowSelectionChange,
  isLoading = false,
  // Expandable rows
  expandableConfig,
  expanded: controlledExpanded,
  onExpandedChange: controlledOnExpandedChange,
  defaultExpanded = {},
  getRowId,
  // Customization options
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  fixedLayout = true,
  texts,
  showHeader = true,
  showToolbar = true,
  showPagination = true,
  hideSelectionCount = false,
  // Render props
  renderHeader,
  renderEmpty,
  renderLoading,
  renderToolbar,
  renderFooter,
}: DataTableProps<TData, TValue, TSubRow>) {
  // Determine if we're in controlled mode (user manages state) or internal mode (we manage state)
  const isControlled =
    controlledPageIndex !== undefined && controlledOnPaginationChange !== undefined;

  // Internal state (used when onFetch is provided and not in controlled mode)
  const [internalPageIndex, setInternalPageIndex] = useState(0);
  const [internalPageSize, setInternalPageSize] = useState(initialPageSize);
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [internalSearchValue, setInternalSearchValue] = useState('');
  const [internalFilterValues, setInternalFilterValues] = useState<
    Record<string, string | string[]>
  >({});
  // Ref to always have the latest filter values in callbacks (avoids stale closure)
  const internalFilterValuesRef = useRef<Record<string, string | string[]>>({});
  useEffect(() => {
    internalFilterValuesRef.current = internalFilterValues;
  }, [internalFilterValues]);
  // Expandable rows state
  const [internalExpanded, setInternalExpanded] = useState<Record<string, boolean>>(defaultExpanded);

  // Debounce timer ref for search
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track if this is the first render (to skip debounced search on mount)
  const isFirstRender = useRef(true);

  // Use controlled values if provided, otherwise use internal state
  const pageIndex = isControlled ? controlledPageIndex : internalPageIndex;
  const pageSize = isControlled ? (controlledPageSize ?? initialPageSize) : internalPageSize;
  const sorting = controlledSorting ?? internalSorting;
  const searchValue = controlledSearchValue ?? internalSearchValue;
  const filterValues = controlledFilterValues ?? internalFilterValues;
  const expanded = controlledExpanded ?? internalExpanded;

  // Merge custom texts with defaults
  const mergedTexts = { ...DEFAULT_TEXTS, ...texts };

  // Trigger onFetch when state changes (only in internal mode)
  const triggerFetch = useCallback(
    (params: {
      page: number;
      pageSize: number;
      sorting: SortingState;
      search: string;
      filters: Record<string, string | string[]>;
    }) => {
      if (onFetch && !isControlled) {
        onFetch(params);
      }
    },
    [onFetch, isControlled]
  );

  // Initial fetch on mount (only in internal mode)
  useEffect(() => {
    if (onFetch && !isControlled) {
      triggerFetch({
        page: internalPageIndex,
        pageSize: internalPageSize,
        sorting: internalSorting,
        search: internalSearchValue,
        filters: internalFilterValues,
      });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handlers that work for both modes
  const handlePaginationChange = useCallback(
    (newPageIndex: number, newPageSize: number) => {
      if (isControlled) {
        controlledOnPaginationChange?.(newPageIndex, newPageSize);
      } else {
        setInternalPageIndex(newPageIndex);
        setInternalPageSize(newPageSize);
        triggerFetch({
          page: newPageIndex,
          pageSize: newPageSize,
          sorting: internalSorting,
          search: internalSearchValue,
          filters: internalFilterValues,
        });
      }
    },
    [
      isControlled,
      controlledOnPaginationChange,
      triggerFetch,
      internalSorting,
      internalSearchValue,
      internalFilterValues,
    ]
  );

  const handleSortingChange = useCallback(
    (newSorting: SortingState) => {
      if (isControlled) {
        controlledOnSortingChange?.(newSorting);
      } else {
        setInternalSorting(newSorting);
        triggerFetch({
          page: internalPageIndex,
          pageSize: internalPageSize,
          sorting: newSorting,
          search: internalSearchValue,
          filters: internalFilterValues,
        });
      }
    },
    [
      isControlled,
      controlledOnSortingChange,
      triggerFetch,
      internalPageIndex,
      internalPageSize,
      internalSearchValue,
      internalFilterValues,
    ]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      if (isControlled) {
        controlledOnSearchChange?.(value);
      } else {
        // Update search value immediately for UI responsiveness
        setInternalSearchValue(value);
        setInternalPageIndex(0); // Reset to first page
        // Note: triggerFetch is called in the debounce effect below
      }
    },
    [isControlled, controlledOnSearchChange]
  );

  // Debounced search effect - triggers fetch after user stops typing
  useEffect(() => {
    // Skip on first render (initial fetch already handles it)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Skip debounce in controlled mode (parent handles it)
    if (isControlled || !onFetch) return;

    const debounceMs = searchConfig?.debounceMs ?? 300;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      triggerFetch({
        page: 0,
        pageSize: internalPageSize,
        sorting: internalSorting,
        search: internalSearchValue,
        filters: internalFilterValues,
      });
    }, debounceMs);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalSearchValue]);

  // Coalesce back-to-back filter changes (e.g. DateRangeFilter sets from + to)
  // into a single fetch on the next microtask.
  const pendingFetchRef = useRef<boolean>(false);
  const handleFilterChange = useCallback(
    (filterId: string, value: string | string[]) => {
      if (isControlled) {
        controlledOnFilterChange?.(filterId, value);
      } else {
        const newFilters = { ...internalFilterValuesRef.current, [filterId]: value };
        internalFilterValuesRef.current = newFilters;
        setInternalFilterValues(newFilters);
        setInternalPageIndex(0); // Reset to first page
        if (!pendingFetchRef.current) {
          pendingFetchRef.current = true;
          queueMicrotask(() => {
            pendingFetchRef.current = false;
            triggerFetch({
              page: 0,
              pageSize: internalPageSize,
              sorting: internalSorting,
              search: internalSearchValue,
              filters: internalFilterValuesRef.current,
            });
          });
        }
      }
    },
    [
      isControlled,
      controlledOnFilterChange,
      triggerFetch,
      internalPageSize,
      internalSorting,
      internalSearchValue,
    ]
  );

  const handleClearAll = useCallback(() => {
    if (isControlled) {
      controlledOnClearAll?.();
    } else {
      setInternalSearchValue('');
      internalFilterValuesRef.current = {};
      setInternalFilterValues({});
      setInternalSorting([]);
      setInternalPageIndex(0);
      triggerFetch({
        page: 0,
        pageSize: internalPageSize,
        sorting: [],
        search: '',
        filters: {},
      });
    }
  }, [isControlled, controlledOnClearAll, triggerFetch, internalPageSize]);

  // Handler for expand/collapse row
  const handleExpandChange = useCallback(
    (rowId: string, isExpanded: boolean) => {
      const newExpanded = { ...expanded, [rowId]: isExpanded };

      if (controlledOnExpandedChange) {
        controlledOnExpandedChange(newExpanded);
      } else {
        setInternalExpanded(newExpanded);
      }
    },
    [expanded, controlledOnExpandedChange]
  );

  // Helper to get unique row ID
  const getRowIdFn = useCallback(
    (row: TData, index: number): string => {
      if (getRowId) {
        return getRowId(row, index);
      }
      // Default: try common ID fields, fallback to index
      const rowAny = row as Record<string, unknown>;
      if (rowAny.id !== undefined) return String(rowAny.id);
      if (rowAny.uniqueId !== undefined) return String(rowAny.uniqueId);
      return String(index);
    },
    [getRowId]
  );

  // Helper to get ID from any row (sub-rows use same logic)
  const getAnyRowId = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any, index: number): string => {
      if (row.id !== undefined) return String(row.id);
      if (row.uniqueId !== undefined) return String(row.uniqueId);
      return String(index);
    },
    []
  );

  // Get indentation class based on depth level
  const getIndentClass = (depth: number): string => {
    switch (depth) {
      case 1:
        return 'pl-4';
      case 2:
        return 'pl-8';
      default:
        return 'pl-12';
    }
  };

  // Recursive function to render nested sub-rows (supports up to 3 levels: parent -> child -> grandchild)
  const renderNestedSubRows = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (subRows: any[], parentId: string, parentRow: any, depth: number): React.ReactNode[] => {
      if (!expandableConfig || depth > 2) return []; // Max depth of 2 (grandchild level)

      return subRows.flatMap((subRow, subIndex) => {
        const subRowId = `${parentId}.${getAnyRowId(subRow, subIndex)}`;
        const isSubRowExpanded = expanded[subRowId] ?? false;
        // Check if this sub-row has its own children
        const grandChildren = expandableConfig.getSubRows(subRow as TData);
        const hasGrandChildren = grandChildren && grandChildren.length > 0;

        const rows: React.ReactNode[] = [];

        // Render the sub-row itself
        if (expandableConfig.renderSubRowCells) {
          const cells = expandableConfig.renderSubRowCells(subRow, parentRow, subIndex);
          rows.push(
            <TableRow
              key={subRowId}
              data-slot={depth === 1 ? 'data-table-child-row' : 'data-table-grandchild-row'}
              className={cn(
                'bg-muted/30',
                depth === 1 ? 'data-table-child-row' : 'data-table-grandchild-row',
                isSubRowExpanded && hasGrandChildren && 'data-table-row-expanded font-medium',
                expandableConfig.childRowClassName
              )}
              data-expanded={isSubRowExpanded && hasGrandChildren ? 'true' : undefined}
              data-depth={depth}
            >
              {/* Expand toggle cell for nested rows */}
              <TableCell className="w-10 px-2">
                {hasGrandChildren && (
                  <DataTableExpandToggle
                    isExpanded={isSubRowExpanded}
                    onToggle={() => handleExpandChange(subRowId, !isSubRowExpanded)}
                    hasChildren={true}
                  />
                )}
              </TableCell>
              {/* Render each sub-row cell with its colSpan */}
              {cells.map((cell, cellIndex) => (
                <TableCell
                  key={cellIndex}
                  colSpan={cell.colSpan ?? 1}
                  className={cn(
                    cellIndex === 0 && expandableConfig.indentChildren !== false
                      ? getIndentClass(depth)
                      : '',
                    cell.className
                  )}
                >
                  {cell.content}
                </TableCell>
              ))}
            </TableRow>
          );
        } else {
          // Legacy: single cell spanning all columns
          rows.push(
            <TableRow
              key={subRowId}
              data-slot={depth === 1 ? 'data-table-child-row' : 'data-table-grandchild-row'}
              className={cn(
                'bg-muted/30',
                depth === 1 ? 'data-table-child-row' : 'data-table-grandchild-row',
                isSubRowExpanded && hasGrandChildren && 'data-table-row-expanded font-medium',
                expandableConfig.childRowClassName
              )}
              data-expanded={isSubRowExpanded && hasGrandChildren ? 'true' : undefined}
              data-depth={depth}
            >
              {/* Expand toggle cell for nested rows */}
              <TableCell className="w-10 px-2">
                {hasGrandChildren && (
                  <DataTableExpandToggle
                    isExpanded={isSubRowExpanded}
                    onToggle={() => handleExpandChange(subRowId, !isSubRowExpanded)}
                    hasChildren={true}
                  />
                )}
              </TableCell>
              <TableCell
                colSpan={(expandableConfig.subRowColSpan ?? columns.length)}
                className={expandableConfig.indentChildren !== false ? getIndentClass(depth + 1) : ''}
              >
                {expandableConfig.renderSubRow?.(subRow, parentRow, subIndex)}
              </TableCell>
            </TableRow>
          );
        }

        // Recursively render grandchildren if expanded
        if (isSubRowExpanded && hasGrandChildren) {
          rows.push(...renderNestedSubRows(grandChildren, subRowId, subRow, depth + 1));
        }

        return rows;
      });
    },
    [expandableConfig, expanded, handleExpandChange, getAnyRowId, columns.length]
  );

  // Track the visible width of the scroll container for centering empty state
  const borderRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = borderRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const table = useReactTable({
    data,
    columns,
    pageCount,
    filterFns: {
      multipleFilter: (row, columnId, filterValue) =>
        filterValue.includes((row.getValue(columnId) as string).toLowerCase()),
    },
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      rowSelection,
    },
    manualPagination: true,
    manualSorting: true,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater({ pageIndex, pageSize });
        handlePaginationChange(newState.pageIndex, newState.pageSize);
      }
    },
    onSortingChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater(sorting);
        handleSortingChange(newState);
      } else {
        handleSortingChange(updater);
      }
    },
    onRowSelectionChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater(rowSelection);
        onRowSelectionChange?.(newState);
      } else {
        onRowSelectionChange?.(updater);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection,
  });

  const selectedCount = Object.keys(rowSelection).filter(
    (key) => rowSelection[key]
  ).length;

  // Check if any filters, search, or sorting is active
  const hasActiveFilters =
    !!searchValue ||
    sorting.length > 0 ||
    (filterValues &&
      Object.entries(filterValues).some(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        return value && value !== 'all';
      }));

  // Render props data
  const headerRenderProps: DataTableHeaderRenderProps = { title, totalItems };
  const footerRenderProps: DataTableFooterRenderProps = { selectedCount, totalItems };
  const toolbarRenderProps: DataTableToolbarRenderProps = {
    searchConfig,
    searchValue,
    onSearchChange: handleSearchChange,
    filters,
    filterValues,
    onFilterChange: handleFilterChange,
    onClearAll: handleClearAll,
    hasActiveFilters,
    exportConfig,
  };

  // Default header renderer
  const defaultHeader = title ? (
    <h2 className="text-2xl font-semibold">
      {title} ({totalItems})
    </h2>
  ) : null;

  // Calculate total columns including expand toggle
  const totalColumns = columns.length + (expandableConfig ? 1 : 0);

  // Default loading renderer
  const defaultLoading = (
    <DataTableSkeleton columnCount={totalColumns} rowCount={pageSize} />
  );

  // Default toolbar renderer
  const defaultToolbar = (
    <DataTableToolbar
      searchConfig={searchConfig}
      searchValue={searchValue}
      onSearchChange={handleSearchChange}
      filters={filters}
      filterValues={filterValues}
      onFilterChange={handleFilterChange}
      onClearAll={handleClearAll}
      hasActiveFilters={hasActiveFilters}
      exportConfig={exportConfig}
    />
  );

  // Default pagination/footer renderer
  const defaultFooter = (
    <DataTablePagination
      table={table}
      totalItems={totalItems}
      selectedCount={selectedCount}
      pageSizeOptions={pageSizeOptions}
      texts={mergedTexts}
      hideSelectionCount={hideSelectionCount}
    />
  );

  return (
    <div data-slot="data-table" className="space-y-4">
      {/* Header */}
      {showHeader && (
        <div data-slot="data-table-header">
          {renderHeader ? renderHeader(headerRenderProps) : defaultHeader}
        </div>
      )}

      {/* Toolbar: Search + Filters */}
      {showToolbar && (
        <div data-slot="data-table-toolbar-wrapper">
          {renderToolbar ? renderToolbar(toolbarRenderProps) : defaultToolbar}
        </div>
      )}

      {/* Table */}
      <div ref={borderRef} data-slot="data-table-border" className="rounded-md border">
        <Table data-slot="data-table-table" className={fixedLayout ? 'table-fixed' : undefined}>
          <TableHeader data-slot="data-table-thead">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} data-slot="data-table-header-row">
                {/* Empty header cell for expand toggle column */}
                {expandableConfig && (
                  <TableHead className="w-10" />
                )}
                {headerGroup.headers.map((header) => {
                  const size = header.column.columnDef.size;
                  return (
                    <TableHead
                      key={header.id}
                      data-slot="data-table-th"
                      data-column-id={header.id}
                      style={size ? { width: size } : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody data-slot="data-table-tbody">
            {isLoading ? (
              renderLoading ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (expandableConfig ? 1 : 0)} className="p-0">
                    <div data-slot="data-table-loading" className="sticky left-0 flex items-center justify-center" style={containerWidth ? { width: containerWidth } : undefined}>
                      {renderLoading()}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                defaultLoading
              )
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, rowIndex) => {
                const rowId = getRowIdFn(row.original, rowIndex);
                const isRowExpanded = expanded[rowId] ?? false;
                const subRows = expandableConfig?.getSubRows(row.original);
                const hasChildren = subRows && subRows.length > 0;

                return (
                  <Fragment key={row.id}>
                    {/* Parent Row */}
                    <TableRow
                      data-slot="data-table-row"
                      data-state={row.getIsSelected() && 'selected'}
                      data-expanded={isRowExpanded && hasChildren ? 'true' : undefined}
                      className={cn(
                        'data-table-parent-row',
                        isRowExpanded && hasChildren && 'data-table-row-expanded font-medium'
                      )}
                    >
                      {/* Expand toggle cell */}
                      {expandableConfig && (
                        <TableCell data-slot="data-table-expand-toggle" className="w-10 px-2">
                          <DataTableExpandToggle
                            isExpanded={isRowExpanded}
                            onToggle={() => handleExpandChange(rowId, !isRowExpanded)}
                            hasChildren={hasChildren ?? false}
                          />
                        </TableCell>
                      )}
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} data-slot="data-table-td" data-column-id={cell.column.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>

                    {/* Child/Sub Rows (when expanded) - supports recursive nesting */}
                    {expandableConfig && isRowExpanded && hasChildren &&
                      renderNestedSubRows(subRows, rowId, row.original, 1)
                    }
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + (expandableConfig ? 1 : 0)} className="p-0">
                  <div data-slot="data-table-empty" className="sticky left-0 flex items-center justify-center" style={containerWidth ? { width: containerWidth } : undefined}>
                    {renderEmpty ? renderEmpty() : (
                      <div className="flex h-32 items-center justify-center">
                        <span className="text-sm text-muted-foreground">{mergedTexts.noResults}</span>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {showPagination && (
        <div data-slot="data-table-footer">
          {renderFooter ? renderFooter(footerRenderProps) : defaultFooter}
        </div>
      )}
    </div>
  );
}
