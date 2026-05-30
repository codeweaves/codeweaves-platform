import { Fragment } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

interface DataTableSkeletonProps {
  columnCount: number;
  rowCount?: number;
}

/**
 * Renders skeleton placeholder rows for a DataTable's body. Outputs only
 * <TableRow>s (no wrapping <Table> / <TableBody>) so it can be placed
 * directly inside the parent DataTable's existing <TableBody> without
 * producing invalid HTML (<tbody><div>...</tbody>).
 */
export function DataTableSkeleton({
  columnCount,
  rowCount = 10,
}: DataTableSkeletonProps) {
  return (
    <Fragment>
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columnCount }).map((_, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </Fragment>
  );
}
