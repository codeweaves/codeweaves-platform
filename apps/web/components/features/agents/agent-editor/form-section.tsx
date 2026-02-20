'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface FormSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function FormSection({
  title,
  description,
  defaultOpen = true,
  className,
  children,
}: FormSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <div className="text-left">
          <h4 className="text-base font-semibold">{title}</h4>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
