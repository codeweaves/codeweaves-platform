import { useState, useMemo, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, X, ChevronDown, Download, Loader2, CalendarIcon, Check } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
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
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[250px] cursor-pointer">
        <SelectValue placeholder={filter.placeholder || filter.label} />
      </SelectTrigger>
      <SelectContent>
        {(filter.options ?? []).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              {option.icon && <option.icon className="size-4" />}
              {option.label}
            </div>
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
        onClick={() => formats[0] && config.onExport(formats[0])}
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
        {formats.map((fmt) => (
          <DropdownMenuCheckboxItem
            key={fmt}
            checked={false}
            onCheckedChange={() => config.onExport(fmt)}
          >
            {FORMAT_LABELS[fmt]}
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
        ? (filter.options ?? []).find((o) => o.value === values[0])?.label || values[0]
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
        <Button variant="outline" className="w-[250px] justify-between gap-0 pl-3 pr-0 font-normal">
          <span className="flex-1 min-w-0 truncate text-left">{displayText}</span>
          {selectedCount > 0 ? (
            <span
              className="w-[30px] flex items-center justify-center shrink-0 opacity-30 hover:opacity-100 cursor-pointer transition-opacity"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange([]);
              }}
            >
              <X className="size-4" />
            </span>
          ) : (
            <span className="w-[30px] flex items-center justify-center shrink-0">
              <ChevronDown className="size-4 opacity-50" />
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="data-table-filter-dropdown w-[250px] max-h-[300px] overflow-y-auto">
        {(filter.options ?? []).map((option) => {
          const checked = values.includes(option.value);
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={(e) => { e.preventDefault(); handleToggle(option.value); }}
              className="flex items-center gap-2 cursor-pointer"
            >
              <div className={cn(
                "size-4 shrink-0 rounded border flex items-center justify-center transition-colors cursor-pointer",
                checked ? "bg-primary border-primary" : "border-input bg-background"
              )}>
                {checked && <Check className="size-3 text-primary-foreground" />}
              </div>
              {option.icon && <option.icon className="size-4" />}
              {option.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildRangeDisplayText(fromValue: string, toValue: string, label: string): string {
  const currentYear = new Date().getFullYear();
  if (!fromValue) return label;

  const fromDate = new Date(fromValue + 'T00:00:00');
  const fromYear = fromDate.getFullYear();

  if (!toValue) {
    const yearSuffix = fromYear !== currentYear ? `, ${fromYear}` : '';
    return `From ${format(fromDate, 'MMM d')}${yearSuffix}`;
  }

  const toDate = new Date(toValue + 'T00:00:00');
  const toYear = toDate.getFullYear();

  // Same day
  if (fromValue === toValue) {
    const yearSuffix = fromYear !== currentYear ? `, ${fromYear}` : '';
    return `${format(fromDate, 'EEE, MMM d')}${yearSuffix}`;
  }

  if (fromYear === toYear) {
    const yearSuffix = fromYear !== currentYear ? `, ${fromYear}` : '';
    return `${format(fromDate, 'MMM d')} – ${format(toDate, 'MMM d')}${yearSuffix}`;
  }

  // Spans two different years — show abbreviated year on each
  return `${format(fromDate, "MMM d ''yy")} – ${format(toDate, "MMM d ''yy")}`;
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return format(date, 'MMM dd, yyyy');
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function DateRangeFilter({
  filter,
  fromValue,
  toValue,
  onFromChange,
  onToChange,
}: {
  filter: DataTableFilterConfig;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string>(fromValue);
  const [pendingTo, setPendingTo] = useState<string>(toValue);

  // Sync pending state when popover opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setPendingFrom(fromValue);
      setPendingTo(toValue);
    }
    setOpen(isOpen);
  };

  const from = pendingFrom ? new Date(pendingFrom + 'T00:00:00') : undefined;
  const to = pendingTo ? new Date(pendingTo + 'T00:00:00') : undefined;
  const hasSelection = fromValue || toValue;
  const hasPendingSelection = pendingFrom && pendingTo;

  const displayText = buildRangeDisplayText(fromValue, toValue, filter.placeholder || filter.label);

  const handleApply = () => {
    onFromChange(pendingFrom);
    onToChange(pendingTo);
    setOpen(false);
  };

  const handleClear = () => {
    setPendingFrom('');
    setPendingTo('');
    onFromChange('');
    onToChange('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[250px] justify-start text-left font-normal gap-0 pl-3 pr-0",
            !hasSelection && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="size-4 shrink-0 mr-2" />
          <span className="flex-1 min-w-0 truncate">{displayText}</span>
          {hasSelection ? (
            <span
              className="w-[30px] flex items-center justify-center shrink-0 opacity-30 hover:opacity-100 cursor-pointer transition-opacity"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClear();
              }}
            >
              <X className="size-4" />
            </span>
          ) : (
            <span className="w-[30px]" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={8} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex flex-col">
          {/* Calendar */}
          <div className="p-2">
            <Calendar
              mode="range"
              defaultMonth={from || new Date()}
              selected={from || to ? { from, to } : undefined}
              onSelect={(range) => {
                setPendingFrom(range?.from ? toDateString(range.from) : '');
                setPendingTo(range?.to ? toDateString(range.to) : '');
              }}
              disabled={{ after: new Date() }}
              numberOfMonths={1}
              className="[&_button[data-range-middle=true]]:bg-primary/[0.05]"
            />
          </div>

          {/* Start / End display */}
          <div className="border-t px-3 py-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-8">Start</span>
              <div className="flex-1 rounded-md border px-3 py-1.5 text-sm">
                {pendingFrom ? formatDateFull(pendingFrom) : <span className="text-muted-foreground">Select start</span>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-8">End</span>
              <div className="flex-1 rounded-md border px-3 py-1.5 text-sm">
                {pendingTo ? formatDateFull(pendingTo) : <span className="text-muted-foreground">Select end</span>}
              </div>
            </div>
          </div>

          {/* Apply button */}
          <div className="border-t px-3 py-2.5">
            <Button
              variant="outline"
              className="w-full"
              size="sm"
              disabled={!hasPendingSelection}
              onClick={handleApply}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComboboxFilter({
  filter,
  value,
  onChange,
}: {
  filter: DataTableFilterConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => filter.options ?? [], [filter.options]);
  const selectedOption = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = inputValue.toLowerCase().trim();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, inputValue]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setInputValue('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleFocus = () => {
    setInputValue('');
    setOpen(true);
  };

  const handleBlur = () => {
    // Delay so onMouseDown on an option can fire before the blur closes the list
    setTimeout(() => {
      setOpen(false);
      setInputValue('');
    }, 150);
  };

  return (
    <div className="relative w-[250px]">
      <input
        ref={inputRef}
        type="text"
        className={cn(
          "flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 pr-[30px] text-sm shadow-xs",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !selectedOption && !open && "text-muted-foreground"
        )}
        placeholder={filter.placeholder || filter.label}
        value={open ? inputValue : (selectedOption?.label ?? '')}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        readOnly={!open}
      />
      {selectedOption && !open ? (
        <span
          className="absolute right-0 top-1/2 -translate-y-1/2 w-[30px] flex items-center justify-center shrink-0 opacity-30 hover:opacity-100 cursor-pointer transition-opacity"
          onPointerDown={(e) => {
            e.preventDefault();
            onChange('');
            setInputValue('');
            setOpen(false);
          }}
        >
          <X className="size-4" />
        </span>
      ) : (
        <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-[30px] size-4 opacity-50 pointer-events-none" />
      )}

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="max-h-[220px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No results</div>
            ) : (
              filtered.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent cursor-pointer transition-colors",
                      isSelected && "font-medium"
                    )}
                  >
                    {option.icon && <option.icon className="size-4 shrink-0" />}
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DataTableToolbar({
  searchConfig,
  searchValue,
  onSearchChange,
  filters,
  filterValues,
  onFilterChange,
  exportConfig,
}: DataTableToolbarProps) {
  return (
    <div data-slot="data-table-toolbar" className="flex flex-wrap items-center justify-between gap-4">
      {/* Search Input + Filters (grouped on the left) */}
      <div data-slot="data-table-toolbar-filters" className="flex flex-wrap items-center gap-2">
        {searchConfig && (
          <div data-slot="data-table-search" className="relative w-[250px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchConfig.placeholder}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="rounded-xl pl-10 pr-[30px]"
            />
            {searchValue && (
              <X
                className="absolute right-0 top-1/2 -translate-y-1/2 size-4 w-[30px] cursor-pointer opacity-30 hover:opacity-100 transition-opacity"
                onClick={() => onSearchChange?.('')}
              />
            )}
          </div>
        )}

        {/* Filter Dropdowns + Date Ranges */}
        {filters?.map((filter) => {
          if (filter.type === 'dateRange') {
            const fromKey = filter.fromKey || `${filter.id}From`;
            const toKey = filter.toKey || `${filter.id}To`;
            return (
              <div key={filter.id} data-slot="data-table-filter" data-filter-id={filter.id} data-filter-type="dateRange">
                <DateRangeFilter
                  filter={filter}
                  fromValue={(filterValues?.[fromKey] as string) ?? ''}
                  toValue={(filterValues?.[toKey] as string) ?? ''}
                  onFromChange={(value) => onFilterChange?.(fromKey, value)}
                  onToChange={(value) => onFilterChange?.(toKey, value)}
                />
              </div>
            );
          }
          if (filter.type === 'combobox') {
            return (
              <div key={filter.id} data-slot="data-table-filter" data-filter-id={filter.id} data-filter-type="combobox">
                <ComboboxFilter
                  filter={filter}
                  value={(filterValues?.[filter.id] as string) ?? ''}
                  onChange={(value) => onFilterChange?.(filter.id, value)}
                />
              </div>
            );
          }
          if (filter.multiSelect) {
            return (
              <div key={filter.id} data-slot="data-table-filter" data-filter-id={filter.id} data-filter-type="multiSelect">
                <MultiSelectFilter
                  filter={filter}
                  values={
                    Array.isArray(filterValues?.[filter.id])
                      ? (filterValues[filter.id] as string[])
                      : []
                  }
                  onChange={(values) => onFilterChange?.(filter.id, values)}
                />
              </div>
            );
          }
          return (
            <div key={filter.id} data-slot="data-table-filter" data-filter-id={filter.id} data-filter-type="select">
              <SingleSelectFilter
                filter={filter}
                value={(filterValues?.[filter.id] as string) ?? 'all'}
                onChange={(value) => onFilterChange?.(filter.id, value)}
              />
            </div>
          );
        })}
      </div>

      {/* Export (on the right) */}
      {exportConfig && (
        <div data-slot="data-table-export" className="flex items-center gap-2">
          <ExportButton config={exportConfig} />
        </div>
      )}
    </div>
  );
}
