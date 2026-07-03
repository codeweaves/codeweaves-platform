'use client';

import { useCallback, useState } from 'react';
import { ConversationListPane } from './conversation-list-pane';
import { ConversationDetailPane } from './conversation-detail-pane';
import {
  ConversationsFiltersBar,
  EMPTY_FILTERS,
  type ConversationFilters,
} from './conversations-filters-bar';

interface ConversationsViewProps {
  selectedSessionId: string | null;
}

function isFiltersActive(f: ConversationFilters): boolean {
  return !!(
    f.search ||
    f.agentIds.length ||
    f.orgIds.length ||
    f.sources.length ||
    f.dateFrom ||
    f.dateTo
  );
}

/**
 * Conversations page layout:
 *   - filter bar across the top (same components as Analytics)
 *   - two-pane "split inbox" below: list on the left, transcript on the right
 *
 * Both panes are always visible (fixed-width desktop dashboard — it scrolls
 * sideways on narrow viewports like every other screen, rather than collapsing
 * to a single mobile pane). Pick a row to load its transcript on the right.
 */
export function ConversationsView({ selectedSessionId }: ConversationsViewProps) {
  const [filters, setFilters] = useState<ConversationFilters>(EMPTY_FILTERS);
  const hasActiveFilters = isFiltersActive(filters);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  return (
    // Fixed height = viewport − header (h-16 = 4rem) − shell padding (py-7 =
    // 3.5rem) = 7.5rem, so the list + transcript each scroll INTERNALLY and the
    // page fits the screen. Both panes always show — fixed-width desktop
    // dashboard, not a mobile app.
    <div className="flex h-[calc(100svh-7.5rem)] flex-col gap-4">
      <ConversationsFiltersBar filters={filters} onChange={setFilters} />

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <div className="flex h-full">
          <ConversationListPane
            selectedSessionId={selectedSessionId}
            filters={filters}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            className="w-100 shrink-0 border-r lg:w-110"
          />
          <ConversationDetailPane
            sessionId={selectedSessionId}
            className="min-w-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}
