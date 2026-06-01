'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';

/**
 * Shape mirrors `AgentKnowledge` in the Prisma schema. The text extraction
 * endpoint returns the same shape (minus `id`/`agentId`) so the UI can show a
 * preview before the operator commits to persisting.
 */
export interface AgentKnowledge {
  id: string;
  agentId: string;
  content: string;
  contentTokens: number | null;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceSizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedKnowledge {
  content: string;
  contentTokens: number;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
}

export interface UpdateKnowledgeDto {
  content: string;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
}

const knowledgeQueryKey = (agentId: string) => ['agent-knowledge', agentId];

/**
 * GET the agent's current stored knowledge. Returns `null` if none exists —
 * tanstack-query caches the null so the UI can render an empty state without
 * flicker on re-visit.
 */
export function useAgentKnowledge(agentId: string | undefined) {
  const api = useApiClient();

  return useQuery<AgentKnowledge | null>({
    queryKey: knowledgeQueryKey(agentId ?? ''),
    queryFn: async () => api.get(`/agents/${agentId}/knowledge`),
    enabled: Boolean(agentId),
    // Knowledge text is often large; keep it fresh but avoid a network round
    // trip every render. 1 minute matches other agent resources.
    staleTime: 60_000,
  });
}

/**
 * Upload a file and get back extracted text WITHOUT saving. The UI shows the
 * extracted text in an editable textarea so the operator can clean it up
 * before committing via `useSetAgentKnowledge`.
 */
export function useExtractKnowledgeFile(agentId: string) {
  const api = useApiClient();

  return useMutation<ExtractedKnowledge, Error, File>({
    mutationFn: async (file) =>
      api.upload(`/agents/${agentId}/knowledge/extract`, file),
  });
}

/**
 * PUT the knowledge content. Upserts under the hood — safe to call on first
 * creation or when replacing. Invalidates the knowledge query on success so
 * the preview re-fetches with the new token count.
 */
export function useSetAgentKnowledge(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AgentKnowledge, Error, UpdateKnowledgeDto>({
    mutationFn: async (dto) => api.put(`/agents/${agentId}/knowledge`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeQueryKey(agentId) });
    },
  });
}

/**
 * DELETE the agent's knowledge record. Idempotent on the backend — calling
 * when none exists succeeds silently.
 */
export function useRemoveAgentKnowledge(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api.delete(`/agents/${agentId}/knowledge`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeQueryKey(agentId) });
    },
  });
}
