'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return format(date, 'MMM dd, yyyy');
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

  if (fromValue === toValue) {
    const yearSuffix = fromYear !== currentYear ? `, ${fromYear}` : '';
    return `${format(fromDate, 'EEE, MMM d')}${yearSuffix}`;
  }

  if (fromYear === toYear) {
    const yearSuffix = fromYear !== currentYear ? `, ${fromYear}` : '';
    return `${format(fromDate, 'MMM d')} – ${format(toDate, 'MMM d')}${yearSuffix}`;
  }

  return `${format(fromDate, "MMM d ''yy")} – ${format(toDate, "MMM d ''yy")}`;
}

export interface DateRangePickerProps {
  /** Selected start date (YYYY-MM-DD) */
  fromValue: string;
  /** Selected end date (YYYY-MM-DD) */
  toValue: string;
  /** Called when Apply is clicked with the new range */
  onChange: (fromValue: string, toValue: string) => void;
  /** Placeholder / label shown when no selection */
  placeholder?: string;
  /** Disallow dates after today (default: true) */
  disableFuture?: boolean;
  /** Number of months shown in the calendar (default: 1) */
  numberOfMonths?: number;
  /** Custom class for the trigger button */
  triggerClassName?: string;
  disabled?: boolean;
  /** Show the X clear button (default: true) */
  showClear?: boolean;
}

export function DateRangePicker({
  fromValue,
  toValue,
  onChange,
  placeholder = 'Pick a date range',
  disableFuture = true,
  numberOfMonths = 1,
  triggerClassName,
  disabled = false,
  showClear = true,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [pendingFrom, setPendingFrom] = React.useState(fromValue);
  const [pendingTo, setPendingTo] = React.useState(toValue);

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
  const displayText = buildRangeDisplayText(fromValue, toValue, placeholder);

  const handleApply = () => {
    onChange(pendingFrom, pendingTo);
    setOpen(false);
  };

  const handleClear = () => {
    setPendingFrom('');
    setPendingTo('');
    onChange('', '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          disabled={disabled}
          className={cn(
            'w-[250px] justify-start gap-0 pl-3 pr-0 text-left font-normal',
            !hasSelection && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <CalendarIcon className='mr-2 size-4 shrink-0' />
          <span className='min-w-0 flex-1 truncate'>{displayText}</span>
          {showClear && hasSelection ? (
            <span
              role='button'
              tabIndex={-1}
              aria-label='Clear date range'
              className='flex w-[30px] shrink-0 cursor-pointer items-center justify-center opacity-40 transition-opacity hover:opacity-100'
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClear();
              }}
            >
              <X className='size-4' />
            </span>
          ) : (
            <span className='w-[30px]' />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-auto p-0'
        align='start'
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className='flex flex-col'>
          {/* Calendar */}
          <div className='p-2'>
            <Calendar
              mode='range'
              defaultMonth={from || new Date()}
              selected={from || to ? { from, to } : undefined}
              onSelect={(range) => {
                setPendingFrom(range?.from ? toDateString(range.from) : '');
                setPendingTo(range?.to ? toDateString(range.to) : '');
              }}
              disabled={disableFuture ? { after: new Date() } : undefined}
              numberOfMonths={numberOfMonths}
              className='[&_button[data-range-middle=true]]:bg-primary/[0.05]'
            />
          </div>

          {/* Start / End display */}
          <div className='space-y-2 border-t px-3 py-3'>
            <div className='flex items-center gap-3'>
              <span className='w-8 text-xs text-muted-foreground'>Start</span>
              <div className='flex-1 rounded-md border px-3 py-1.5 text-sm'>
                {pendingFrom ? (
                  formatDateFull(pendingFrom)
                ) : (
                  <span className='text-muted-foreground'>Select start</span>
                )}
              </div>
            </div>
            <div className='flex items-center gap-3'>
              <span className='w-8 text-xs text-muted-foreground'>End</span>
              <div className='flex-1 rounded-md border px-3 py-1.5 text-sm'>
                {pendingTo ? (
                  formatDateFull(pendingTo)
                ) : (
                  <span className='text-muted-foreground'>Select end</span>
                )}
              </div>
            </div>
          </div>

          {/* Apply button */}
          <div className='border-t px-3 py-2.5'>
            <Button
              variant='outline'
              className='w-full'
              size='sm'
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
