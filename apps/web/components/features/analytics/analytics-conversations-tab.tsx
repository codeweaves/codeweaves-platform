'use client';

import {
  useConversationCategories,
  useConversationLanguages,
  useConversationChannels,
  type AnalyticsParams,
  type AnalyticsQueryOptions,
} from '@/hooks/use-analytics';
import { CategoryBreakdownChart } from './category-breakdown-chart';
import { ConversationLanguagesChart } from './conversation-languages-chart';
import { ChannelSplitChart } from './channel-split-chart';
import { AgentAnalyticsTable } from './agent-analytics-table';

interface AnalyticsConversationsTabProps {
  params: AnalyticsParams;
  pollingOptions?: AnalyticsQueryOptions;
}

/**
 * "What are people talking about, in what language, on which channel — and
 * which agents handle it?" Surfaces the post-session classifier data
 * (category, detected language) alongside the channel split and per-agent
 * table. Queries live here so they only run while this tab is mounted.
 */
export function AnalyticsConversationsTab({ params, pollingOptions }: AnalyticsConversationsTabProps) {
  const categoriesQuery = useConversationCategories(params, pollingOptions);
  const languagesQuery = useConversationLanguages(params, pollingOptions);
  const channelsQuery = useConversationChannels(params, pollingOptions);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <CategoryBreakdownChart
          data={categoriesQuery.data}
          isLoading={categoriesQuery.isLoading}
          isError={categoriesQuery.isError}
        />
        <ConversationLanguagesChart
          data={languagesQuery.data}
          isLoading={languagesQuery.isLoading}
          isError={languagesQuery.isError}
        />
        <ChannelSplitChart
          data={channelsQuery.data}
          isLoading={channelsQuery.isLoading}
          isError={channelsQuery.isError}
        />
      </div>

      <AgentAnalyticsTable params={params} pollingOptions={pollingOptions} />
    </div>
  );
}
