'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import type { AgentDocumentResponse, IngestUrlDto } from '@repo/validation';

/**
 * Wire shape of an agent RAG document. Mirrors `AgentDocumentResponse` from
 * `@repo/validation`, except dates arrive as ISO strings over JSON (the Zod
 * schema coerces them to Date server-side only).
 */
export interface AgentDocument
  extends Omit<AgentDocumentResponse, 'createdAt' | 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
}

const documentsQueryKey = (agentId: string) => ['agent-documents', agentId];

/** True while ingestion is still running for a document. */
export function isDocumentProcessing(doc: AgentDocument): boolean {
  return doc.status === 'PENDING' || doc.status === 'PROCESSING';
}

/**
 * GET the agent's document list. Polls every 3s ONLY while at least one
 * document is still being ingested (PENDING/PROCESSING) so status badges flip
 * to Indexed/Failed without a manual refresh — and goes quiet otherwise.
 */
export function useAgentDocuments(agentId: string | undefined) {
  const api = useApiClient();

  return useQuery<AgentDocument[]>({
    queryKey: documentsQueryKey(agentId ?? ''),
    queryFn: async () => api.get(`/agents/${agentId}/documents`),
    enabled: Boolean(agentId),
    refetchInterval: (query) => {
      const docs = query.state.data;
      return docs?.some(isDocumentProcessing) ? 3000 : false;
    },
  });
}

/**
 * POST a file (multipart, field `file`). The server responds immediately with
 * a PENDING document and ingests in the background — the list poll picks up
 * the status transitions.
 */
export function useUploadDocument(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AgentDocument, Error, File>({
    mutationFn: async (file) => api.upload(`/agents/${agentId}/documents`, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey(agentId) });
    },
  });
}

/** POST a public web page URL for ingestion. */
export function useIngestUrl(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AgentDocument, Error, IngestUrlDto>({
    mutationFn: async (dto) => api.post(`/agents/${agentId}/documents/url`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey(agentId) });
    },
  });
}

/**
 * Re-run chunking + embedding for one document using the agent's CURRENT
 * chunking strategy (documents remember the strategy they were indexed with).
 */
export function useReindexDocument(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AgentDocument, Error, string>({
    mutationFn: async (documentId) =>
      api.post(`/agents/${agentId}/documents/${documentId}/reindex`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey(agentId) });
    },
  });
}

/** DELETE a document and all its chunks. */
export function useDeleteDocument(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (documentId) => {
      await api.delete(`/agents/${agentId}/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey(agentId) });
    },
  });
}
