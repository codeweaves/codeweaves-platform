'use client';

import { useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, CircleHelp, Headset, User, Wrench } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationTrace,
} from '@/hooks/use-conversations';

interface ConversationTranscriptProps {
  conversation: ConversationDetail;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function MessageMeta({ message }: { message: ConversationMessage }) {
  const meta = message.metadata as Record<string, unknown> | null | undefined;
  if (!meta) return null;
  const bits: string[] = [];
  if (typeof meta.responseLatencyMs === 'number') {
    bits.push(`${meta.responseLatencyMs} ms`);
  }
  if (typeof meta.timeToFirstToken === 'number') {
    bits.push(`TTFT ${meta.timeToFirstToken} ms`);
  }
  if (meta.inputType === 'voice') bits.push('Voice');
  if (typeof meta.detectedLanguage === 'string') {
    bits.push(meta.detectedLanguage);
  }
  if (bits.length === 0) return null;
  return (
    <div className="text-[10px] text-muted-foreground/80 tabular-nums">
      {bits.join(' · ')}
    </div>
  );
}

function TraceDetails({ trace }: { trace: ConversationTrace }) {
  // `steps` is JSON; render as a compact list when it's an array of objects
  // with named steps, otherwise fall back to a raw JSON pre.
  const steps = Array.isArray(trace.steps)
    ? (trace.steps as Array<Record<string, unknown>>)
    : null;

  return (
    <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {trace.model && (
          <span>
            <span className="text-muted-foreground/70">model</span>{' '}
            <span className="font-mono">{trace.model}</span>
          </span>
        )}
        {trace.totalDurationMs != null && (
          <span>
            <span className="text-muted-foreground/70">duration</span>{' '}
            <span className="tabular-nums">{trace.totalDurationMs} ms</span>
          </span>
        )}
        <span>
          <span className="text-muted-foreground/70">trace</span>{' '}
          <span className="font-mono">{trace.traceId}</span>
        </span>
        {!trace.success && (
          <Badge variant="error" className="text-[10px]">Failed</Badge>
        )}
      </div>

      {trace.errorMessage && (
        <div className="mt-2 rounded bg-destructive/10 px-2 py-1 text-destructive">
          {trace.errorMessage}
        </div>
      )}

      {steps && steps.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {steps.map((s, i) => {
            const name = (s.name as string) || (s.step as string) || `step ${i + 1}`;
            const durationMs =
              typeof s.durationMs === 'number'
                ? s.durationMs
                : typeof s.duration_ms === 'number'
                  ? (s.duration_ms as number)
                  : null;
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded border border-border/60 bg-background/60 px-2 py-1"
              >
                <span className="flex items-center gap-2">
                  <Wrench className="size-3 text-muted-foreground/70" />
                  <span className="font-mono">{name}</span>
                </span>
                {durationMs != null && (
                  <span className="tabular-nums text-muted-foreground">
                    {durationMs} ms
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-background/60 p-2 text-[11px] leading-snug">
          {JSON.stringify(trace.steps, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Pull a human teammate's display name out of a HUMAN_AGENT message's metadata. */
function humanAgentName(metadata: unknown): string | null {
  if (metadata && typeof metadata === 'object' && 'humanAgent' in metadata) {
    const ha = (metadata as Record<string, unknown>).humanAgent;
    if (ha && typeof ha === 'object' && 'name' in ha) {
      const name = (ha as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name;
    }
  }
  return null;
}

function MessageBubble({
  message,
  trace,
}: {
  message: ConversationMessage;
  trace: ConversationTrace | undefined;
}) {
  const [open, setOpen] = useState(false);

  // System lines (escalation / takeover / resolve) — a centered marker, not a
  // left/right bubble.
  if (message.role === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <span className="rounded-full border bg-muted/60 px-3 py-0.5 text-center text-[11px] text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  const isVisitor = message.role === 'USER';
  const isHuman = message.role === 'HUMAN_AGENT';
  const isAssistant = message.role === 'ASSISTANT';
  // Bot AND human teammate sit on the left (the "our side" of the chat); only
  // the visitor sits on the right.
  const onLeft = !isVisitor;
  const agentName = isHuman ? humanAgentName(message.metadata) : null;

  return (
    <div className={cn('flex w-full gap-3', onLeft ? 'justify-start' : 'justify-end')}>
      {onLeft && (
        <div
          className={cn(
            'mt-1 flex size-7 shrink-0 items-center justify-center rounded-full',
            isHuman ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {isHuman ? <Headset className="size-4" /> : <Bot className="size-4" />}
        </div>
      )}
      <div className="order-1 min-w-0 max-w-[80%]">
        {isHuman && (
          <div className="mb-0.5 pl-1 text-[11px] font-medium text-primary">
            {agentName ?? 'Team'}
          </div>
        )}
        <div
          className={cn(
            'rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words',
            isVisitor
              ? 'rounded-tr-sm bg-primary text-primary-foreground'
              : isHuman
                ? 'rounded-tl-sm bg-primary/10 text-foreground'
                : 'rounded-tl-sm bg-muted text-foreground',
          )}
        >
          {message.content}
        </div>
        <div
          className={cn(
            'mt-1 flex items-center gap-2 text-[11px] text-muted-foreground',
            onLeft ? 'justify-start' : 'justify-end',
          )}
        >
          <span>{formatTime(message.createdAt)}</span>
          {isAssistant && message.couldntAnswer === true && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
            >
              <CircleHelp className="size-3" />
              Fallback
            </Badge>
          )}
          <MessageMeta message={message} />
        </div>

        {isAssistant && trace && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
              className={cn(
                'mt-1 inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground transition-colors',
              )}
            >
              {open ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span>Trace</span>
              {trace.totalDurationMs != null && (
                <span className="tabular-nums">· {trace.totalDurationMs} ms</span>
              )}
              {!trace.success && (
                <span className="text-destructive">· failed</span>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <TraceDetails trace={trace} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      {isVisitor && (
        <div className="order-2 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}

export function ConversationTranscript({ conversation }: ConversationTranscriptProps) {
  const traceByMessage = useMemo(() => {
    const m = new Map<string, ConversationTrace>();
    for (const t of conversation.traces) {
      if (t.messageId) m.set(t.messageId, t);
    }
    return m;
  }, [conversation.traces]);

  // Group messages by local-day so the transcript shows a date heading per day.
  const groups = useMemo(() => {
    const out: Array<{ dateKey: string; label: string; items: ConversationMessage[] }> = [];
    for (const msg of conversation.messages) {
      const d = new Date(msg.createdAt);
      const key = d.toDateString();
      const last = out[out.length - 1];
      if (last && last.dateKey === key) {
        last.items.push(msg);
      } else {
        out.push({ dateKey: key, label: formatDateHeader(msg.createdAt), items: [msg] });
      }
    }
    return out;
  }, [conversation.messages]);

  if (conversation.messages.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        This conversation has no messages.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.dateKey} className="space-y-4">
          <div className="sticky top-0 z-10 flex items-center justify-center py-1">
            <span className="rounded-full border bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
              {g.label}
            </span>
          </div>
          {g.items.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              trace={traceByMessage.get(msg.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
