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

function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

const PRESETS: { value: DatePreset; label: string; days: number }[] = [
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '14', label: 'Last 14 days', days: 14 },
  { value: '30', label: 'Last 30 days', days: 30 },
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
  const minDate = useMemo(() => subDays(new Date(), 365), []);

  // Show left calendar at one month before endDate so the range is visible
  const defaultMonth = useMemo(() => {
    const end = endDate || today;
    return startOfMonth(subDays(end, 28));
  }, [endDate, today]);

  const handleRangeSelect = (range: DayPickerDateRange | undefined) => {
    if (!range) return;
    if (range.from) onStartDateChange(range.from);
    if (range.to) onEndDateChange(range.to);
    if (preset !== 'custom') onPresetChange('custom');
  };

  const handlePresetClick = (p: (typeof PRESETS)[number]) => {
    onPresetChange(p.value);
    onStartDateChange(subDays(new Date(), p.days));
    onEndDateChange(new Date());
    setOpen(false);
  };

  const displayLabel =
    preset === 'custom'
      ? `${formatDisplay(startDate)} – ${formatDisplay(endDate)}`
      : PRESETS.find((p) => p.value === preset)?.label ?? 'Select range';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarIcon className="size-4" />
          <span>{displayLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto p-0" align="start">
        {/* Presets sidebar */}
        <div className="flex flex-col gap-1 border-r p-3">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={preset === p.value ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start text-sm"
              onClick={() => handlePresetClick(p)}
            >
              {p.label}
            </Button>
          ))}
          <Button
            variant={preset === 'custom' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start text-sm"
            onClick={() => onPresetChange('custom')}
          >
            Custom range
          </Button>
        </div>

        {/* Dual month calendar — previous month + current month */}
        <div className="p-2">
          <Calendar
            mode="range"
            selected={{ from: startDate, to: endDate }}
            onSelect={handleRangeSelect}
            numberOfMonths={2}
            disabled={{ after: today, before: minDate }}
            defaultMonth={defaultMonth}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
