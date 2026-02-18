'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAgent } from '@/hooks/use-agents';
import { useApiClient } from '@/lib/api-client';
import { useProfile } from '@/hooks/use-profile';
import { AgentEditorLayout } from '@/components/features/agents/agent-editor/agent-editor-layout';

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
  const [webhookLoaded, setWebhookLoaded] = useState(false);

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  // Fetch webhook URL for admins (separate encrypted endpoint)
  useEffect(() => {
    if (!agent || !isAdmin) {
      setWebhookLoaded(true);
      return;
    }
    let cancelled = false;
    api
      .get(`/agents/${agent.id}/webhook`)
      .then((res: { webhookUrl: string | null }) => {
        if (!cancelled) setWebhookUrl(res?.webhookUrl ?? '');
      })
      .catch(() => {
        // Webhook might not exist yet — that's OK
      })
      .finally(() => {
        if (!cancelled) setWebhookLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, isAdmin, api]);

  if (isLoading || !webhookLoaded) {
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

  return <AgentEditorLayout agent={agent} webhookUrl={webhookUrl} />;
}
