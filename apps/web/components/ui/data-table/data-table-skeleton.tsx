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
  /** When true, renders only TableRow elements (for use inside an existing TableBody) */
  inline?: boolean;
}

function SkeletonRows({ columnCount, rowCount = 10 }: { columnCount: number; rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columnCount }).map((_, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function DataTableSkeleton({
  columnCount,
  rowCount = 10,
  inline = false,
}: DataTableSkeletonProps) {
  if (inline) {
    return <SkeletonRows columnCount={columnCount} rowCount={rowCount} />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columnCount }).map((_, index) => (
            <TableHead key={index}>
              <Skeleton className="h-4 w-24" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <SkeletonRows columnCount={columnCount} rowCount={rowCount} />
      </TableBody>
    </Table>
  );
}
