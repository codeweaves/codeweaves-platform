'use client';

import { Label } from '@/components/ui/label';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

export interface FieldLabelProps {
  htmlFor?: string;
  /** The field name shown to the user. */
  label: string;
  /** One short line, if anything. Long detail belongs in `info`. */
  description?: React.ReactNode;
  /** The full explanation, behind the ⓘ. */
  info?: React.ReactNode;
  className?: string;
}

/**
 * Label + optional one-line hint + an ⓘ holding the long explanation.
 *
 * Replaces the `<Label>` followed by a paragraph of muted text that was
 * hand-rolled at ~30 sites in this editor. The rule of thumb it encodes: a
 * caption should be scannable at a glance, so anything that needs a second or
 * third line moves into `info` rather than pushing the actual input down the
 * page.
 */
export function FieldLabel({
  htmlFor,
  label,
  description,
  info,
  className,
}: FieldLabelProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <InfoTooltip content={info} label={label} />
      </div>
      {description && (
        <p className="text-sm leading-snug text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
