'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';
import type {
  AgentIntegrationResponse,
  IntegrationProvider,
} from '@repo/validation';

/**
 * Wire shape of one connected third-party integration. Mirrors
 * `AgentIntegrationResponse` from `@repo/validation`, except dates arrive as
 * ISO strings over JSON. Credentials are NEVER returned — only a masked
 * `credentialHint` safe to display.
 */
export interface AgentIntegration
  extends Omit<
    AgentIntegrationResponse,
    'lastTestedAt' | 'createdAt' | 'updatedAt'
  > {
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

const integrationsQueryKey = (agentId: string) => [
  'agent-integrations',
  agentId,
];

/** GET all integrations connected to this agent. */
export function useAgentIntegrations(agentId: string | undefined) {
  const api = useApiClient();

  return useQuery<AgentIntegration[]>({
    queryKey: integrationsQueryKey(agentId ?? ''),
    queryFn: async () => api.get(`/agents/${agentId}/integrations`),
    enabled: Boolean(agentId),
  });
}

/**
 * PUT — connect or update credentials. The backend runs a LIVE connection
 * test before persisting and rejects with a 400 (message = the test failure
 * reason) when the credentials don't work, so surface `error.message`.
 */
export function useUpsertIntegration(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<
    AgentIntegration,
    Error,
    {
      provider: IntegrationProvider;
      credentials: Record<string, unknown>;
      enabled: boolean;
      config?: Record<string, unknown>;
    }
  >({
    mutationFn: async ({ provider, credentials, enabled, config }) =>
      api.put(`/agents/${agentId}/integrations/${provider}`, {
        credentials,
        enabled,
        ...(config ? { config } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationsQueryKey(agentId) });
    },
  });
}

/**
 * POST — re-run the live connection test with the stored credentials.
 * Also refreshes the list since the backend updates status/lastTestedAt.
 */
export function useTestIntegration(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<IntegrationTestResult, Error, IntegrationProvider>({
    mutationFn: async (provider) =>
      api.post(`/agents/${agentId}/integrations/${provider}/test`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: integrationsQueryKey(agentId) });
    },
  });
}

/** PATCH — enable/disable without touching credentials. */
export function useSetIntegrationEnabled(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<
    AgentIntegration,
    Error,
    { provider: IntegrationProvider; enabled: boolean }
  >({
    mutationFn: async ({ provider, enabled }) =>
      api.patch(`/agents/${agentId}/integrations/${provider}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationsQueryKey(agentId) });
    },
  });
}

/** DELETE — disconnect and forget the stored credentials. */
export function useRemoveIntegration(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, IntegrationProvider>({
    mutationFn: async (provider) => {
      await api.delete(`/agents/${agentId}/integrations/${provider}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationsQueryKey(agentId) });
    },
  });
}
