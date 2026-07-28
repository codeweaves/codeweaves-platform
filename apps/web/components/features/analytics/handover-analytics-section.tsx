'use client';

import { Headset } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useHandoverAnalytics,
  type AnalyticsParams,
  type AnalyticsQueryOptions,
} from '@/hooks/use-analytics';
import { BreakdownBars, type BreakdownItem } from './breakdown-bars';
import { formatNumber, formatDuration } from '@/lib/format-utils';

const REASON_LABELS: Record<string, string> = {
  USER_REQUESTED: 'Asked for a human',
  BOT_FALLBACK: "Bot couldn't answer",
  FRUSTRATION: 'Frustration detected',
  MANUAL: 'Manually flagged',
};

interface HandoverAnalyticsSectionProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * Human-handover analytics tab. Reads the append-only handover_events log via
 * /analytics/handover, so every handover cycle counts (not just a chat's last
 * one). Empty state when no handovers were raised in the period.
 */
export function HandoverAnalyticsSection({ params, pollingOptions }: HandoverAnalyticsSectionProps) {
  const { data, isLoading } = useHandoverAnalytics(params, pollingOptions);

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data || data.totalHandovers === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Headset className="mb-4 size-12 text-muted-foreground/40" />
          <h3 className="text-lg font-medium">No handovers in this period</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            When a conversation is escalated to a human, its metrics show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const fmtMs = (ms: number | null) => (ms == null ? '—' : formatDuration(ms));
  const pct = (n: number) =>
    data.totalHandovers > 0 ? Math.round((n / data.totalHandovers) * 1000) / 10 : 0;

  const reasonItems: BreakdownItem[] = data.reasons.map((r) => ({
    label: REASON_LABELS[r.reason] ?? r.reason,
    count: r.count,
    percentage: r.percentage,
  }));

  const outcomeItems: BreakdownItem[] = [
    { label: 'Resolved by a human', count: data.resolvedByHuman, percentage: pct(data.resolvedByHuman) },
    { label: 'Left open, auto-resolved', count: data.sweptAfterTakeover, percentage: pct(data.sweptAfterTakeover) },
    { label: 'Abandoned (never picked up)', count: data.abandoned, percentage: pct(data.abandoned) },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Kpi
          label="Handover rate"
          value={`${data.handoverRate}%`}
          hint={`of ${formatNumber(data.totalConversations)} conversations`}
        />
        <Kpi label="Total handovers" value={formatNumber(data.totalHandovers)} />
        <Kpi
          label="Taken over by a human"
          value={formatNumber(data.takenOver)}
          hint={`${data.takenOverRate}% of requests`}
        />
        <Kpi
          label="Avg wait for a human"
          value={fmtMs(data.avgWaitMs)}
          hint="request → takeover"
        />
        <Kpi label="Resolved by a human" value={formatNumber(data.resolvedByHuman)} />
        <Kpi
          label="Avg handling time"
          value={fmtMs(data.avgHandleMs)}
          hint="takeover → resolve"
        />
        <Kpi
          label="Abandoned"
          value={formatNumber(data.abandoned)}
          hint="requested, never picked up"
        />
        <Kpi
          label="Left open"
          value={formatNumber(data.sweptAfterTakeover)}
          hint="taken over, then auto-resolved"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-semibold tracking-tight">Why handovers were raised</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              What triggered the escalation to a human
            </p>
            <div className="mt-6">
              <BreakdownBars items={reasonItems} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-base font-semibold tracking-tight">How handovers ended</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Resolved by a teammate vs auto-resolved by the idle sweep
            </p>
            <div className="mt-6">
              {outcomeItems.length > 0 ? (
                <BreakdownBars items={outcomeItems} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No handovers have closed yet in this period.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
