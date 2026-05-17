'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConversationListPane } from './conversation-list-pane';
import { ConversationDetailPane } from './conversation-detail-pane';
import {
  ConversationsFiltersBar,
  EMPTY_FILTERS,
  type ConversationFilters,
} from './conversations-filters-bar';
import { cn } from '@/lib/utils';

interface ConversationsViewProps {
  selectedSessionId: string | null;
}

function isFiltersActive(f: ConversationFilters): boolean {
  return !!(
    f.search ||
    f.agentIds.length ||
    f.orgIds.length ||
    f.sources.length ||
    f.statuses.length ||
    f.dateFrom ||
    f.dateTo
  );
}

/**
 * Conversations page layout:
 *   - filter bar across the top (same components as Analytics)
 *   - two-pane "split inbox" below: list on the left, transcript on the right
 *
 * On screens narrower than `md`, only one pane is visible at a time:
 *   - no selection → list pane fills the viewport
 *   - selection    → detail pane covers the list; a Back button restores it
 */
export function ConversationsView({ selectedSessionId }: ConversationsViewProps) {
  const router = useRouter();
  const [filters, setFilters] = useState<ConversationFilters>(EMPTY_FILTERS);
  const hasActiveFilters = isFiltersActive(filters);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const handleBack = useCallback(
    () => router.push('/dashboard/conversations'),
    [router],
  );

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-4">
      <ConversationsFiltersBar filters={filters} onChange={setFilters} />

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <div className="flex h-full">
          <ConversationListPane
            selectedSessionId={selectedSessionId}
            filters={filters}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            className={cn(
              'w-full border-r md:w-100 md:shrink-0 lg:w-110',
              selectedSessionId && 'hidden md:flex',
            )}
          />
          <ConversationDetailPane
            sessionId={selectedSessionId}
            onBack={handleBack}
            className={cn(
              'min-w-0 flex-1',
              !selectedSessionId && 'hidden md:flex',
            )}
          />
        </div>
      </div>
    </div>
  );
}
