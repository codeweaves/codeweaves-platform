'use client';

import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface TrendBadgeProps {
  /** Signed percentage change (e.g. 12.4 or -3.1). */
  value: number;
  /** When false, a *decrease* is the good outcome (e.g. response time). */
  positiveIsGood?: boolean;
}

function TrendBadge({ value, positiveIsGood = true }: TrendBadgeProps) {
  if (!Number.isFinite(value) || value === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        0%
      </span>
    );
  }

  const isUp = value > 0;
  const isGood = isUp === positiveIsGood;
  const Icon = isUp ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        isGood
          ? 'bg-success text-success-foreground'
          : 'bg-error text-error-foreground',
      )}
    >
      <Icon className="size-3" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: number;
  positiveIsGood?: boolean;
  hint?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  positiveIsGood = true,
  hint,
}: StatCardProps) {
  return (
    <Card className="group relative gap-0 overflow-hidden p-5 transition-colors hover:border-primary/30">
      {/* soft accent wash that warms up on hover */}
      <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-primary/5 blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-60" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground ring-1 ring-inset ring-border/50">
          <Icon className="size-[1.1rem]" />
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {trend !== undefined && (
          <TrendBadge value={trend} positiveIsGood={positiveIsGood} />
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-8 w-28" />
      <Skeleton className="mt-2.5 h-3 w-32" />
    </Card>
  );
}
