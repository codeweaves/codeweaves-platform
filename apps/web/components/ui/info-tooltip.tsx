'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface InfoTooltipProps {
  /** The explanation. ReactNode so callers can pass <strong>, <code>, links. */
  content: React.ReactNode;
  /**
   * What the icon is explaining, e.g. "PII protection". Becomes the accessible
   * name ("More about PII protection") — without it a screen-reader user hears
   * an unlabelled button.
   */
  label?: string;
  side?: React.ComponentProps<typeof TooltipContent>['side'];
  className?: string;
}

/**
 * The small ⓘ next to a label that holds detail too long to sit inline.
 *
 * Extracted from the pattern the analytics KPI cards already use, so the whole
 * dashboard explains itself the same way. Renders nothing when `content` is
 * empty, which lets callers pass an optional prop straight through without
 * guarding at every site.
 *
 * Note: Radix needs a TooltipProvider ancestor or Tooltip.Root throws, and this
 * app has no global one — so the provider is included here rather than left as a
 * trap for each caller.
 */
export function InfoTooltip({ content, label, side, className }: InfoTooltipProps) {
  if (content === null || content === undefined || content === false || content === '') {
    return null;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Inside <form> elements a bare button would submit — hence type.
            aria-label={label ? `More about ${label}` : 'More information'}
            className={cn(
              'inline-flex shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/50 outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-72">
          {/* [&_strong] / [&_code] so callers can emphasise inside the dark
              tooltip surface without restyling at each site. */}
          <div className="space-y-1.5 text-xs leading-relaxed [&_code]:rounded [&_code]:bg-background/15 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_strong]:font-semibold">
            {content}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
