'use client';

import { Switch } from '@/components/ui/switch';
import { FieldLabel } from './field-label';
import { cn } from '@/lib/utils';

export interface ToggleRowProps {
  id: string;
  label: string;
  /** One short line. Long detail goes in `info`. */
  description?: React.ReactNode;
  /** The full explanation, behind the ⓘ next to the label. */
  info?: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A labelled switch with its caption on the left and the control on the right.
 *
 * This layout was hand-rolled in most of the editor's sections; it lived as a
 * local helper in human-handover-settings only. Promoted here so the ⓘ affordance
 * is available to every toggle rather than re-implemented per file.
 */
export function ToggleRow({
  id,
  label,
  description,
  info,
  checked,
  onChange,
  disabled,
  className,
}: ToggleRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <FieldLabel htmlFor={id} label={label} description={description} info={info} />
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
