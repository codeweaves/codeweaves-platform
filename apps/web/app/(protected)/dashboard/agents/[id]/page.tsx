'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAgent } from '@/hooks/use-agents';
import { useApiClient } from '@/lib/api-client';
import { useProfile } from '@/hooks/use-profile';
import { AgentEditorLayout } from '@/components/features/agents/agent-editor/agent-editor-layout';
import type { WidgetTheme } from '@repo/validation';

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { profile } = useProfile();
  const api = useApiClient();
  const { data: agent, isLoading, error } = useAgent(id);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [themeData, setThemeData] = useState<WidgetTheme | undefined>(undefined);
  const [extrasLoaded, setExtrasLoaded] = useState(false);

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  // Fetch webhook URL (admins only) and theme data in parallel.
  // Must wait for profile before running — isAdmin depends on profile which
  // loads async. Without this guard, isAdmin is false on first run and the
  // webhook fetch is skipped entirely, leaving the input empty.
  useEffect(() => {
    if (!agent || !profile) return;
    let cancelled = false;

    const webhookPromise = isAdmin
      ? api
          .get(`/agents/${agent.id}/webhook`)
          .then((res: { webhookUrl: string | null }) => {
            if (!cancelled) setWebhookUrl(res?.webhookUrl ?? '');
          })
          .catch(() => { /* Webhook might not exist yet */ })
      : Promise.resolve();

    const themePromise = api
      .get(`/agents/${agent.id}/theme`)
      .then((res: { config: WidgetTheme }) => {
        if (!cancelled && res?.config) setThemeData(res.config);
      })
      .catch(() => { /* Theme might not exist yet — defaults will be used */ });

    Promise.all([webhookPromise, themePromise]).finally(() => {
      if (!cancelled) setExtrasLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [agent, profile, isAdmin, api]);

  if (isLoading || !extrasLoaded) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-2xl font-bold">Agent not found</h2>
        <p className="text-muted-foreground">
          The agent you&apos;re looking for doesn&apos;t exist or you
          don&apos;t have access.
        </p>
        <button
          onClick={() => router.push('/dashboard/agents')}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to agents
        </button>
      </div>
    );
  }

  return (
    <AgentEditorLayout
      agent={agent}
      webhookUrl={webhookUrl}
      initialThemeData={themeData}
    />
  );
}
