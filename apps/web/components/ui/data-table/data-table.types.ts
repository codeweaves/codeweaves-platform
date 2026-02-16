import type { ColumnDef, VisibilityState } from '@tanstack/react-table';
import type { LucideIcon } from 'lucide-react';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DataTableServerState {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DataTableEmptyStateConfig {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export interface DataTableToolbarConfig {
  searchPlaceholder?: string;
  actions?: React.ReactNode;
  showColumnVisibility?: boolean;
}

interface DataTableServerModeProps<TData> {
  mode: 'server';
  data: TData[];
  meta: PaginationMeta;
  isLoading: boolean;
  state: DataTableServerState;
  onStateChange: (state: DataTableServerState) => void;
  sortableColumns?: Record<string, string>;
  pageSizeOptions?: number[];
}

interface DataTableSimpleModeProps<TData> {
  mode?: 'simple';
  data: TData[];
  isLoading?: boolean;
  enableSorting?: boolean;
}

interface DataTableCommonProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  toolbar?: DataTableToolbarConfig;
  emptyState?: DataTableEmptyStateConfig;
  onRowClick?: (row: TData) => void;
  skeletonRowCount?: number;
  className?: string;
  initialColumnVisibility?: VisibilityState;
}

export type DataTableProps<TData> = DataTableCommonProps<TData> &
  (DataTableServerModeProps<TData> | DataTableSimpleModeProps<TData>);
