'use client';

import { useMemo, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import type { DateRange as DayPickerDateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type DatePreset = '7' | '14' | '30' | 'custom';

interface DateRangeFilterProps {
  preset: DatePreset;
  startDate: Date;
  endDate: Date;
  onPresetChange: (preset: DatePreset) => void;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}

function formatDisplay(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: '7', label: '7D' },
  { value: '14', label: '14D' },
  { value: '30', label: '30D' },
];

export function DateRangeFilter({
  preset,
  startDate,
  endDate,
  onPresetChange,
  onStartDateChange,
  onEndDateChange,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d;
  }, []);

  const handleRangeSelect = (range: DayPickerDateRange | undefined) => {
    if (!range) return;
    if (range.from) onStartDateChange(range.from);
    if (range.to) onEndDateChange(range.to);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <Button
          key={p.value}
          variant={preset === p.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onPresetChange(p.value)}
        >
          {p.label}
        </Button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={preset === 'custom' ? 'default' : 'outline'}
            size="sm"
            className={cn('gap-2', preset === 'custom' && 'min-w-60')}
            onClick={() => {
              if (preset !== 'custom') onPresetChange('custom');
            }}
          >
            <CalendarIcon className="h-4 w-4" />
            {preset === 'custom' ? (
              <span>
                {formatDisplay(startDate)} – {formatDisplay(endDate)}
              </span>
            ) : (
              'Custom'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from: startDate, to: endDate }}
            onSelect={handleRangeSelect}
            numberOfMonths={2}
            disabled={{ after: today, before: minDate }}
            defaultMonth={startDate}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
