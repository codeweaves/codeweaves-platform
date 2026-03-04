'use client';

import {
  Users,
  MessageSquare,
  MessagesSquare,
  Clock,
  UserCheck,
  TrendingUp,
} from 'lucide-react';
import { KpiCard } from './kpi-card';
import { formatNumber, formatPercentage, formatDuration } from '@/lib/format-utils';
import type { AnalyticsSummaryResponse } from '@/hooks/use-analytics';

interface KpiSummaryCardsProps {
  data?: AnalyticsSummaryResponse;
  isLoading: boolean;
}

export function KpiSummaryCards({ data, isLoading }: KpiSummaryCardsProps) {
  const kpis = data?.kpis;

  const cards = [
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
    },
    {
      title: 'User Growth',
      value: kpis ? formatPercentage(kpis.userGrowthRate.value) : '-',
      trend: kpis?.userGrowthRate.trend,
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <KpiCard
          key={card.title}
          title={card.title}
          value={card.value}
          trend={card.trend}
          trendInverted={card.trendInverted}
          icon={card.icon}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
