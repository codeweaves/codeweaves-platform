import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, X, ChevronDown, Download, Loader2 } from 'lucide-react';
import {
  DataTableToolbarProps,
  DataTableFilterConfig,
  DataTableExportConfig,
  DataTableExportFormat,
} from './types';

function SingleSelectFilter({
  filter,
  value,
  onChange,
}: {
  filter: DataTableFilterConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const selectedLabel =
    value && value !== 'all'
      ? filter.options.find((o) => o.value === value)?.label
      : null;

  return (
    <Select value={value === 'all' ? undefined : value} onValueChange={onChange}>
      <SelectTrigger className="w-40 cursor-pointer">
        <span className={selectedLabel ? 'truncate' : 'text-muted-foreground truncate'}>
          {selectedLabel || filter.placeholder || filter.label}
        </span>
      </SelectTrigger>
      <SelectContent className="w-40 max-w-40">
        <SelectItem value="all">All</SelectItem>
        {filter.options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="[&>span:last-child]:truncate [&>span:last-child]:block">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const FORMAT_LABELS: Record<DataTableExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  json: 'JSON',
};

function ExportButton({ config }: { config: DataTableExportConfig }) {
  const formats = config.formats ?? ['csv'];
  const label = config.label ?? 'Export';

  // Single format - just a button
  if (formats.length === 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => config.onExport(formats[0]!)}
        disabled={config.isExporting}
        className="h-9"
      >
        {config.isExporting ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Download className="mr-2 size-4" />
        )}
        {label}
      </Button>
    );
  }

  // Multiple formats - dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={config.isExporting} className="h-9">
          {config.isExporting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          {label}
          <ChevronDown className="ml-2 size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map((format) => (
          <DropdownMenuCheckboxItem
            key={format}
            checked={false}
            onCheckedChange={() => config.onExport(format)}
          >
            {FORMAT_LABELS[format]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MultiSelectFilter({
  filter,
  values,
  onChange,
}: {
  filter: DataTableFilterConfig;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const selectedCount = values.length;
  const displayText =
    selectedCount === 0
      ? filter.placeholder || filter.label
      : selectedCount === 1
        ? filter.options.find((o) => o.value === values[0])?.label || values[0]
        : `${selectedCount} selected`;

  const handleToggle = (optionValue: string) => {
    if (values.includes(optionValue)) {
      onChange(values.filter((v) => v !== optionValue));
    } else {
      onChange([...values, optionValue]);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto min-h-9 w-40 justify-between">
          <span className="whitespace-normal text-left leading-tight">{displayText}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {filter.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={values.includes(option.value)}
            onCheckedChange={() => handleToggle(option.value)}
          >
            <div className="flex items-center gap-2">
              {option.icon && <option.icon className="size-4" />}
              {option.label}
            </div>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DataTableToolbar({
  searchConfig,
  searchValue,
  onSearchChange,
  filters,
  filterValues,
  onFilterChange,
  onClearAll,
  hasActiveFilters,
  exportConfig,
}: DataTableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search Input */}
      {searchConfig && (
        <div className="relative min-w-50 max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="data-table-search"
            name="data-table-search"
            placeholder={searchConfig.placeholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="rounded-xl pl-10"
          />
        </div>
      )}

      {/* Filter Dropdowns and Clear Button */}
      <div className="flex items-center gap-2">
        {filters?.map((filter) =>
          filter.multiSelect ? (
            <MultiSelectFilter
              key={filter.id}
              filter={filter}
              values={
                Array.isArray(filterValues?.[filter.id])
                  ? (filterValues[filter.id] as string[])
                  : []
              }
              onChange={(values) => onFilterChange?.(filter.id, values)}
            />
          ) : (
            <SingleSelectFilter
              key={filter.id}
              filter={filter}
              value={(filterValues?.[filter.id] as string) ?? 'all'}
              onChange={(value) => onFilterChange?.(filter.id, value)}
            />
          )
        )}

        {/* Clear All Button */}
        {hasActiveFilters && onClearAll && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-9 px-2 text-muted-foreground"
          >
            <X className="mr-1 size-4" />
            Clear
          </Button>
        )}

        {/* Export Button */}
        {exportConfig && <ExportButton config={exportConfig} />}
      </div>
    </div>
  );
}
