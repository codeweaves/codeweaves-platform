'use client';

import * as React from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';

interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  renderOption?: (option: SearchableSelectOption) => React.ReactNode;
}

function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found',
  disabled = false,
  className,
  triggerClassName,
  renderOption,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);

  // Find the closest dialog element to portal into (keeps focus within dialog's focus trap)
  React.useEffect(() => {
    if (triggerRef.current) {
      const dialog = triggerRef.current.closest('[role="dialog"]');
      setPortalContainer(dialog as HTMLElement | null);
    }
  }, []);

  // Get selected option
  const selectedOption = React.useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type='button'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          data-slot='searchable-select-trigger'
          data-placeholder={!selectedOption ? '' : undefined}
          className={cn(
            "border-input data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            triggerClassName,
          )}
        >
          <span className='line-clamp-1 flex items-center gap-2'>
            {selectedOption ? (renderOption ? renderOption(selectedOption) : selectedOption.label) : placeholder}
          </span>
          <ChevronDownIcon className='size-4 opacity-50' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', className)}
        onWheel={(e) => e.stopPropagation()}
      >
        <Command filter={(value: string, search: string) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={searchPlaceholder} className='text-sm sm:text-sm' />
          <CommandList className='max-h-48 [scrollbar-width:thin]'>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  disabled={option.disabled}
                  onSelect={() => {
                    if (!option.disabled) {
                      onValueChange?.(option.value === value ? '' : option.value);
                      setOpen(false);
                    }
                  }}
                  className='pr-8 text-sm sm:text-sm'
                >
                  <span className='min-w-0 flex-1 truncate text-sm'>{renderOption ? renderOption(option) : option.label}</span>
                  {option.value === value && (
                    <span className='absolute right-2 flex size-3.5 items-center justify-center'>
                      <CheckIcon className='size-4' />
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { SearchableSelect, type SearchableSelectOption, type SearchableSelectProps };
