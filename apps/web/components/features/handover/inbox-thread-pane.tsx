'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Headset,
  User,
  Flag,
  Loader2,
  Send,
  CheckCircle2,
  Lock,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  useThread,
  useTakeover,
  useResolveHandover,
  useSendHumanMessage,
  type ThreadMessage,
} from '@/hooks/use-handover';
import {
  ensureHandoverSocket,
  profileHandoverAuth,
  watchSession,
  unwatchSession,
  emitAgentTyping,
} from '@/lib/handover-socket';
import { useProfile } from '@/hooks/use-profile';
import { useAuth } from '@/hooks/use-auth';

function MessageBubble({ message }: { message: ThreadMessage }) {
  if (message.role === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <span className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" />
          {message.content}
        </span>
      </div>
    );
  }

  const isVisitor = message.role === 'USER';
  const isBot = message.role === 'ASSISTANT';
  // Visitor on the right (matches the Conversations transcript); bot + human on
  // the left (the responder side), distinguished by colour + label.
  return (
    <div className={cn('flex w-full gap-3', isVisitor ? 'justify-end' : 'justify-start')}>
      {!isVisitor && (
        <div
          className={cn(
            'mt-1 flex size-7 shrink-0 items-center justify-center rounded-full',
            isBot ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {isBot ? <Bot className="size-4" /> : <Headset className="size-4" />}
        </div>
      )}
      <div className="min-w-0 max-w-[80%]">
        <div
          className={cn(
            'rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words',
            isVisitor && 'rounded-tr-sm bg-primary text-primary-foreground',
            isBot && 'rounded-tl-sm bg-muted text-foreground',
            !isVisitor && !isBot && 'rounded-tl-sm border border-primary/20 bg-primary/10 text-foreground',
          )}
        >
          {message.content}
        </div>
        <div
          className={cn(
            'mt-1 text-[11px] text-muted-foreground',
            isVisitor ? 'text-right' : 'text-left',
          )}
        >
          {isVisitor ? 'Visitor' : isBot ? 'AI' : message.author ?? 'You'} ·{' '}
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      {isVisitor && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}

interface InboxThreadPaneProps {
  sessionId: string | null;
  currentUserId: string | null;
  onBack: () => void;
  /** Called after a successful takeover so the view can switch to "Handling". */
  onTakenOver?: () => void;
  className?: string;
}

export function InboxThreadPane({ sessionId, currentUserId, onBack, onTakenOver, className }: InboxThreadPaneProps) {
  const { data: thread, isLoading } = useThread(sessionId);
  const takeover = useTakeover();
  const resolve = useResolveHandover();
  const sendMessage = useSendHumanMessage();
  const { profile } = useProfile();
  const { getToken } = useAuth();
  const [draft, setDraft] = useState('');
  const [visitorTyping, setVisitorTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visitorTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Scope the socket to the VIEWER (org for a CLIENT, platform for an admin) —
  // the same scope useHandoverRealtime uses, so we reuse that socket, not churn it.
  const scopeOrgId = profile?.organization?.id ?? undefined;
  const scopeRole = profile?.role;

  // Auto-scroll to the newest message (also when the typing indicator appears).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, sessionId, visitorTyping]);

  // Realtime: watch this session's room ONLY for the visitor's "typing…" signal.
  // Message/handover refetches are handled once, globally, by useHandoverRealtime
  // (org/platform room) — doing them here too caused a burst of duplicate fetches.
  useEffect(() => {
    const auth = profileHandoverAuth({
      role: scopeRole,
      organization: scopeOrgId ? { id: scopeOrgId } : null,
    });
    if (!sessionId || !auth) return;
    const socket = ensureHandoverSocket(auth, getToken);
    watchSession(sessionId);

    const onTyping = (p?: { from?: string; sessionId?: string }) => {
      if (p?.from !== 'visitor' || p.sessionId !== sessionId) return;
      setVisitorTyping(true);
      if (visitorTypingTimerRef.current) clearTimeout(visitorTypingTimerRef.current);
      visitorTypingTimerRef.current = setTimeout(() => setVisitorTyping(false), 4000);
    };

    socket.on('typing', onTyping);
    return () => {
      socket.off('typing', onTyping);
      unwatchSession(sessionId);
      if (visitorTypingTimerRef.current) {
        clearTimeout(visitorTypingTimerRef.current);
        visitorTypingTimerRef.current = null;
      }
      setVisitorTyping(false);
    };
  }, [sessionId, scopeOrgId, scopeRole, getToken]);

  // Once a conversation is resolved — by you, another teammate, or the idle
  // sweep — it leaves the live queue, so drop it from the main pane too (back
  // to the empty state). The full transcript still lives under Conversations.
  //
  // IMPORTANT: only fire on a genuine live→NONE transition we actually watched.
  // Firing on a NONE that's just stale React Query cache (e.g. reopening a chat
  // that was resolved then re-escalated) made it flash open then deselect.
  const prevHandoverState = useRef<string | null>(null);
  const trackedSession = useRef<string | null>(null);
  useEffect(() => {
    if (trackedSession.current !== sessionId) {
      trackedSession.current = sessionId;
      prevHandoverState.current = null; // reset when switching conversations
    }
    const state = thread?.handoverState;
    if (state == null) return;
    if (state !== 'NONE') {
      prevHandoverState.current = state;
    } else if (prevHandoverState.current && prevHandoverState.current !== 'NONE') {
      onBack();
    }
  }, [sessionId, thread?.handoverState, onBack]);

  if (!sessionId) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}>
        <Headset className="size-10 text-muted-foreground/40" />
        <span className="text-sm font-medium">No conversation selected</span>
        <span className="max-w-xs text-xs text-muted-foreground">
          Pick a chat from the list to view it and take over when a visitor needs a human.
        </span>
      </div>
    );
  }

  if (isLoading || !thread) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const state = thread.handoverState;
  const handledByMe = state === 'ACTIVE_HUMAN' && thread.takenOverBy?.id === currentUserId;
  const handledByOther = state === 'ACTIVE_HUMAN' && !handledByMe;

  const doTakeover = () =>
    takeover.mutate(thread.sessionId, {
      onSuccess: () => {
        toast.success('You\'re now handling this chat — the AI is paused.');
        onTakenOver?.();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not take over'),
    });

  const doResolve = () =>
    resolve.mutate(thread.sessionId, {
      onSuccess: () => toast.success('Resolved — the AI takes over again.'),
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resolve'),
    });

  const doSend = () => {
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    sendMessage.mutate(
      { sessionId: thread.sessionId, content },
      { onError: (e) => toast.error(e instanceof Error ? e.message : 'Message failed to send') },
    );
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3 md:px-6">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            Visitor{thread.visitorId ? ` · ${thread.visitorId}` : ''}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3" />
              {thread.agent.name}
            </span>
            <span>{thread.source.charAt(0) + thread.source.slice(1).toLowerCase()}</span>
            {state === 'REQUESTED' && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <Flag className="size-3" /> Wants human
              </span>
            )}
          </div>
        </div>
        {state !== 'NONE' &&
          (handledByMe ? (
            <Button variant="outline" size="sm" onClick={doResolve} disabled={resolve.isPending}>
              <CheckCircle2 className="size-4" /> Resolve
            </Button>
          ) : (
            <Button size="sm" onClick={doTakeover} disabled={takeover.isPending}>
              <Headset className="size-4" /> {handledByOther ? 'Take over' : 'Take over'}
            </Button>
          ))}
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="thin-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-background p-4 md:p-6">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {visitorTyping && (
          <div className="flex items-center justify-end gap-2 px-1 text-xs text-muted-foreground">
            Visitor is typing…
            <span className="flex gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0.1s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0.2s]" />
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t bg-card p-3 md:px-4">
        {handledByMe ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Let the visitor see the teammate is typing (throttled).
                emitAgentTyping(thread.sessionId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  doSend();
                }
              }}
              placeholder="Type your reply…"
              className="max-h-32 min-h-10 flex-1 resize-none"
              rows={1}
            />
            <Button onClick={doSend} disabled={!draft.trim() || sendMessage.isPending}>
              <Send className="size-4" /> Send
            </Button>
          </div>
        ) : handledByOther ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            {thread.takenOverBy?.name ?? 'A teammate'} is handling this chat. Take over to reply yourself.
          </div>
        ) : state === 'REQUESTED' ? (
          <div className="flex items-center gap-3 rounded-lg bg-destructive/10 px-3 py-2.5">
            <Flag className="size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-destructive">This visitor asked for a human</p>
              <p className="text-[11px] text-muted-foreground">
                The AI is keeping them engaged. Take over to reply — the AI will pause.
              </p>
            </div>
            <Button size="sm" onClick={doTakeover} disabled={takeover.isPending}>
              <Headset className="size-4" /> Take over
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="size-3.5" /> The AI is handling this conversation.
            </span>
            <Button variant="outline" size="sm" onClick={doTakeover} disabled={takeover.isPending}>
              <Headset className="size-4" /> Take over
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
