'use client';

import {
  Users,
  MessageSquare,
  MessagesSquare,
  Zap,
  Clock,
  UserCheck,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { KpiCard } from './kpi-card';
import { formatNumber, formatPercentage, formatDuration } from '@/lib/format-utils';
import type { AnalyticsSummaryResponse } from '@/hooks/use-analytics';

interface KpiSummaryCardsProps {
  data?: AnalyticsSummaryResponse;
  isLoading: boolean;
}

interface KpiCardDef {
  title: string;
  value: string;
  trend?: number;
  trendInverted?: boolean;
  icon: LucideIcon;
  /** Tooltip body — only the non-obvious cards have one. */
  info?: ReactNode;
  /** When true, the card is only shown if an agent has fallback phrases set. */
  requiresFallback?: boolean;
}

export function KpiSummaryCards({ data, isLoading }: KpiSummaryCardsProps) {
  const kpis = data?.kpis;

  // Obvious cards (Total Users / Conversations / Messages, Avg Response Time)
  // intentionally have no `info` — a tooltip there is just noise. Only the
  // non-obvious metrics carry one, structured as: plain definition → highlighted
  // "how it is worked out" → a short note. <strong> marks the bits worth scanning.
  const cards: KpiCardDef[] = [
    {
      title: 'Total Users',
      value: kpis ? formatNumber(kpis.totalUsers.value) : '-',
      trend: kpis?.totalUsers.trend,
      icon: Users,
    },
    {
      title: 'Total Conversations',
      value: kpis ? formatNumber(kpis.totalConversations.value) : '-',
      trend: kpis?.totalConversations.trend,
      icon: MessageSquare,
    },
    {
      title: 'Total Messages',
      value: kpis ? formatNumber(kpis.totalMessagesExchanged.value) : '-',
      trend: kpis?.totalMessagesExchanged.trend,
      icon: MessagesSquare,
    },
    {
      title: 'Time to First Token',
      value: kpis
        ? kpis.avgTimeToFirstTokenMs.value != null
          ? formatDuration(kpis.avgTimeToFirstTokenMs.value)
          : '—'
        : '-',
      trend: kpis?.avgTimeToFirstTokenMs.trend ?? undefined,
      trendInverted: true,
      icon: Zap,
      info: (
        <>
          <p>
            How quickly the bot <strong>starts replying</strong> — the moment the{' '}
            <strong>first words appear</strong> on screen.
          </p>
          <p>
            <strong>Lower feels faster</strong> to the visitor, even if the full
            answer takes a little longer.
          </p>
          <p>A few unusually slow replies are left out so one does not skew it.</p>
        </>
      ),
    },
    {
      title: 'Avg Response Time',
      value: kpis ? formatDuration(kpis.avgResponseTimeMs.value) : '-',
      trend: kpis?.avgResponseTimeMs.trend,
      trendInverted: true,
      icon: Clock,
    },
    {
      title: 'User Retention',
      value: kpis ? formatPercentage(kpis.userRetentionRate.value) : '-',
      trend: kpis?.userRetentionRate.trend,
      icon: UserCheck,
      info: (
        <>
          <p>
            Of the people who chatted in this range, how many had{' '}
            <strong>also chatted before</strong> it started — i.e. visitors{' '}
            <strong>coming back</strong>.
          </p>
          <p className="font-semibold">Formula</p>
          <p className="rounded bg-background/15 px-2 py-1 font-mono text-[11px] leading-snug">
            returning visitors ÷ all visitors × 100
          </p>
          <p>
            The % below is a <strong>relative change</strong> vs the period
            before — <strong>+10% = 10% higher than last time</strong>, not 10
            points higher.
          </p>
        </>
      ),
    },
    {
      title: 'Fallback Rate',
      value: kpis ? formatPercentage(kpis.couldntAnswerRate.value) : '-',
      trend: kpis?.couldntAnswerRate.trend,
      trendInverted: true,
      icon: CircleHelp,
      info: (
        <>
          <p>
            How often the bot <strong>fell back on one of your phrases</strong>{' '}
            instead of answering a question.
          </p>
          <p className="font-semibold">Formula</p>
          <p className="rounded bg-background/15 px-2 py-1 font-mono text-[11px] leading-snug">
            replies that used a phrase ÷ replies checked × 100
          </p>
          <p>
            Higher means it is getting <strong>stuck more often</strong>. The %
            below compares it to the period before.
          </p>
        </>
      ),
      // Only meaningful when at least one agent in view has fallback phrases set
      // up. Hidden otherwise so we never show a confusing empty/0% card.
      requiresFallback: true,
    },
  ];

  const visibleCards = cards.filter(
    (card) => !card.requiresFallback || data?.fallbackConfigured,
  );

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {visibleCards.map((card) => (
        <KpiCard
          key={card.title}
          title={card.title}
          value={card.value}
          trend={card.trend}
          trendInverted={card.trendInverted}
          icon={card.icon}
          info={card.info}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
