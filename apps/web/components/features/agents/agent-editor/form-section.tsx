'use client';

import { cn } from '@/lib/utils';

export interface FormSectionProps {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormSection({
  title,
  description,
  className,
  children,
}: FormSectionProps) {
  return (
    <div className={cn(className)}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}
