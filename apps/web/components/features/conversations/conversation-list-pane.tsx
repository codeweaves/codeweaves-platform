'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useConversations,
  type ConversationListItem,
  type ConversationSource,
} from '@/hooks/use-conversations';
import type { ConversationFilters } from './conversations-filters-bar';
import { cn } from '@/lib/utils';

interface ConversationListPaneProps {
  selectedSessionId: string | null;
  filters: ConversationFilters;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  className?: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const SOURCE_LABEL: Record<ConversationSource, string> = {
  WIDGET: 'Widget',
  WHATSAPP: 'WhatsApp',
  DEMO: 'Demo',
};

const SOURCE_VARIANT: Record<
  ConversationSource,
  'default' | 'secondary' | 'outline' | 'success' | 'error'
> = {
  WIDGET: 'default',
  WHATSAPP: 'success',
  DEMO: 'secondary',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)}h`;
  if (diffSec < 86_400 * 7) return `${Math.round(diffSec / 86_400)}d`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// DateRangePicker emits YYYY-MM-DD; the API takes ISO datetimes. Anchor
// "from" to the first instant of that local day and "to" to the last so a
// user picking May 1 – May 17 sees everything that happened in those days.
function toIsoStartOfDay(d: string): string {
  return new Date(`${d}T00:00:00`).toISOString();
}
function toIsoEndOfDay(d: string): string {
  return new Date(`${d}T23:59:59.999`).toISOString();
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: ConversationListItem;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const visitor = conversation.visitorId ?? 'Anonymous';
  const initial = (conversation.agent.name[0] ?? '?').toUpperCase();

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.sessionId)}
      className={cn(
        'group flex w-full cursor-pointer items-start gap-3 border-b border-l-4 border-l-transparent px-4 py-3 text-left transition-colors',
        'hover:bg-accent focus:bg-accent focus:outline-none',
        selected && 'border-l-primary bg-primary/10',
      )}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {conversation.agent.name}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatRelative(conversation.lastActivityAt)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {conversation.category && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {conversation.category}
            </Badge>
          )}
          <Badge
            variant={SOURCE_VARIANT[conversation.source]}
            className="text-[10px] px-1.5 py-0"
          >
            {SOURCE_LABEL[conversation.source]}
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">
            {visitor} · {conversation.messageCount} msg
            {conversation.messageCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </button>
  );
}

export function ConversationListPane({
  selectedSessionId,
  filters,
  hasActiveFilters,
  onClearFilters,
  className,
}: ConversationListPaneProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A filter or page-size change should bounce the user back to page 1 —
  // otherwise they can land on a now-empty page 4 after narrowing the set.
  useEffect(() => {
    setPage(1);
  }, [
    filters.search,
    filters.agentIds,
    filters.orgIds,
    filters.sources,
    filters.categories,
    filters.dateFrom,
    filters.dateTo,
    pageSize,
  ]);

  const queryParams = useMemo(
    () => ({
      page,
      limit: pageSize,
      search: filters.search || undefined,
      agentIds: filters.agentIds.length > 0 ? filters.agentIds : undefined,
      orgId: filters.orgIds[0], // backend supports single orgId; multi via admin-only relation filter
      sources: filters.sources.length > 0 ? filters.sources : undefined,
      categories: filters.categories.length > 0 ? filters.categories : undefined,
      from: filters.dateFrom ? toIsoStartOfDay(filters.dateFrom) : undefined,
      to: filters.dateTo ? toIsoEndOfDay(filters.dateTo) : undefined,
      sortBy: 'lastMessageAt' as const,
      sortOrder: 'desc' as const,
    }),
    [page, pageSize, filters],
  );

  const { data, isLoading, isFetching, isError, refetch } = useConversations(queryParams);

  const conversations = useMemo(() => data?.data ?? [], [data]);
  const total = data?.meta.total ?? 0;
  const totalPages = data?.meta.totalPages ?? 0;

  const handleSelect = useCallback(
    (sessionId: string) => {
      // `replace` (not `push`) — selecting a row shouldn't pollute browser
      // history with one entry per click. `scroll: false` prevents the page
      // jumping to top when the URL updates. The component stays mounted
      // because we're on the same route, so filter state and scroll position
      // both survive.
      router.replace(
        `/dashboard/conversations?session=${encodeURIComponent(sessionId)}`,
        { scroll: false },
      );
    },
    [router],
  );

  // Display range like "1–20 of 137"
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <span className="text-sm text-muted-foreground">
              Failed to load conversations
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('mr-1 size-3', isFetching && 'animate-spin')}
              />
              Try again
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageSquare className="size-8 text-muted-foreground/40" />
            <span className="text-sm font-medium">
              {hasActiveFilters ? 'No matches' : 'No conversations yet'}
            </span>
            <span className="text-xs text-muted-foreground">
              {hasActiveFilters
                ? 'Try clearing some filters.'
                : 'Conversations from your agents will appear here.'}
            </span>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {isFetching && (
              <div className="sticky top-0 z-10 flex items-center justify-center bg-background/60 py-1 text-[11px] text-muted-foreground backdrop-blur">
                <Loader2 className="mr-1 size-3 animate-spin" /> Updating…
              </div>
            )}
            {conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                selected={c.sessionId === selectedSessionId}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}
      </div>

      {/* Pagination footer */}
      <div className="shrink-0 border-t bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="text-muted-foreground tabular-nums">
            {total === 0 ? '0 of 0' : `${rangeStart}–${rangeEnd} of ${total}`}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPage((p) => Math.min(totalPages || 1, p + 1))}
              disabled={page >= totalPages || isFetching}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
