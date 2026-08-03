'use client';

import { Headset, ArrowLeftRight, UserCheck, Clock, Timer, CircleCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiCard } from './kpi-card';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { BreakdownBars, type BreakdownItem } from './breakdown-bars';
import {
  useHandoverAnalytics,
  type AnalyticsParams,
  type AnalyticsQueryOptions,
} from '@/hooks/use-analytics';
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

/**
 * Human-handover analytics tab. Reads the append-only handover_events log via
 * /analytics/handover, so every handover cycle counts (not just a chat's last
 * one). KPI tiles carry the distinct headline numbers; the two breakdowns own
 * the "why raised" and "how ended" distributions (no number is shown twice).
 */
export function HandoverAnalyticsSection({ params, pollingOptions }: HandoverAnalyticsSectionProps) {
  const { data, isLoading, isError } = useHandoverAnalytics(params, pollingOptions);

  // Distinct from the empty state: a failed request must not read as "zero
  // activity" (it's unavailable, not empty).
  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Headset className="mb-4 size-12 text-muted-foreground/40" />
          <h3 className="text-lg font-medium">Couldn&apos;t load handover analytics</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Something went wrong fetching this data. Try refreshing the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isLoading && (!data || data.totalHandovers === 0)) {
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

  const fmtMs = (ms: number | null | undefined) =>
    ms == null ? '-' : formatDuration(ms);
  const pct = (n: number) =>
    data && data.totalHandovers > 0 ? Math.round((n / data.totalHandovers) * 1000) / 10 : 0;

  const reasonItems: BreakdownItem[] = (data?.reasons ?? []).map((r) => ({
    label: REASON_LABELS[r.reason] ?? r.reason,
    count: r.count,
    percentage: r.percentage,
  }));

  const outcomeItems: BreakdownItem[] = data
    ? [
        { label: 'Resolved by a human', count: data.resolvedByHuman, percentage: pct(data.resolvedByHuman) },
        { label: 'Left open (auto-resolved)', count: data.sweptAfterTakeover, percentage: pct(data.sweptAfterTakeover) },
        { label: 'Abandoned (never picked up)', count: data.abandoned, percentage: pct(data.abandoned) },
      ].filter((i) => i.count > 0)
    : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          isLoading={isLoading}
          icon={ArrowLeftRight}
          title="Handover rate"
          trend={data?.handoverRateTrend}
          trendInverted
          value={`${data?.handoverRate ?? 0}%`}
          info={
            <>
              Share of conversations that were escalated to a human. Calculated as{' '}
              <strong>handovers ÷ conversations</strong> ({formatNumber(data?.totalHandovers ?? 0)}{' '}
              ÷ {formatNumber(data?.totalConversations ?? 0)}) for this period.
            </>
          }
        />
        <KpiCard
          isLoading={isLoading}
          icon={Headset}
          title="Total handovers"
          trend={data?.totalHandoversTrend}
          value={formatNumber(data?.totalHandovers ?? 0)}
          info={
            <>
              Number of times a conversation was escalated to a human this period. Each
              request counts separately, so a chat escalated more than once is counted
              more than once.
            </>
          }
        />
        <KpiCard
          isLoading={isLoading}
          icon={UserCheck}
          title="Picked up by a human"
          trend={data?.takenOverTrend}
          value={formatNumber(data?.takenOver ?? 0)}
          info={
            <>
              Handovers a teammate actually took over: <strong>{data?.takenOverRate ?? 0}%</strong>{' '}
              of requests. The rest were auto-resolved by the idle sweep before anyone joined.
            </>
          }
        />
        <KpiCard
          isLoading={isLoading}
          icon={Clock}
          title="Avg wait for a human"
          trend={data?.avgWaitTrend ?? undefined}
          trendInverted
          value={fmtMs(data?.avgWaitMs)}
          info={
            <>
              Average time from a handover request until a teammate takes over. Counts only
              handovers that were picked up.
            </>
          }
        />
        <KpiCard
          isLoading={isLoading}
          icon={Timer}
          title="Avg handling time"
          trend={data?.avgHandleTrend ?? undefined}
          trendInverted
          value={fmtMs(data?.avgHandleMs)}
          info={
            <>
              Average time a teammate spends on a chat, from taking over to resolving. Counts
              only handovers a human resolved.
            </>
          }
        />
        <KpiCard
          isLoading={isLoading}
          icon={CircleCheck}
          title="Resolved by a human"
          trend={data?.resolvedByHumanTrend}
          value={formatNumber(data?.resolvedByHuman ?? 0)}
          info={
            <>
              Handovers a teammate explicitly closed by clicking Resolve,{' '}
              <strong>{pct(data?.resolvedByHuman ?? 0)}%</strong> of all handovers this period.
              The full split (incl. abandoned / left-open) is in &ldquo;How handovers ended&rdquo; below.
            </>
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold tracking-tight">Why handovers were raised</h3>
              <InfoTooltip
                label="handover reasons"
                content={
                  <>
                    What triggered each escalation: the visitor asked for a human, the bot
                    couldn&apos;t answer, frustration was detected, or a teammate flagged it.
                  </>
                }
              />
            </div>
            <div className="mt-6">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-md" />
                  ))}
                </div>
              ) : (
                <BreakdownBars items={reasonItems} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold tracking-tight">How handovers ended</h3>
              <InfoTooltip
                label="handover outcomes"
                content={
                  <>
                    <strong>Resolved by a human</strong>: a teammate clicked Resolve.{' '}
                    <strong>Left open</strong>: a teammate took over but the chat went idle and
                    was auto-resolved. <strong>Abandoned</strong>: nobody picked it up before it
                    timed out.
                  </>
                }
              />
            </div>
            <div className="mt-6">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-md" />
                  ))}
                </div>
              ) : outcomeItems.length > 0 ? (
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
