'use client';

import {
  useAnalyticsSummary,
  useConversationsChart,
  useResponseTimesChart,
  useMessageVolumeChart,
  type AnalyticsParams,
  type AnalyticsQueryOptions,
} from '@/hooks/use-analytics';
import { KpiSummaryCards } from './kpi-summary-cards';
import { ConversationsChart } from './conversations-chart';
import { ResponseTimesChart } from './response-times-chart';
import { MessageVolumeHeatmap } from './message-volume-heatmap';

interface AnalyticsOverviewTabProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
}

/**
 * "How are we doing?" — headline KPIs plus the two core trend charts and the
 * activity heatmap. Queries live here (not the page) so they only run while the
 * Overview tab is mounted. The summary query shares its key with the page-level
 * empty-state check, so React Query dedupes it to a single request.
 */
export function AnalyticsOverviewTab({ params, pollingOptions }: AnalyticsOverviewTabProps) {
  const summaryQuery = useAnalyticsSummary(params, pollingOptions);
  const conversationsQuery = useConversationsChart(params, pollingOptions);
  const responseTimesQuery = useResponseTimesChart(params, pollingOptions);
  const messageVolumeQuery = useMessageVolumeChart(params, pollingOptions);

  return (
    <div className="space-y-6">
      <KpiSummaryCards data={summaryQuery.data} isLoading={summaryQuery.isLoading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ConversationsChart
          data={conversationsQuery.data}
          isLoading={conversationsQuery.isLoading}
          isError={conversationsQuery.isError}
        />
        <ResponseTimesChart
          data={responseTimesQuery.data}
          isLoading={responseTimesQuery.isLoading}
          isError={responseTimesQuery.isError}
        />
      </div>

      <MessageVolumeHeatmap
        data={messageVolumeQuery.data}
        isLoading={messageVolumeQuery.isLoading}
        isError={messageVolumeQuery.isError}
      />
    </div>
  );
}
