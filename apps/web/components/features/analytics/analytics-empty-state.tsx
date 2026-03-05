'use client';

import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnalyticsEmptyStateProps {
  hasAgents: boolean;
}

export function AnalyticsEmptyState({ hasAgents }: AnalyticsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BarChart3 className="h-16 w-16 text-muted-foreground/40" />
      <h2 className="mt-4 text-lg font-semibold">
        {hasAgents ? 'No data for the selected period' : 'No analytics data yet'}
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {hasAgents
          ? 'Try expanding the date range or wait for more conversations to come in.'
          : 'Create your first agent and start chatting to see analytics here.'}
      </p>
      {!hasAgents && (
        <Button asChild className="mt-6">
          <Link href="/dashboard/agents">Create Agent</Link>
        </Button>
      )}
    </div>
  );
}
