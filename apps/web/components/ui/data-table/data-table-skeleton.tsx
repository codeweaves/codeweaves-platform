import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DataTableSkeletonProps {
  columnCount: number;
  rowCount?: number;
  showToolbar?: boolean;
}

const COLUMN_WIDTHS = ['w-32', 'w-24', 'w-28', 'w-20', 'w-16'];

export function DataTableSkeleton({
  columnCount,
  rowCount = 5,
  showToolbar = false,
}: DataTableSkeletonProps) {
  return (
    <div className="space-y-4">
      {showToolbar && <Skeleton className="h-10 w-72" />}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: columnCount }).map((_, i) => (
                <TableHead key={i}>
                  <Skeleton className="h-4 w-16" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rowCount }).map((_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: columnCount }).map((_, colIndex) => (
                  <TableCell key={colIndex}>
                    <Skeleton
                      className={`h-5 ${COLUMN_WIDTHS[colIndex % COLUMN_WIDTHS.length]}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
