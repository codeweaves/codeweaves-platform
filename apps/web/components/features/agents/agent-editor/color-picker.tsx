'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  label,
  disabled,
  className,
}: ColorPickerProps) {
  const [localHex, setLocalHex] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorRef = useRef<string | null>(null);

  useEffect(() => {
    setLocalHex(value);
  }, [value]);

  const handlePickerChange = useCallback(
    (color: string) => {
      setLocalHex(color);
      pendingColorRef.current = color;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pendingColorRef.current = null;
        onChange(color);
      }, 100);
    },
    [onChange],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pendingColorRef.current) {
        onChange(pendingColorRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHexInput = useCallback(
    (input: string) => {
      const hex = input.startsWith('#') ? input : `#${input}`;
      setLocalHex(hex);
      if (HEX_REGEX.test(hex)) {
        onChange(hex);
      }
    },
    [onChange],
  );

  const handleHexBlur = useCallback(() => {
    if (!HEX_REGEX.test(localHex)) {
      setLocalHex(value);
    }
  }, [localHex, value]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'h-8 w-8 shrink-0 cursor-pointer rounded-md border border-input shadow-xs',
              disabled && 'pointer-events-none opacity-50',
            )}
            style={{ backgroundColor: value }}
            aria-label={label ? `Pick ${label}` : 'Pick color'}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <HexColorPicker color={localHex} onChange={handlePickerChange} />
          <Input
            value={localHex}
            onChange={(e) => handleHexInput(e.target.value)}
            onBlur={handleHexBlur}
            className="mt-2"
            maxLength={7}
          />
        </PopoverContent>
      </Popover>
      <span className="font-mono text-sm text-muted-foreground">
        {localHex}
      </span>
    </div>
  );
}
