"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { HexColorPicker } from "react-colorful";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  checkContrast,
  suggestAccessible,
  type ContrastLevel,
} from "@repo/validation";

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Failure-only WCAG readout.
 *
 * Nothing is rendered when a colour passes: a line under every field just added
 * noise to rows that were already fine, and pushed the layout around. The point
 * is to interrupt a bad choice, not to congratulate a good one.
 */
function ContrastBadge({
  contrast,
  suggestion,
  onApply,
  className,
}: {
  contrast: NonNullable<ReturnType<typeof checkContrast>>;
  suggestion: string | null;
  onApply: (hex: string) => void;
  className?: string;
}) {
  if (contrast.passes) return null;
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
        className,
      )}
    >
      <span className="font-medium text-destructive">
        Contrast {contrast.ratio}:1, needs {contrast.required}:1
      </span>
      {suggestion && (
        <button
          type="button"
          onClick={() => onApply(suggestion)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-medium hover:bg-accent"
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: suggestion }}
            aria-hidden="true"
          />
          Use {suggestion}
        </button>
      )}
    </p>
  );
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /**
   * The colour this one sits on. Supplying it turns on a live WCAG readout, so
   * an inaccessible choice is visible while picking rather than months later in
   * a client's audit report. Omit for colours with no text relationship.
   */
  contrastAgainst?: string;
  /** 'text' needs 4.5:1, 'large' and 'ui' need 3:1. Defaults to 'text'. */
  contrastLevel?: ContrastLevel;
}

export function ColorPicker({
  value,
  onChange,
  label,
  id,
  disabled,
  className,
  contrastAgainst,
  contrastLevel = "text",
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
      const hex = input.startsWith("#") ? input : `#${input}`;
      setLocalHex(hex);
      if (HEX_REGEX.test(hex)) {
        onChange(hex);
      }
    },
    [onChange],
  );

  // Read from localHex, not value, so the badge updates while dragging rather
  // than only after the 100ms debounce commits.
  const contrast = contrastAgainst
    ? checkContrast(localHex, contrastAgainst, contrastLevel)
    : null;
  const suggestion =
    contrast && !contrast.passes && contrastAgainst
      ? suggestAccessible(localHex, contrastAgainst, contrastLevel)
      : null;

  const handleHexBlur = useCallback(() => {
    if (!HEX_REGEX.test(localHex)) {
      setLocalHex(value);
    }
  }, [localHex, value]);

  // When used with a label, render in a grid-cols-3 layout matching the reference
  if (label) {
    return (
      <div
        className={cn(
          "grid grid-cols-3 gap-4 items-center self-start",
          className,
        )}
      >
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <div className="col-span-2 flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild disabled={disabled}>
              <button
                type="button"
                className={cn(
                  "h-12 w-12 shrink-0 cursor-pointer rounded-full border-2 border-border shadow-sm hover:shadow-md transition-shadow",
                  disabled && "pointer-events-none opacity-50",
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
        {contrast && !contrast.passes && (
          <ContrastBadge
            className="col-start-2 col-span-2"
            contrast={contrast}
            suggestion={suggestion}
            onApply={(hex) => {
              setLocalHex(hex);
              onChange(hex);
            }}
          />
        )}
      </div>
    );
  }

  // Without label: compact inline version (used in branding grid layouts)
  return (
    <div className={cn("space-y-1.5 self-start", className)}>
      <div className="flex items-center gap-3">
        <Popover>
          <PopoverTrigger asChild disabled={disabled}>
            <button
              type="button"
              className={cn(
                "h-12 w-12 shrink-0 cursor-pointer rounded-full border-2 border-border shadow-sm hover:shadow-md transition-shadow",
                disabled && "pointer-events-none opacity-50",
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
      {contrast && !contrast.passes && (
        <ContrastBadge
          contrast={contrast}
          suggestion={suggestion}
          onApply={(hex) => {
            setLocalHex(hex);
            onChange(hex);
          }}
        />
      )}
    </div>
  );
}
