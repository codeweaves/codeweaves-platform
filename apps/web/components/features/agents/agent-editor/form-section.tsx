'use client';

import { cn } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui/info-tooltip';

export interface FormSectionProps {
  title: string;
  /**
   * One short line introducing the section. ReactNode rather than string so a
   * description can carry `<strong>`/`<code>`; anything longer than a line
   * belongs in `info`.
   */
  description?: React.ReactNode;
  /** The full explanation, behind an ⓘ next to the title. */
  info?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function FormSection({
  title,
  description,
  info,
  className,
  children,
}: FormSectionProps) {
  return (
    <div className={cn(className)}>
      <div className="mb-6">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <InfoTooltip content={info} label={title} />
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}
