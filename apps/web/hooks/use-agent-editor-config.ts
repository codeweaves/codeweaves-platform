'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import type { WidgetTheme } from '@repo/validation';
import type { Agent } from './use-agents';
import type { InitialAgentKnowledge } from '@/components/features/agents/agent-editor/agent-editor-context';

/**
 * Shape returned by the bundled `GET /agents/:id/editor-config` endpoint.
 * Mirrors the controller's response literal — sub-resources are nullable
 * because brand-new agents have no theme/knowledge/webhook row yet.
 */
export interface AgentEditorConfigResponse {
  agent: Agent;
  webhookUrl: string | null;
  /**
   * Theme is wrapped in `{ config, version }` because `AgentThemesService`
   * returns it that way — version powers ETag-based caching on the widget
   * public endpoint. The editor only needs `.config`, but we surface the
   * whole shape so downstream code can opt into versioning if useful.
   */
  theme: { config: WidgetTheme; version: number } | null;
  knowledge: (InitialAgentKnowledge & {
    id: string;
    contentTokens: number | null;
    sourceSizeBytes: number | null;
    createdAt: string;
    updatedAt: string;
  }) | null;
}

/**
 * Single fetch that hydrates the entire agent editor page — agent core +
 * webhook + theme + knowledge. Replaces the pre-bundle pattern of firing four
 * parallel GETs on mount.
 *
 * Query key: `['agent-editor-config', id]`. `handleSave` in the layout writes
 * directly into this key via `setQueryData` on successful save so the UI
 * reflects new state without a refetch (optimistic-on-success).
 *
 * `enabled` guard: pass `undefined` when the route param isn't resolved yet;
 * the query is skipped until an id exists.
 */
export const agentEditorConfigQueryKey = (id: string | undefined) =>
  ['agent-editor-config', id ?? '__empty__'] as const;

export function useAgentEditorConfig(id: string | undefined) {
  const api = useApiClient();

  return useQuery<AgentEditorConfigResponse>({
    queryKey: agentEditorConfigQueryKey(id),
    queryFn: () => api.get(`/agents/${id}/editor-config`),
    enabled: Boolean(id),
    // Page is navigated-to, not hot-reloaded repeatedly. 1 minute matches
    // the rest of the agent-related queries; a fresh navigation always
    // triggers a refetch anyway (queryFn runs on first mount per key).
    staleTime: 60_000,
  });
}
