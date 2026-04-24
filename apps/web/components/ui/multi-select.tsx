'use client';

import * as React from 'react';
import { CheckIcon, ChevronDownIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MultiSelectProps {
  id?: string;
  options: MultiSelectOption[];
  values: string[];
  onValuesChange?: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  selectedLabel?: (count: number) => string;
}

function MultiSelect({
  id,
  options,
  values,
  onValuesChange,
  placeholder = 'Select...',
  disabled = false,
  className,
  triggerClassName,
  selectedLabel,
}: MultiSelectProps) {
  const selectedCount = values.length;

  const displayText = React.useMemo(() => {
    if (selectedCount === 0) return placeholder;
    if (selectedCount === 1) {
      return options.find((o) => o.value === values[0])?.label ?? values[0];
    }
    if (selectedLabel) return selectedLabel(selectedCount);
    return `${selectedCount} selected`;
  }, [selectedCount, values, options, placeholder, selectedLabel]);

  const handleToggle = (optionValue: string) => {
    if (values.includes(optionValue)) {
      onValuesChange?.(values.filter((v) => v !== optionValue));
    } else {
      onValuesChange?.([...values, optionValue]);
    }
  };

  const handleClear = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onValuesChange?.([]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          type='button'
          role='combobox'
          disabled={disabled}
          data-slot='multi-select-trigger'
          data-placeholder={selectedCount === 0 ? '' : undefined}
          className={cn(
            "border-input data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-transparent pl-3 pr-0 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            triggerClassName,
          )}
        >
          <span className='line-clamp-1 flex-1 min-w-0 text-left'>{displayText}</span>
          {selectedCount > 0 ? (
            <span
              role='button'
              tabIndex={-1}
              aria-label='Clear selection'
              className='pointer-events-auto flex w-[30px] shrink-0 cursor-pointer items-center justify-center opacity-40 transition-opacity hover:opacity-100'
              onPointerDown={handleClear}
            >
              <X className='size-4' />
            </span>
          ) : (
            <span className='flex w-[30px] shrink-0 items-center justify-center'>
              <ChevronDownIcon className='size-4 opacity-50' />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className={cn('w-[var(--radix-dropdown-menu-trigger-width)] min-w-0', className)}
      >
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={(e) => {
                e.preventDefault();
                if (!option.disabled) handleToggle(option.value);
              }}
              disabled={option.disabled}
              className={cn('flex cursor-pointer items-center gap-2', checked && 'font-medium')}
            >
              <div
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                  checked ? 'border-primary bg-primary' : 'border-input bg-background',
                )}
              >
                {checked && <CheckIcon className='size-3 text-primary-foreground' />}
              </div>
              <span className='min-w-0 flex-1 truncate'>{option.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { MultiSelect, type MultiSelectOption, type MultiSelectProps };
