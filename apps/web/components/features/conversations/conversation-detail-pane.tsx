'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useConversation } from '@/hooks/use-conversations';
import { ConversationTranscript } from './conversation-transcript';
import { cn } from '@/lib/utils';
import { visitorLabel } from '@/lib/visitor-label';

interface ConversationDetailPaneProps {
  sessionId: string | null;
  className?: string;
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec === 0 ? `${min}m` : `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${hr}h` : `${hr}h ${remMin}m`;
}

function formatFull(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <MessageSquare className="size-10 text-muted-foreground/30" />
      <div className="text-base font-medium">Select a conversation</div>
      <div className="max-w-sm text-sm text-muted-foreground">
        Pick a conversation from the list to read the full transcript.
      </div>
    </div>
  );
}

function HeaderStat({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

export function ConversationDetailPane({
  sessionId,
  className,
}: ConversationDetailPaneProps) {
  const { data: conv, isLoading, isError, error } = useConversation(
    sessionId ?? undefined,
  );
  const [summaryOpen, setSummaryOpen] = useState(false);

  if (!sessionId) {
    return (
      <div className={cn('flex h-full flex-col bg-card', className)}>
        <EmptyState />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-card', className)}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !conv) {
    const isNotFound = error?.message?.toLowerCase().includes('not found');
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 bg-card p-12 text-center', className)}>
        <AlertCircle className="size-8 text-muted-foreground/60" />
        <div className="text-base font-medium">
          {isNotFound ? 'Conversation not found' : 'Failed to load conversation'}
        </div>
        <div className="text-sm text-muted-foreground">
          {isNotFound
            ? 'It may have been deleted or belong to a different organization.'
            : 'Please try again in a moment.'}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/conversations">
            <ArrowLeft className="mr-1 size-4" />
            Back to conversations
          </Link>
        </Button>
      </div>
    );
  }

  const duration = formatDuration(conv.createdAt, conv.lastMessageAt);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      {/* Compact header */}
      <div className="shrink-0 border-b bg-card px-4 py-3 md:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {conv.category && (
                <Badge variant="secondary" className="text-[10px]">
                  {conv.category}
                </Badge>
              )}
              <Badge
                variant={
                  conv.source === 'WHATSAPP'
                    ? 'success'
                    : conv.source === 'DEMO'
                      ? 'secondary'
                      : 'default'
                }
                className="text-[10px]"
              >
                {conv.source.charAt(0) + conv.source.slice(1).toLowerCase()}
              </Badge>
              {conv.detectedLanguage && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  {conv.detectedLanguage}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <HeaderStat icon={Bot}>
                <Link
                  href={`/dashboard/agents/${conv.agent.id}`}
                  className="hover:underline"
                >
                  {conv.agent.name}
                </Link>
              </HeaderStat>
              {/* A hashed IP is hidden as noise; a WhatsApp phone number is
                  shown — it's the identifier support and the DPDP erasure
                  endpoints actually key on. See visitorLabel. */}
              <HeaderStat icon={User}>
                {visitorLabel(conv.source, conv.visitorId)}
              </HeaderStat>
              <HeaderStat icon={Clock}>{duration}</HeaderStat>
              <HeaderStat icon={Clock}>Started {formatFull(conv.createdAt)}</HeaderStat>
            </div>
          </div>
        </div>

        {conv.summary && (
          <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen} className="mt-3">
            <CollapsibleTrigger className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground">
              {summaryOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span>Summary</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {conv.summary}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Transcript */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <ConversationTranscript conversation={conv} />
      </div>
    </div>
  );
}
