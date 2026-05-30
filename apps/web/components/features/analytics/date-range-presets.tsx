'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

interface Preset {
  label: string;
  range: () => { from: string; to: string };
}

// Ranges are inclusive of today, computed in local time (the page interprets
// them per the timezone toggle). "Last 7 days" = today plus the prior 6.
const PRESETS: Preset[] = [
  { label: 'Today', range: () => ({ from: fmt(new Date()), to: fmt(new Date()) }) },
  { label: 'Last 7 days', range: () => ({ from: fmt(daysAgo(6)), to: fmt(new Date()) }) },
  { label: 'Last 30 days', range: () => ({ from: fmt(daysAgo(29)), to: fmt(new Date()) }) },
  { label: 'Last 90 days', range: () => ({ from: fmt(daysAgo(89)), to: fmt(new Date()) }) },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) };
    },
  },
];

interface DateRangePresetsProps {
  fromValue: string;
  toValue: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}

/**
 * Quick date-range presets for analytics. Sits beside the calendar picker so
 * the common ranges are one click away; the calendar stays for custom ranges.
 * The label reflects the active preset, or "Custom" when the range matches none.
 */
export function DateRangePresets({ fromValue, toValue, onChange, className }: DateRangePresetsProps) {
  const active = PRESETS.find((p) => {
    const r = p.range();
    return r.from === fromValue && r.to === toValue;
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn('justify-between gap-2 font-normal', className)}>
          {active?.label ?? 'Custom range'}
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PRESETS.map((p) => {
          const r = p.range();
          const isActive = r.from === fromValue && r.to === toValue;
          return (
            <DropdownMenuItem
              key={p.label}
              onClick={() => onChange(r.from, r.to)}
              className={cn(isActive && 'font-medium text-primary')}
            >
              {p.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
