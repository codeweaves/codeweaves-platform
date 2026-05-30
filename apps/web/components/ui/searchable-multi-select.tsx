'use client';

import * as React from 'react';
import { CheckIcon, ChevronDownIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';

interface SearchableMultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableMultiSelectProps {
  id?: string;
  options: SearchableMultiSelectOption[];
  values: string[];
  onValuesChange?: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  selectedLabel?: (count: number) => string;
}

function SearchableMultiSelect({
  id,
  options,
  values,
  onValuesChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found',
  disabled = false,
  className,
  triggerClassName,
  selectedLabel,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (triggerRef.current) {
      const dialog = triggerRef.current.closest('[role="dialog"]');
      setPortalContainer(dialog as HTMLElement | null);
    }
  }, []);

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
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type='button'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          data-slot='searchable-multi-select-trigger'
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
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', className)}
        onWheel={(e) => e.stopPropagation()}
      >
        <Command
          filter={(value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={searchPlaceholder} className='text-sm sm:text-sm' />
          <CommandList className='max-h-48 [scrollbar-width:thin]'>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = values.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    disabled={option.disabled}
                    onSelect={() => {
                      if (!option.disabled) handleToggle(option.value);
                    }}
                    className={cn('pr-8 text-sm sm:text-sm', checked && 'font-medium')}
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
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export {
  SearchableMultiSelect,
  type SearchableMultiSelectOption,
  type SearchableMultiSelectProps,
};
