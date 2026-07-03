'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Headset, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/hooks/use-profile';
import {
  useHandoverEnabled,
  type HandoverFilter,
} from '@/hooks/use-handover';
import { InboxListPane } from './inbox-list-pane';
import { InboxThreadPane } from './inbox-thread-pane';

/**
 * Shown when no in-scope bot has human takeover turned on — the Inbox has
 * nothing to surface until a teammate enables it on an agent.
 */
function HandoverDisabledState() {
  return (
    <div className="flex h-[calc(100svh-7.5rem)] flex-col gap-4">
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border bg-background">
        <div className="flex max-w-sm flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headset className="size-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold">Human takeover is off</h2>
            <p className="text-sm text-muted-foreground">
              No agent has human takeover enabled yet. Turn it on in an
              agent&apos;s settings, and conversations where a visitor asks for a
              person will land here.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/dashboard/agents">
              Go to Agents
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Live human-handover Inbox. Two-pane split (list + thread), mirroring the
 * Conversations layout but action-oriented: take over, reply, resolve. Updates
 * arrive over the Socket.io handover gateway (with a React Query poll as the
 * safety net).
 */
export function InboxView({ selectedSessionId }: { selectedSessionId: string | null }) {
  const router = useRouter();
  const { profile } = useProfile();
  const [filter, setFilter] = useState<HandoverFilter>('needs');
  const { enabled, isResolved } = useHandoverEnabled();

  // Org realtime is mounted globally in DashboardShell now (so the sidebar flag
  // updates on every page), so this view doesn't subscribe separately.

  const select = useCallback(
    (sessionId: string) =>
      router.replace(`/dashboard/inbox?session=${sessionId}`, { scroll: false }),
    [router],
  );
  const back = useCallback(
    () => router.replace('/dashboard/inbox', { scroll: false }),
    [router],
  );

  // Only once the check has returned — avoids flashing the empty state on load.
  if (isResolved && !enabled) return <HandoverDisabledState />;

  return (
    <div className="flex h-[calc(100svh-7.5rem)] flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <div className="flex h-full">
          <InboxListPane
            filter={filter}
            onFilterChange={setFilter}
            selectedSessionId={selectedSessionId}
            onSelect={select}
            className="w-100 shrink-0 border-r lg:w-110"
          />
          <InboxThreadPane
            sessionId={selectedSessionId}
            currentUserId={profile?.id ?? null}
            onBack={back}
            onTakenOver={() => setFilter('handling')}
            className="min-w-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}
