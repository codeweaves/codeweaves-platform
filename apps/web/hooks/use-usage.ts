"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BilledToKey,
  CreateProviderPrice,
  UsageChannelKey,
  UsageFeatureKey,
} from "@repo/validation";
import { useApiClient } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";

// Shapes match apps/api/src/modules/usage/usage-report.service.ts and
// price-admin.service.ts.

export interface NativeAmounts {
  USD: number;
  INR: number;
}

export interface CostBreakdown {
  rows: number;
  unpricedRows: number;
  /** Our cost in INR. Null when no USD to INR rate is stored. */
  costInr: number | null;
  native: NativeAmounts;
  clientRows: number;
  clientCostInr: number | null;
  clientNative: NativeAmounts;
}

export interface FxInfo {
  available: boolean;
  latestDate: string | null;
  latestUsdToInr: number | null;
}

export type CostCategory = "LLM" | "STT" | "TTS" | "OTHER";

export interface UsageSummary {
  range: { from: string; to: string };
  fx: FxInfo;
  totals: CostBreakdown & { conversations: number };
  quantitySources: {
    PROVIDER_REPORTED: number;
    MEASURED: number;
    ESTIMATED: number;
  };
  byCategory: Record<CostCategory, { rows: number; costInr: number | null }>;
  byProviderModel: Array<
    CostBreakdown & {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      audioSeconds: number;
      characters: number;
      units: number;
    }
  >;
  byFeature: Array<CostBreakdown & { feature: string }>;
  byChannel: Array<CostBreakdown & { channel: string }>;
}

export interface UsageTimeseries {
  granularity: "day";
  fx: FxInfo;
  features: string[];
  days: Array<{
    date: string;
    totalInr: number | null;
    byFeature: Record<string, number | null>;
  }>;
}

export interface RankedRow extends CostBreakdown {
  conversations: number;
  costPerConversationInr: number | null;
}

export interface OrganizationUsageRow extends RankedRow {
  organizationId: string | null;
  organizationName: string | null;
}

export interface AgentUsageRow extends RankedRow {
  agentId: string | null;
  agentName: string | null;
  organizationId: string | null;
  organizationName: string | null;
}

export interface PricingLine {
  unit: string;
  quantity: number;
  priceId: string | null;
  price: number | null;
  per: number | null;
  amount: number | null;
}

export interface ConversationUsageLine {
  id: string;
  occurredAt: string;
  channel: string;
  feature: string;
  provider: string;
  model: string;
  quantitySource: string;
  billedTo: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  audioSeconds: number | null;
  characters: number | null;
  units: number | null;
  cost: number | null;
  currency: string | null;
  pricing: PricingLine[] | null;
  fxRate: number | null;
  fxDate: string | null;
  costInr: number | null;
  latencyMs: number | null;
}

export interface ConversationUsage {
  chatSessionId: string;
  organizationId: string | null;
  organizationName: string | null;
  agentId: string | null;
  agentName: string | null;
  fx: FxInfo;
  lines: ConversationUsageLine[];
  totalInr: number | null;
  clientTotalInr: number | null;
  unpricedLines: number;
}

export interface UnitEconomics {
  fx: FxInfo;
  perConversation: {
    conversations: number;
    avgInr: number | null;
    p50Inr: number | null;
    p90Inr: number | null;
    maxInr: number | null;
  };
  voice: {
    conversations: number;
    audioMinutes: number;
    sttInr: number | null;
    ttsInr: number | null;
    llmInr: number | null;
    totalInr: number | null;
    costPerMinuteInr: number | null;
    unpricedRows: number;
  };
  topConversations: Array<{
    chatSessionId: string;
    organizationName: string | null;
    agentName: string | null;
    calls: number;
    costInr: number | null;
    lastAt: string;
  }>;
}

