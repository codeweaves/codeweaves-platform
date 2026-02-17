import { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { DataTableTexts } from './types';

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  totalItems: number;
  selectedCount: number;
  pageSizeOptions?: number[];
  texts?: DataTableTexts;
  /** Hide the selection count text (default: false) */
  hideSelectionCount?: boolean;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [5, 10, 50, 100];

const DEFAULT_TEXTS: Required<DataTableTexts> = {
  selected: 'row(s) selected',
  noResults: 'No results found.',
  rowsPerPage: 'Rows per page',
  of: 'of',
  page: 'Page',
};

export function DataTablePagination<TData>({
  table,
  totalItems,
  selectedCount,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  texts,
  hideSelectionCount = false,
}: DataTablePaginationProps<TData>) {
  const mergedTexts = { ...DEFAULT_TEXTS, ...texts };
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  const handlePageSizeChange = (value: string) => {
    const newPageSize = Number(value);
    // Use setPagination to update both pageSize and pageIndex in a single call
    // This triggers onPaginationChange only once via useReactTable
    table.setPagination({ pageIndex: 0, pageSize: newPageSize });
  };

  const handlePageChange = (newPageIndex: number) => {
    // table.setPageIndex triggers onPaginationChange via useReactTable
    // so we don't call onPaginationChange directly (that would cause duplicate calls)
    table.setPageIndex(newPageIndex);
  };

  return (
    <div className={`flex flex-wrap items-center gap-4 px-2 ${hideSelectionCount ? 'justify-end' : 'justify-between'}`}>
      {/* Selection info - hidden on mobile */}
      {!hideSelectionCount && (
        <div className="hidden text-sm text-muted-foreground sm:flex">
          {selectedCount} {mergedTexts.of} {totalItems} {mergedTexts.selected}.
        </div>
      )}

      <div className="flex w-full items-center gap-6 sm:w-fit">
        {/* Rows per page - hidden on mobile */}
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-sm text-muted-foreground">
            {mergedTexts.rowsPerPage}
          </span>
          <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-[70px] focus:ring-0 focus:ring-offset-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page info - always visible */}
        <span className="text-sm text-muted-foreground">
          {mergedTexts.page} {pageIndex + 1} {mergedTexts.of} {pageCount || 1}
        </span>

        {/* Navigation buttons */}
        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {/* First page - hidden on mobile */}
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 sm:flex"
            onClick={() => handlePageChange(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronFirst className="size-4" />
          </Button>
          {/* Previous page - always visible */}
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => handlePageChange(pageIndex - 1)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-4" />
          </Button>
          {/* Next page - always visible */}
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => handlePageChange(pageIndex + 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="size-4" />
          </Button>
          {/* Last page - hidden on mobile */}
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 sm:flex"
            onClick={() => handlePageChange(pageCount - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronLast className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
