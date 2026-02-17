import { ColumnDef, SortingState, Table } from '@tanstack/react-table';

// ============================================================================
// Filter Types
// ============================================================================

/** Single option within a filter dropdown */
export interface DataTableFilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/** Configuration for a filter dropdown */
export interface DataTableFilterConfig {
  id: string;
  label: string;
  placeholder?: string;
  options: DataTableFilterOption[];
  /** Enable multi-select for this filter */
  multiSelect?: boolean;
}

// ============================================================================
// Search Types
// ============================================================================

/** Configuration for the search input */
export interface DataTableSearchConfig {
  placeholder: string;
  searchKey: string;
  debounceMs?: number;
}

// ============================================================================
// Export Types
// ============================================================================

/** Export format options */
export type DataTableExportFormat = 'csv' | 'xlsx' | 'json';

/** Configuration for the export button */
export interface DataTableExportConfig {
  /** Callback when export is triggered */
  onExport: (format: DataTableExportFormat) => void | Promise<void>;
  /** Available formats (default: ['csv']) */
  formats?: DataTableExportFormat[];
  /** Custom label for the button */
  label?: string;
  /** Show loading state during export */
  isExporting?: boolean;
}

// ============================================================================
// Expandable Row Types
// ============================================================================

/** Configuration for a single cell in a sub-row (used when aligning with parent columns) */
export interface DataTableSubRowCell {
  /** Content to render in this cell */
  content: React.ReactNode;
  /** Number of parent columns this cell should span (default: 1) */
  colSpan?: number;
  /** Custom CSS class for this cell */
  className?: string;
}

/** Configuration for expandable/nested rows */
export interface DataTableExpandableConfig<TData, TSubRow> {
  /** Function to extract sub-rows from a parent row */
  getSubRows: (row: TData) => TSubRow[] | undefined;

  /**
   * Render sub-row as individual cells aligned with parent columns.
   * Return an array of DataTableSubRowCell objects where each cell
   * can span one or more parent columns.
   *
   * Example: If parent has columns [Name, Email, Role, Phone, Status]
   * Return: [
   *   { content: <span>Office Name</span>, colSpan: 1 },  // aligns with Name
   *   { content: <span>Address</span>, colSpan: 2 },      // spans Email + Role
   *   { content: <span>Phone</span>, colSpan: 1 },        // aligns with Phone
   *   { content: <span>Active</span>, colSpan: 1 },       // aligns with Status
   * ]
   */
  renderSubRowCells?: (subRow: TSubRow, parentRow: TData, index: number) => DataTableSubRowCell[];

  /**
   * @deprecated Use renderSubRowCells for column-aligned sub-rows.
   * This renders a single cell spanning all columns (legacy behavior).
   */
  renderSubRow?: (subRow: TSubRow, parentRow: TData, index: number) => React.ReactNode;

  /** Number of columns the sub-row should span (only used with renderSubRow, defaults to all columns + expand column) */
  subRowColSpan?: number;

  /** Whether child rows should have left indentation styling (default: true) */
  indentChildren?: boolean;

  /** Custom CSS class for child rows */
  childRowClassName?: string;
}

/** Props for the expand toggle button component */
export interface DataTableExpandToggleProps {
  /** Whether the row is currently expanded */
  isExpanded: boolean;
  /** Callback to toggle expansion state */
  onToggle: () => void;
  /** Whether this row has children to expand */
  hasChildren: boolean;
}

// ============================================================================
// Text Customization
// ============================================================================

/** Customizable text labels for the DataTable */
export interface DataTableTexts {
  /** Text for selected rows (default: "row(s) selected") */
  selected?: string;
  /** Text shown when no results (default: "No results found.") */
  noResults?: string;
  /** Label for rows per page (default: "Rows per page") */
  rowsPerPage?: string;
  /** Word "of" in pagination (default: "of") */
  of?: string;
  /** Word "Page" in pagination (default: "Page") */
  page?: string;
}

// ============================================================================
// Render Props
// ============================================================================

/** Props passed to custom header renderer */
export interface DataTableHeaderRenderProps {
  title?: string;
  totalItems: number;
}

/** Props passed to custom footer renderer */
export interface DataTableFooterRenderProps {
  selectedCount: number;
  totalItems: number;
}

/** Props passed to custom toolbar renderer */
export interface DataTableToolbarRenderProps {
  searchConfig?: DataTableSearchConfig;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: DataTableFilterConfig[];
  filterValues?: Record<string, string | string[]>;
  onFilterChange?: (filterId: string, value: string | string[]) => void;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
  exportConfig?: DataTableExportConfig;
}

// ============================================================================
// Component Props
// ============================================================================

/** Props for the DataTableToolbar component */
export interface DataTableToolbarProps {
  searchConfig?: DataTableSearchConfig;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: DataTableFilterConfig[];
  filterValues?: Record<string, string | string[]>;
  onFilterChange?: (filterId: string, value: string | string[]) => void;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
  exportConfig?: DataTableExportConfig;
}

/** Props for the DataTablePagination component */
export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  totalItems: number;
  selectedCount: number;
  pageSizeOptions?: number[];
  onPaginationChange?: (pageIndex: number, pageSize: number) => void;
  texts?: DataTableTexts;
  /** Hide the selection count text (default: false) */
  hideSelectionCount?: boolean;
}

/** Props for the DataTableColumnHeader component */
export interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
  column: import('@tanstack/react-table').Column<TData, TValue>;
  title: string;
}

