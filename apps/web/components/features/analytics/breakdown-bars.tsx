'use client';

import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format-utils';

export interface BreakdownItem {
  /** Display label for the row. */
  label: string;
  count: number;
  percentage: number;
}

interface BreakdownBarsProps {
  items: BreakdownItem[];
  /** Cap the number of rows; remainder is folded into an "Other" row. */
  maxRows?: number;
  className?: string;
}

/**
 * Ranked horizontal-bar list. Replaces pie charts for distribution data —
 * humans read bar length far faster than pie angles, and labels never overlap.
 * Bars are scaled to the largest value (not the total) so the leader always
 * fills the track and smaller categories stay visually distinguishable.
 */
export function BreakdownBars({ items, maxRows = 8, className }: BreakdownBarsProps) {
  const sorted = [...items].sort((a, b) => b.count - a.count);

  let rows = sorted;
  if (sorted.length > maxRows) {
    const head = sorted.slice(0, maxRows - 1);
    const tail = sorted.slice(maxRows - 1);
    const other = tail.reduce(
      (acc, r) => ({
        label: 'Other',
        count: acc.count + r.count,
        percentage: acc.percentage + r.percentage,
      }),
      { label: 'Other', count: 0, percentage: 0 },
    );
    rows = [...head, other];
  }

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className={cn('space-y-3', className)}>
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium" title={row.label}>
              {row.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(row.count)}
              <span className="ml-1.5 text-xs">({row.percentage.toFixed(1)}%)</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
