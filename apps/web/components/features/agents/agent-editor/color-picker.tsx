'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  label,
  id,
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

  // When used with a label, render in a grid-cols-3 layout matching the reference
  if (label) {
    return (
      <div className={cn('grid grid-cols-3 gap-4 items-center', className)}>
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <div className="col-span-2 flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild disabled={disabled}>
              <button
                type="button"
                className={cn(
                  'h-12 w-12 shrink-0 cursor-pointer rounded-full border-2 border-border shadow-sm hover:shadow-md transition-shadow',
                  disabled && 'pointer-events-none opacity-50',
                )}
                style={{ backgroundColor: value }}
                aria-label={`Pick ${label}`}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="start">
              <HexColorPicker color={localHex} onChange={handlePickerChange} />
            </PopoverContent>
          </Popover>
          <div className="flex-1">
            <input
              type="text"
              id={id}
              value={localHex}
              onChange={(e) => handleHexInput(e.target.value)}
              onBlur={handleHexBlur}
              maxLength={7}
              placeholder="#000000"
              disabled={disabled}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent"
            />
          </div>
        </div>
      </div>
    );
  }

  // Without label: compact inline version (used in branding grid layouts)
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'h-12 w-12 shrink-0 cursor-pointer rounded-full border-2 border-border shadow-sm hover:shadow-md transition-shadow',
              disabled && 'pointer-events-none opacity-50',
            )}
            style={{ backgroundColor: value }}
            aria-label="Pick color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <HexColorPicker color={localHex} onChange={handlePickerChange} />
        </PopoverContent>
      </Popover>
      <div className="flex-1">
        <input
          type="text"
          value={localHex}
          onChange={(e) => handleHexInput(e.target.value)}
          onBlur={handleHexBlur}
          maxLength={7}
          placeholder="#000000"
          disabled={disabled}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent"
        />
      </div>
    </div>
  );
}
