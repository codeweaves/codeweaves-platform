'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Table } from '@tanstack/react-table';
import { Columns3, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DataTableToolbarConfig } from './data-table.types';

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  config: DataTableToolbarConfig;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export function DataTableToolbar<TData>({
  table,
  config,
  searchValue,
  onSearchChange,
}: DataTableToolbarProps<TData>) {
  const [localSearch, setLocalSearch] = useState(searchValue ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when external search value changes
  useEffect(() => {
    setLocalSearch(searchValue ?? '');
  }, [searchValue]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.trimStart();
      setLocalSearch(value);

      if (!onSearchChange) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearchChange(value.trim());
      }, 300);
    },
    [onSearchChange],
  );

  const hasSearch = onSearchChange !== undefined;
  const showColumnVisibility = config.showColumnVisibility ?? false;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 flex-1">
        {hasSearch && (
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={config.searchPlaceholder ?? 'Search...'}
              value={localSearch}
              onChange={handleSearchChange}
              className="pl-9"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showColumnVisibility && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4" />
                <span className="hidden lg:inline ml-2">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== 'undefined' &&
                    column.getCanHide(),
                )
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {config.actions}
      </div>
    </div>
  );
}
