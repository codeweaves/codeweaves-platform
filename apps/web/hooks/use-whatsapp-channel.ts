'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api-client';

/** Mirrors the API's WhatsappChannelView — never includes the access token. */
export interface WhatsappChannel {
  id: string;
  agentId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string | null;
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  voiceReplyEnabled: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectWhatsappChannelDto {
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  accessToken: string;
  verifiedName?: string;
  tokenExpiresAt?: string;
}

const channelQueryKey = (agentId: string) => ['whatsapp-channel', agentId];

/**
 * GET the agent's connected WhatsApp channel. Returns `null` when none exists —
 * tanstack-query caches the null so the connect form renders without flicker.
 */
export function useWhatsappChannel(agentId: string | undefined) {
  const api = useApiClient();

  return useQuery<WhatsappChannel | null>({
    queryKey: channelQueryKey(agentId ?? ''),
    queryFn: async () => api.get(`/agents/${agentId}/whatsapp`),
    enabled: Boolean(agentId),
    staleTime: 60_000,
  });
}

/** POST to connect (or re-connect) a number. Upserts on the backend. */
export function useConnectWhatsappChannel(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<WhatsappChannel, Error, ConnectWhatsappChannelDto>({
    mutationFn: async (dto) => api.post(`/agents/${agentId}/whatsapp`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelQueryKey(agentId) });
    },
  });
}

/** PATCH mutable channel settings (currently just the voice-reply toggle). */
export function useUpdateWhatsappChannel(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<WhatsappChannel, Error, { voiceReplyEnabled: boolean }>({
    mutationFn: async (dto) => api.patch(`/agents/${agentId}/whatsapp`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelQueryKey(agentId) });
    },
  });
}

/** DELETE the channel. Idempotent on the backend. */
export function useDisconnectWhatsappChannel(agentId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api.delete(`/agents/${agentId}/whatsapp`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelQueryKey(agentId) });
    },
  });
}
