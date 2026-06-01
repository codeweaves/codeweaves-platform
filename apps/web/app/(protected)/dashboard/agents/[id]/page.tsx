'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAgentEditorConfig } from '@/hooks/use-agent-editor-config';
import { AgentEditorLayout } from '@/components/features/agents/agent-editor/agent-editor-layout';

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Agent editor entry point. Hydrates the editor from a single bundled GET —
 * `GET /agents/:id/editor-config` — so we only pay one HTTP round-trip on
 * mount instead of fanning out 4 parallel requests for agent / webhook /
 * theme / knowledge.
 *
 * Save path (see `agent-editor-layout.tsx::handleSave`) writes the new state
 * into the `['agent-editor-config', id]` query cache on success, avoiding a
 * refetch after every Save click.
 */
export default function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const { data, isLoading, error } = useAgentEditorConfig(id);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.agent) {
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
      agent={data.agent}
      webhookUrl={data.webhookUrl ?? ''}
      // Unwrap `.config` — the bundle returns the full theme envelope
      // `{ config, version }` for ETag parity with the standalone endpoint.
      initialThemeData={data.theme?.config ?? undefined}
      initialKnowledge={
        data.knowledge
          ? {
              content: data.knowledge.content,
              sourceFileName: data.knowledge.sourceFileName,
              sourceMimeType: data.knowledge.sourceMimeType,
            }
          : null
      }
    />
  );
}
