'use client';

import { Loader2, Flag, Headset, Bot, Inbox as InboxIcon, AlertCircle } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import { visitorLabel } from '@/lib/visitor-label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  useInbox,
  type HandoverFilter,
  type InboxItem,
} from '@/hooks/use-handover';

// Only the two actionable views are surfaced. The 'all' filter still exists on
// the type and the API (see the count query below), it just has no tab.
const TABS: { key: HandoverFilter; label: string }[] = [
  { key: 'needs', label: 'Needs you' },
  { key: 'handling', label: 'Handling' },
];

function StatusChip({ item }: { item: InboxItem }) {
  if (item.handoverState === 'REQUESTED') {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 px-1.5 py-0 text-[10px] text-destructive">
        <Flag className="size-3" /> Wants human
      </Badge>
    );
  }
  if (item.handoverState === 'ACTIVE_HUMAN') {
    const who = item.takenOverBy?.name ? `${item.takenOverBy.name} handling` : 'Being handled';
    return (
      <Badge variant="outline" className="gap-1 border-primary/40 px-1.5 py-0 text-[10px] text-primary">
        <Headset className="size-3" /> {who}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
      <Bot className="size-3" /> Bot
    </Badge>
  );
}

interface InboxListPaneProps {
  filter: HandoverFilter;
  onFilterChange: (f: HandoverFilter) => void;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  className?: string;
}

export function InboxListPane({
  filter,
  onFilterChange,
  selectedSessionId,
  onSelect,
  className,
}: InboxListPaneProps) {
  const { data, isLoading, isError, refetch, isFetching } = useInbox(filter);

  // Both badge counts come from the SINGLE 'all' query rather than one query
  // each: 'all' is REQUESTED + ACTIVE_HUMAN, which is exactly the union the two
  // badges partition, so they can be derived client-side. Two separate count
  // queries would have meant three concurrent inbox requests (each with its own
  // 30s poll when the socket is down); this caps it at two.
  //
  // This query deliberately outlives the removed 'All live' tab — it is the
  // counts source, not a view. Dropping it costs both badges.
  const allItems = useInbox('all').data;
  const needsCount =
    allItems?.filter((i) => i.handoverState === 'REQUESTED').length ?? 0;
  const handlingCount =
    allItems?.filter((i) => i.handoverState === 'ACTIVE_HUMAN').length ?? 0;

  const tabCount = (key: HandoverFilter) =>
    key === 'needs' ? needsCount : key === 'handling' ? handlingCount : 0;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Tabs */}
      <div className="flex border-b px-1.5">
        {TABS.map((tab) => {
          const active = filter === tab.key;
          const count = tabCount(tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onFilterChange(tab.key)}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 truncate border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    'text-[11px] font-bold tabular-nums',
                    // Red for "needs you" — someone is waiting. Handling is
                    // in-progress work, not an alarm, so it takes the calmer
                    // primary colour.
                    tab.key === 'needs' ? 'text-destructive' : 'text-primary',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <span className="text-sm text-muted-foreground">Failed to load the inbox</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Try again
            </Button>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <InboxIcon className="size-8 text-muted-foreground/40" />
            <span className="text-sm font-medium">All clear</span>
            <span className="text-xs text-muted-foreground">
              When a visitor asks for a human, they&apos;ll show up here.
            </span>
          </div>
        ) : (
          data.map((item) => {
            const selected = item.sessionId === selectedSessionId;
            const last = item.lastMessage;
            const preview = last
              ? `${last.role === 'HUMAN_AGENT' ? 'You: ' : last.role === 'SYSTEM' ? '• ' : ''}${last.content}`
              : 'No messages yet';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.sessionId)}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-3 border-b border-l-4 border-l-transparent px-4 py-3 text-left transition-colors',
                  'hover:bg-accent focus:bg-accent focus:outline-none',
                  selected && 'border-l-primary bg-primary/10',
                )}
              >
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Headset className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {/* A hashed IP is hidden; a WhatsApp phone number is shown.
                        See visitorLabel — the field means different things per
                        channel. */}
                    <span className="truncate text-sm font-medium">
                      {visitorLabel(item.source, item.visitorId)}
                    </span>
                    {item.lastMessageAt && (
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {formatDistanceToNowStrict(new Date(item.lastMessageAt), { addSuffix: false })}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusChip item={item} />
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {item.agent.name}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {item.messageCount} msg{item.messageCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