export interface PriceRow {
  id: string;
  provider: string;
  model: string;
  unit: string;
  price: string;
  per: number;
  currency: string;
  effectiveFrom: string;
  sourceUrl: string;
  note: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface PriceGroup {
  provider: string;
  model: string;
  unit: string;
  current: PriceRow | null;
  upcoming: PriceRow[];
  previous: PriceRow[];
}

export interface MissingPrice {
  provider: string;
  model: string;
  feature: string;
  rows: number;
  lastSeen: string;
}

export interface PriceList {
  groups: PriceGroup[];
  missing: MissingPrice[];
}

export interface UsageFilters {
  /** YYYY-MM-DD, a whole UTC day. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  organizationId?: string;
  agentId?: string;
  provider?: string;
  feature?: UsageFeatureKey;
  channel?: UsageChannelKey;
  billedTo?: BilledToKey;
}

/** Reports read the ledger as it grows; a minute is fresh enough for staff. */
const USAGE_STALE_TIME = 60_000;
const PRICES_STALE_TIME = 5 * 60_000;

export function usageQueryString(
  filters: UsageFilters,
  extra?: Record<string, string | number>,
): string {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== "") qp.set(k, String(v));
  }
  return qp.toString();
}

/** Shared gate: signed in and holding Usage:Read. Stops a guaranteed 403. */
function useUsageEnabled(): boolean {
  const { isAuthenticated, isLoading } = useAuth();
  const { can, isLoading: permsLoading } = usePermissions();
  return isAuthenticated && !isLoading && !permsLoading && can("Usage:Read");
}

function useUsageQuery<T>(
  path: string,
  filters: UsageFilters,
  extra?: Record<string, string | number>,
) {
  const api = useApiClient();
  const enabled = useUsageEnabled();
  const qs = usageQueryString(filters, extra);
  return useQuery<T>({
    queryKey: ["admin-usage", path, qs],
    queryFn: () => api.get(`/admin/usage/${path}?${qs}`),
    enabled,
    staleTime: USAGE_STALE_TIME,
    // Keep the last result on screen while a filter change loads.
    placeholderData: keepPreviousData,
  });
}

export function useUsageSummary(filters: UsageFilters) {
  return useUsageQuery<UsageSummary>("summary", filters);
}

export function useUsageTimeseries(filters: UsageFilters) {
  return useUsageQuery<UsageTimeseries>("timeseries", filters, {
    granularity: "day",
  });
}

export function useUsageOrganizations(filters: UsageFilters, limit = 50) {
  return useUsageQuery<{ fx: FxInfo; rows: OrganizationUsageRow[] }>(
    "organizations",
    filters,
    { limit },
  );
}

export function useUsageAgents(filters: UsageFilters, limit = 50) {
  return useUsageQuery<{ fx: FxInfo; rows: AgentUsageRow[] }>(
    "agents",
    filters,
    { limit },
  );
}

export function useUnitEconomics(filters: UsageFilters) {
  return useUsageQuery<UnitEconomics>("unit-economics", filters);
}

export function useConversationUsage(chatSessionId: string) {
  const api = useApiClient();
  const enabled = useUsageEnabled();
  return useQuery<ConversationUsage>({
    queryKey: ["admin-usage", "conversation", chatSessionId],
    queryFn: () =>
      api.get(
        `/admin/usage/conversations/${encodeURIComponent(chatSessionId)}`,
      ),
    enabled: enabled && chatSessionId.length > 0,
    staleTime: USAGE_STALE_TIME,
    retry: false,
  });
}

export function usePriceList() {
  const api = useApiClient();
  const enabled = useUsageEnabled();
  return useQuery<PriceList>({
    queryKey: ["admin-prices"],
    queryFn: () => api.get("/admin/prices"),
    enabled,
    staleTime: PRICES_STALE_TIME,
  });
}

export function useAddPrice() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<PriceRow, Error, CreateProviderPrice>({
    mutationFn: (body) => api.post("/admin/prices", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-prices"] });
    },
  });
}

/** Download the ledger rows in range as CSV (audit-logged server-side). */
export function useUsageExport() {
  const api = useApiClient();
  return useMutation<string, Error, UsageFilters>({
    mutationFn: (filters) =>
      api.download(
        `/admin/usage/export.csv?${usageQueryString(filters)}`,
        `usage-${filters.from}-to-${filters.to}.csv`,
      ),
  });
}
