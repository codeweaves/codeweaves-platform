"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useTabVisible } from "@/hooks/use-tab-visible";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface OpsPageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** True when the count stopped at 10,000; the real number is higher. */
  totalCapped: boolean;
  from: string;
  to: string;
}

export interface OpsPage<T> {
  data: T[];
  meta: OpsPageMeta;
}

type QueryValue = string | number | boolean | string[] | undefined;

function toQueryString(params: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) qs.set(key, value.join(","));
    } else {
      qs.set(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  createdAt: string;
  event: string;
  contextId: string;
  correlationId: string | null;
  userId: string | null;
  user: { id: string; email: string; name: string | null } | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  agentId: string | null;
  agent: { id: string; name: string } | null;
  data: unknown;
}

export interface AuditLogParams {
  page: number;
  limit: number;
  sortOrder: "asc" | "desc";
  search?: string;
  organizationId?: string;
  userId?: string;
  events?: string[];
  from?: string;
  to?: string;
}

export function useAuditLogs(params: AuditLogParams, enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();
  return useQuery<OpsPage<AuditLogRow>>({
    queryKey: ["ops-console", "audit-logs", params],
    queryFn: () => api.get(`/admin/audit-logs${toQueryString({ ...params })}`),
    enabled: enabled && isAuthenticated && !authLoading,
    placeholderData: keepPreviousData,
  });
}

export function useAuditEventNames(enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();
  return useQuery<{ events: string[] }>({
    queryKey: ["ops-console", "audit-event-names"],
    queryFn: () => api.get("/admin/audit-logs/event-names"),
    enabled: enabled && isAuthenticated && !authLoading,
    // The option list barely moves; refetching it on every visit is waste.
    staleTime: 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type EventChannel =
  "WIDGET" | "DASHBOARD" | "WHATSAPP" | "VOICE" | "INTERNAL" | "SYSTEM";

export interface EventLogRow {
  id: string;
  createdAt: string;
  channel: EventChannel;
  eventName: string;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  provider: string | null;
  actorUserId: string | null;
  agentId: string | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  sessionId: string | null;
  correlationId: string | null;
  requestUrl: string | null;
  responseStatus: number | null;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface EventLogDetail extends EventLogRow {
  actor: { id: string; email: string; name: string | null } | null;
  visitorId: string | null;
  requestHeaders: Record<string, string> | null;
  requestPayload: unknown;
  responsePayload: unknown;
  metadata: unknown;
}

export interface EventLogParams {
  page: number;
  limit: number;
  sortOrder: "asc" | "desc";
  search?: string;
  channels?: string[];
  providers?: string[];
  success?: "true" | "false";
  organizationId?: string;
  from?: string;
  to?: string;
}

export function useEventLogs(params: EventLogParams, enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();
  return useQuery<OpsPage<EventLogRow>>({
    queryKey: ["ops-console", "event-logs", params],
    queryFn: () => api.get(`/admin/event-logs${toQueryString({ ...params })}`),
    enabled: enabled && isAuthenticated && !authLoading,
    placeholderData: keepPreviousData,
  });
}

/** One row with payloads. Fetched only when the sheet opens. */
export function useEventLog(id: string | null) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();
  return useQuery<EventLogDetail>({
    queryKey: ["ops-console", "event-log", id],
    queryFn: () => api.get(`/admin/event-logs/${id}`),
    enabled: !!id && isAuthenticated && !authLoading,
    // A log row never changes once written.
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// System status
// ---------------------------------------------------------------------------

export type CronJobState = "ok" | "failed" | "overdue" | "never";

export interface CronJobStatus {
  key: string;
  label: string;
  endpoint: string;
  expectedEveryMinutes: number;
  state: CronJobState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  runsLast24h: number;
  failuresLast24h: number;
  backlog?: { waiting: number; oldestDueAt: string | null };
}

export interface ProviderHealth {
  provider: string;
  calls: number;
  failed: number;
  errorRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  lastFailureAt: string | null;
  alert: boolean;
}

export type DependencyState = "ok" | "fail" | "degraded" | "disabled";

export interface SystemStatus {
  generatedAt: string;
  jobs: CronJobStatus[];
  providers: { windowMinutes: number; rows: ProviderHealth[] };
  unpricedUsage: {
    windowHours: number;
    totalRecords: number;
    unpricedRecords: number;
    top: Array<{
      provider: string;
      model: string;
      count: number;
      lastSeenAt: string;
    }>;
  };
  readiness: {
    status: "ok" | "degraded" | "fail";
    timestamp: string;
    checks: Record<
      "db" | "redis",
      { state: DependencyState; latencyMs: number; error?: string }
    >;
  };
}

const STATUS_REFRESH_MS = 60_000;

/** Refreshes every 60 s, but only while the tab is visible. */
export function useSystemStatus(enabled: boolean) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const api = useApiClient();
  const visible = useTabVisible();
  return useQuery<SystemStatus>({
    queryKey: ["ops-console", "system-status"],
    queryFn: () => api.get("/admin/system-status"),
    enabled: enabled && isAuthenticated && !authLoading,
    refetchInterval: visible ? STATUS_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}
