'use client';

import { useRef, useState, useEffect, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  title: string;
  value: string;
  trend?: number;
  trendInverted?: boolean;
  icon: LucideIcon;
  isLoading?: boolean;
  /**
   * Plain-language explanation shown in a hover/tap tooltip next to the title.
   * Accepts rich content (paragraphs, <strong> highlights). Omit for cards that
   * are self-explanatory — no icon is rendered then.
   */
  info?: ReactNode;
}

export function KpiCard({
  title,
  value,
  trend,
  trendInverted = false,
  icon: Icon,
  isLoading,
  info,
}: KpiCardProps) {
  // 8-9: Detect value changes for polling animation (hooks must be above early return)
  const prevValueRef = useRef(value);
  const hasMountedRef = useRef(false);
  const [isChanged, setIsChanged] = useState(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      // Skip animation on initial render — only animate polling updates
      hasMountedRef.current = true;
      prevValueRef.current = value;
      return;
    }
    if (prevValueRef.current !== value) {
      setIsChanged(true);
      const timer = setTimeout(() => setIsChanged(false), 1000);
      prevValueRef.current = value;
      return () => clearTimeout(timer);
    }
  }, [value]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="mt-1 h-3 w-16" />
        </CardContent>
      </Card>
    );
  }

  const isPositive = trend != null && trend > 0;
  const isNegative = trend != null && trend < 0;
  const isNeutral = trend == null || trend === 0;

  // For inverted metrics (e.g., response time), a decrease is good
  const isGood = trendInverted ? isNegative : isPositive;
  const isBad = trendInverted ? isPositive : isNegative;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {info && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`What is ${title}?`}
                    className="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-65">
                  <div className="space-y-1.5 leading-relaxed [&_strong]:font-semibold [&_strong]:text-background">
                    {info}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p aria-live="polite" className={cn('text-2xl font-bold transition-colors duration-700', isChanged && 'text-green-600')}>{value}</p>
        {trend != null && (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-xs',
              isGood && 'text-green-600',
              isBad && 'text-red-600',
              isNeutral && 'text-muted-foreground',
            )}
          >
            {isPositive && <TrendingUp className="h-3 w-3" />}
            {isNegative && <TrendingDown className="h-3 w-3" />}
            {isNeutral && <Minus className="h-3 w-3" />}
            <span>
              {isPositive && '+'}
              {trend.toFixed(1)}% vs prev period
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