/** Props for the DataTableSkeleton component */
export interface DataTableSkeletonProps {
  columnCount: number;
  rowCount?: number;
}

// ============================================================================
// Main DataTable Props
// ============================================================================

/** Main DataTable component props */
export interface DataTableProps<TData, TValue, TSubRow = unknown> {
  /** Column definitions from @tanstack/react-table */
  columns: ColumnDef<TData, TValue>[];
  /** Data array to display */
  data: TData[];

  // Title with count
  /** Optional title displayed above the table */
  title?: string;
  /** Total number of items (for pagination display) */
  totalItems?: number;
  /** Total number of pages */
  pageCount: number;

  // ============================================================================
  // Simplified API (recommended) - DataTable manages state internally
  // ============================================================================

  /**
   * Callback when table state changes (pagination, sorting, search, filters).
   * When provided, DataTable manages all state internally and calls this
   * whenever the user changes any table parameter.
   */
  onFetch?: (params: DataTableFetchParams) => void;
  /** Initial page size (default: 10) */
  initialPageSize?: number;
  /** Search input configuration */
  searchConfig?: DataTableSearchConfig;
  /** Filter configurations */
  filters?: DataTableFilterConfig[];
  /** Export button configuration (optional) */
  exportConfig?: DataTableExportConfig;

  // ============================================================================
  // Controlled API (for advanced use cases)
  // Pass these to fully control state from parent component
  // ============================================================================

  /** Current page index (0-based) - controlled mode */
  pageIndex?: number;
  /** Number of items per page - controlled mode */
  pageSize?: number;
  /** Callback when pagination changes - controlled mode */
  onPaginationChange?: (pageIndex: number, pageSize: number) => void;
  /** Current sorting state - controlled mode */
  sorting?: SortingState;
  /** Callback when sorting changes - controlled mode */
  onSortingChange?: (sorting: SortingState) => void;
  /** Current search value - controlled mode */
  searchValue?: string;
  /** Callback when search value changes - controlled mode */
  onSearchChange?: (value: string) => void;
  /** Current filter values - controlled mode */
  filterValues?: Record<string, string | string[]>;
  /** Callback when filter value changes - controlled mode */
  onFilterChange?: (filterId: string, value: string | string[]) => void;
  /** Callback to clear all filters, search, and sorting - controlled mode */
  onClearAll?: () => void;

  // Row selection
  /** Enable row selection checkboxes */
  enableRowSelection?: boolean;
  /** Current row selection state */
  rowSelection?: Record<string, boolean>;
  /** Callback when row selection changes */
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;

  // Loading state
  /** Show loading skeleton */
  isLoading?: boolean;

  // ============================================================================
  // Expandable Rows
  // ============================================================================

  /** Configuration for expandable rows with nested data */
  expandableConfig?: DataTableExpandableConfig<TData, TSubRow>;

  /** Controlled expanded state - record of rowId to boolean */
  expanded?: Record<string, boolean>;

  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: Record<string, boolean>) => void;

  /** Default expanded state for initial render (uncontrolled mode) */
  defaultExpanded?: Record<string, boolean>;

  /** Function to get unique row ID (defaults to row.id, row.uniqueId, or index) */
  getRowId?: (row: TData, index: number) => string;

  // ============================================================================
  // Customization Options
  // ============================================================================

  /** Available page size options (default: [10, 20, 30, 50, 100]) */
  pageSizeOptions?: number[];

  /** Use fixed table layout for consistent column widths (default: true) */
  fixedLayout?: boolean;

  /** Custom text labels */
  texts?: DataTableTexts;

  // Section visibility
  /** Show/hide the header section with title (default: true) */
  showHeader?: boolean;
  /** Show/hide the toolbar with search and filters (default: true) */
  showToolbar?: boolean;
  /** Show/hide the pagination section (default: true) */
  showPagination?: boolean;
  /** Hide the selection count text in pagination (default: false) */
  hideSelectionCount?: boolean;

  // Render props for customization
  /** Custom renderer for the header section */
  renderHeader?: (props: DataTableHeaderRenderProps) => React.ReactNode;
  /** Custom renderer for the empty state */
  renderEmpty?: () => React.ReactNode;
  /** Custom renderer for the loading state */
  renderLoading?: () => React.ReactNode;
  /** Custom renderer for the toolbar */
  renderToolbar?: (props: DataTableToolbarRenderProps) => React.ReactNode;
  /** Custom renderer for the footer/pagination area */
  renderFooter?: (props: DataTableFooterRenderProps) => React.ReactNode;
}

// ============================================================================
// Utility Types (for consumers)
// ============================================================================

/** Generic paginated API response structure */
export interface PaginatedResponse<T> {
  success: boolean;
  data?: {
    items: T[];
    pagination: {
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
    };
  };
  message?: string;
}

/** Query parameters for backend API */
export interface DataTableQueryParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, string | string[]>;
}

/** Fetch params passed to onFetch callback */
export interface DataTableFetchParams {
  page: number;
  pageSize: number;
  sorting: SortingState;
  search: string;
  filters: Record<string, string | string[]>;
}

/** Column definition with extended meta */
export type DataTableColumnDef<TData, TValue = unknown> = ColumnDef<TData, TValue> & {
  enableSorting?: boolean;
  meta?: {
    headerClassName?: string;
    cellClassName?: string;
  };
};
