'use client';

import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageVolumeResponse } from '@/hooks/use-analytics';
import { TimezoneToggle, type TzMode } from './timezone-toggle';

interface MessageVolumeHeatmapProps {
  data?: MessageVolumeResponse;
  isLoading: boolean;
  isError?: boolean;
  className?: string;
  /**
   * Controlled TZ mode for the analytics page. When provided, the heatmap
   * card header renders a Local/UTC toggle next to its title — this is
   * where the toggle's effect is most visible (day-of-week + hour buckets
   * follow the user's timezone).
   */
  tzMode?: TzMode;
  onTzModeChange?: (mode: TzMode) => void;
}

// API returns day: 0=Sun, 1=Mon, ..., 6=Sat
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const INTENSITY_COLORS = [
  'bg-blue-50 dark:bg-blue-950',
  'bg-blue-100 dark:bg-blue-900',
  'bg-blue-200 dark:bg-blue-800',
  'bg-blue-300 dark:bg-blue-700',
  'bg-blue-500 dark:bg-blue-500',
  'bg-blue-700 dark:bg-blue-300',
] as const;

function getColorIntensity(value: number, max: number): string {
  if (max === 0 || value === 0) return 'bg-muted';
  const intensity = Math.min(Math.round((value / max) * 5), 5);
  return INTENSITY_COLORS[intensity]!;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

interface HoverInfo {
  day: string;
  hour: number;
  count: number;
  x: number;
  y: number;
}

export function MessageVolumeHeatmap({
  data,
  isLoading,
  isError,
  className,
  tzMode,
  onTzModeChange,
}: MessageVolumeHeatmapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const tzControl = tzMode && onTzModeChange ? (
    <TimezoneToggle mode={tzMode} onChange={onTzModeChange} />
  ) : null;

  const handleCellEnter = useCallback(
    (e: React.MouseEvent, day: string, hour: number, count: number) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setHover({ day, hour, count, x: rect.left + rect.width / 2, y: rect.top });
    },
    [],
  );

  const handleCellLeave = useCallback(() => setHover(null), []);

  const volumeMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.data?.forEach(({ day, hour, count }) => map.set(`${day}-${hour}`, count));
    return map;
  }, [data]);

  const maxVolume = useMemo(
    () => Math.max(0, ...(data?.data?.map((d) => d.count) ?? [0])),
    [data],
  );

  if (isLoading) {
    return (
      <Card className={cn('lg:col-span-2', className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-medium">Message Volume by Hour</CardTitle>
          {tzControl}
        </CardHeader>
        <CardContent>
          <Skeleton className="h-56 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className={cn('lg:col-span-2', className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-medium">Message Volume by Hour</CardTitle>
          {tzControl}
        </CardHeader>
        <CardContent>
          <div className="flex h-56 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load chart data
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasData = data?.data && data.data.length > 0;

  return (
    <Card className={cn('lg:col-span-2', className)}>
      <CardHeader>
        <CardTitle className="text-base font-medium">Message Volume by Hour</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-56 items-center justify-center text-muted-foreground">
            No message data for this period
          </div>
        ) : (
          <>
            <div className="relative overflow-x-auto">
              {/* Hour labels row */}
              <div className="grid grid-cols-[48px_repeat(24,1fr)] gap-0.5 mb-0.5">
                <div /> {/* empty corner */}
                {HOURS.map((h) => (
                  <div key={h} className="text-center text-[10px] text-muted-foreground leading-tight">
                    {h % 6 === 0 ? formatHourLabel(h) : ''}
                  </div>
                ))}
              </div>

              {/* Day rows */}
              {DAYS.map((day, dayIdx) => (
                <div key={day} className="grid grid-cols-[48px_repeat(24,1fr)] gap-0.5 mb-0.5">
                  <div className="text-xs text-muted-foreground flex items-center pr-1">
                    {day}
                  </div>
                  {HOURS.map((hour) => {
                    const count = volumeMap.get(`${dayIdx}-${hour}`) ?? 0;
                    return (
                      <div
                        key={hour}
                        className={cn(
                          'h-6 min-w-3 rounded-sm cursor-default transition-colors',
                          getColorIntensity(count, maxVolume),
                        )}
                        onMouseEnter={(e) => handleCellEnter(e, day, hour, count)}
                        onMouseLeave={handleCellLeave}
                      />
                    );
                  })}
                </div>
              ))}

              {/* Single floating tooltip */}
              {hover && (
                <div
                  className="pointer-events-none fixed z-50 rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
                  style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, -100%) translateY(-8px)' }}
                >
                  {hover.day} {formatHourLabel(hover.hour)} {'\u2014'} {hover.count.toLocaleString()} messages
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="flex gap-0.5">
                {INTENSITY_COLORS.map((c) => (
                  <div key={c} className={cn('h-3 w-3 rounded-sm', c)} />
                ))}
              </div>
              <span>More</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
