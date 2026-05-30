'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  className?: string;
}

/**
 * Numeric input with explicit ± stepper buttons. Typing is unrestricted —
 * partial values (empty, below-min, etc.) are held in a local draft so the
 * user can edit freely. In-range values commit live; out-of-range/empty
 * drafts are clamped or restored on blur.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string>(String(value));

  // Re-sync the draft whenever the bound value changes (stepper clicks,
  // arrow-key nudges, theme reset, external updates).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const setValue = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onChange(clamped);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9-]/g, '');
    setDraft(raw);
    if (raw === '' || raw === '-') return;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    // Commit live when the typed value is already in range; otherwise hold
    // the draft as-is until blur (so e.g. typing "1" toward "14" with min=13
    // doesn't snap the preview to 13 mid-keystroke).
    if (parsed >= min && parsed <= max && parsed !== value) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const decrement = () => setValue(value - step);
  const increment = () => setValue(value + step);

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <Label className="text-sm font-medium text-gray-700">{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={decrement}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="h-9 w-9 rounded-md"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              increment();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              decrement();
            }
          }}
          aria-label={label}
          className="h-9 w-16 text-center tabular-nums focus:ring-2 focus:ring-blue-500"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={increment}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="h-9 w-9 rounded-md"
        >
          <Plus className="h-4 w-4" />
        </Button>
        {unit && <span className="ml-1 w-5 text-xs text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}
