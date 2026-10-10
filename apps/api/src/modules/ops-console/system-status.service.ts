import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../services/prisma.service";
import { RedisService } from "../../common/redis/redis.service";
import { probeReadiness, type ReadinessReport } from "../health/readiness";
import { HOUR_MS, daysMs, truncate } from "./ops-console.util";

const MINUTE_MS = 60 * 1000;

/** A provider is flagged when more than this share of its calls failed. */
export const PROVIDER_ERROR_RATE_ALERT = 0.1;
/** How far back "last run" looks. Older runs read as "never ran". */
const JOB_LOOKBACK_MS = daysMs(30);
/** A conversation still waiting for extraction this long means the job is stuck. */
const EXTRACTION_BACKLOG_GRACE_MS = 10 * MINUTE_MS;

export interface CronJobDefinition {
  key: string;
  label: string;
  endpoint: string;
  completedEvent: string;
  /** Null when the job records no failure event of its own. */
  failedEvent: string | null;
  expectedEveryMinutes: number;
}

/**
 * Every internal cron (docs/runbooks/cron-jobs.md) and the event it records.
 * Each job writes its completed event on every run, idle runs included, so a
 * gap always means the scheduler stopped calling it.
 */
export const CRON_JOBS: readonly CronJobDefinition[] = [
  {
    key: "dataExtraction",
    label: "Data extraction",
    endpoint: "/internal/data-extraction/run",
    completedEvent: "DATA_EXTRACTION_RUN_COMPLETED",
    failedEvent: null,
    expectedEveryMinutes: 1,
  },
  {
    key: "handoverSweep",
    label: "Handover sweep",
    endpoint: "/internal/handover/sweep",
    completedEvent: "HANDOVER_SWEEP_COMPLETED",
    failedEvent: null,
    expectedEveryMinutes: 5,
  },
  {
    key: "classifier",
    label: "Conversation classifier",
    endpoint: "/internal/classifier/run",
    completedEvent: "CLASSIFIER_RUN_COMPLETED",
    failedEvent: "CLASSIFIER_RUN_FAILED",
    expectedEveryMinutes: 24 * 60,
  },
  {
    key: "fxRate",
    label: "USD to INR rate",
    endpoint: "/internal/fx/run",
    completedEvent: "FX_RATE_RUN_COMPLETED",
    failedEvent: "FX_RATE_RUN_FAILED",
    expectedEveryMinutes: 24 * 60,
  },
  {
    key: "retention",
    label: "Data retention",
    endpoint: "/internal/retention/run",
    completedEvent: "RETENTION_RUN_COMPLETED",
    failedEvent: "RETENTION_RUN_FAILED",
    expectedEveryMinutes: 24 * 60,
  },
  {
    key: "eventLogCleanup",
    label: "Event log cleanup",
    endpoint: "/internal/event-logs/cleanup",
    completedEvent: "EVENT_LOG_CLEANUP_COMPLETED",
    failedEvent: "EVENT_LOG_CLEANUP_FAILED",
    expectedEveryMinutes: 24 * 60,
  },
];

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
  /** Data extraction only: conversations past due by more than the grace period. */
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

export interface UnpricedUsage {
  windowHours: number;
  totalRecords: number;
  unpricedRecords: number;
  top: Array<{
    provider: string;
    model: string;
    count: number;
    lastSeenAt: string;
  }>;
}

export interface SystemStatus {
  generatedAt: string;
  jobs: CronJobStatus[];
  providers: { windowMinutes: number; rows: ProviderHealth[] };
  unpricedUsage: UnpricedUsage;
  readiness: ReadinessReport;
}

interface LatestEventRow {
  eventName: string;
  createdAt: Date;
  latencyMs: number | null;
  errorMessage: string | null;
}

interface EventCountRow {
  eventName: string;
  count: number;
}

interface ProviderRow {
  provider: string;
  calls: number;
  failed: number;
  p50: number | null;
  p95: number | null;
  lastFailureAt: Date | null;
}

interface UnpricedTotalsRow {
  total: number;
  unpriced: number;
}

interface UnpricedTopRow {
  provider: string;
  model: string;
  count: number;
  lastSeenAt: Date;
}

interface BacklogRow {
  waiting: number;
  oldestDueAt: Date | null;
}

/**
 * One snapshot of platform health for the ops console. Every figure is
 * aggregated in SQL (no rows pulled into Node), every query is date-bounded,
 * and all of them run in parallel: one round trip of wall time.
 */
@Injectable()
export class SystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async snapshot(now: Date = new Date()): Promise<SystemStatus> {
    const eventNames = CRON_JOBS.flatMap((j) =>
      j.failedEvent ? [j.completedEvent, j.failedEvent] : [j.completedEvent],
    );
    const since30d = new Date(now.getTime() - JOB_LOOKBACK_MS);
    const since24h = new Date(now.getTime() - 24 * HOUR_MS);
    const since1h = new Date(now.getTime() - HOUR_MS);
    const backlogCutoff = new Date(now.getTime() - EXTRACTION_BACKLOG_GRACE_MS);

    const [
      latest,
      counts,
      backlog,
      providers,
      unpricedTotals,
      unpricedTop,
      readiness,
    ] = await Promise.all([
      // Newest row per job event. LATERAL + LIMIT 1 walks the
      // (channel, createdAt) index backwards and stops at the first match.
      this.prisma.$queryRaw<LatestEventRow[]>`
        SELECT n.name AS "eventName", l."createdAt", l."latencyMs", l."errorMessage"
        FROM unnest(${eventNames}::text[]) AS n(name)
        JOIN LATERAL (
          SELECT e."createdAt", e."latencyMs", e."errorMessage"
          FROM event_logs e
          WHERE e.channel = 'INTERNAL'
            AND e."eventName" = n.name
            AND e."createdAt" >= ${since30d}
          ORDER BY e."createdAt" DESC
          LIMIT 1
        ) l ON true`,
      this.prisma.$queryRaw<EventCountRow[]>`
        SELECT "eventName", count(*)::int AS count
        FROM event_logs
        WHERE channel = 'INTERNAL'
          AND "createdAt" >= ${since24h}
          AND "eventName" = ANY(${eventNames}::text[])
        GROUP BY "eventName"`,
      this.prisma.$queryRaw<BacklogRow[]>`
        SELECT count(*)::int AS waiting, min("extractionDueAt") AS "oldestDueAt"
        FROM chat_sessions
        WHERE "extractionDueAt" <= ${backlogCutoff}`,
      this.prisma.$queryRaw<ProviderRow[]>`
        SELECT provider,
               count(*)::int AS calls,
               count(*) FILTER (WHERE NOT success)::int AS failed,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95,
               max("createdAt") FILTER (WHERE NOT success) AS "lastFailureAt"
        FROM event_logs
        WHERE "createdAt" >= ${since1h}
          AND direction = 'OUTBOUND'
          AND provider IS NOT NULL
        GROUP BY provider
        ORDER BY calls DESC`,
      this.prisma.$queryRaw<UnpricedTotalsRow[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE cost IS NULL)::int AS unpriced
        FROM usage_records
        WHERE "occurredAt" >= ${since24h}`,
      this.prisma.$queryRaw<UnpricedTopRow[]>`
        SELECT provider, model, count(*)::int AS count, max("occurredAt") AS "lastSeenAt"
        FROM usage_records
        WHERE "occurredAt" >= ${since24h} AND cost IS NULL
        GROUP BY provider, model
        ORDER BY count DESC
        LIMIT 10`,
      probeReadiness({
        prisma: this.prisma,
        redis: this.redis,
        config: this.config,
      }),
    ]);

    const latestByName = new Map(latest.map((r) => [r.eventName, r]));
    const countByName = new Map(counts.map((r) => [r.eventName, r.count]));

    return {
      generatedAt: now.toISOString(),
      jobs: CRON_JOBS.map((job) =>
        buildJobStatus(
          job,
          latestByName.get(job.completedEvent),
          job.failedEvent ? latestByName.get(job.failedEvent) : undefined,
          countByName.get(job.completedEvent) ?? 0,
          job.failedEvent ? (countByName.get(job.failedEvent) ?? 0) : 0,
          job.key === "dataExtraction" ? backlog[0] : undefined,
          now,
        ),
      ),
      providers: {
        windowMinutes: 60,
        rows: providers.map((p) => {
          const errorRate = p.calls > 0 ? p.failed / p.calls : 0;
          return {
            provider: p.provider,
            calls: p.calls,
            failed: p.failed,
            errorRate,
            p50LatencyMs: roundOrNull(p.p50),
            p95LatencyMs: roundOrNull(p.p95),
            lastFailureAt: p.lastFailureAt?.toISOString() ?? null,
            alert: errorRate > PROVIDER_ERROR_RATE_ALERT,
          };
        }),
      },
      unpricedUsage: {
        windowHours: 24,
        totalRecords: unpricedTotals[0]?.total ?? 0,
        unpricedRecords: unpricedTotals[0]?.unpriced ?? 0,
        top: unpricedTop.map((r) => ({
          provider: r.provider,
          model: r.model,
          count: r.count,
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      },
      readiness,
    };
  }
}

/** Pure: turn the newest success / failure rows into one job verdict. */
export function buildJobStatus(
  job: CronJobDefinition,
  completed: LatestEventRow | undefined,
  failed: LatestEventRow | undefined,
  runsLast24h: number,
  failuresLast24h: number,
  backlogRow: BacklogRow | undefined,
  now: Date,
): CronJobStatus {
  const lastSuccess = completed?.createdAt ?? null;
  const lastFailure = failed?.createdAt ?? null;
  const lastRun =
    lastSuccess && lastFailure
      ? lastSuccess > lastFailure
        ? lastSuccess
        : lastFailure
      : (lastSuccess ?? lastFailure);
  const failedLast = !!lastFailure && lastRun === lastFailure;
  const overdueAfterMs = 2 * job.expectedEveryMinutes * MINUTE_MS;
  const stale = !!lastRun && now.getTime() - lastRun.getTime() > overdueAfterMs;
  const backlog = backlogRow
    ? {
        waiting: backlogRow.waiting,
        oldestDueAt: backlogRow.oldestDueAt?.toISOString() ?? null,
      }
    : undefined;
  const stuck = !!backlog && backlog.waiting > 0;

  let state: CronJobState;
  if (!lastRun) state = "never";
  else if (failedLast) state = "failed";
  // Stuck work counts as overdue even when runs are recent: the job runs but
  // does not clear what is due.
  else if (stale || stuck) state = "overdue";
  else state = "ok";

  return {
    key: job.key,
    label: job.label,
    endpoint: job.endpoint,
    expectedEveryMinutes: job.expectedEveryMinutes,
    state,
    lastRunAt: lastRun?.toISOString() ?? null,
    lastSuccessAt: lastSuccess?.toISOString() ?? null,
    lastFailureAt: lastFailure?.toISOString() ?? null,
    lastError: failedLast ? truncate(failed?.errorMessage ?? null, 300) : null,
    lastLatencyMs:
      (failedLast ? failed?.latencyMs : completed?.latencyMs) ?? null,
    runsLast24h: runsLast24h + failuresLast24h,
    failuresLast24h,
    ...(backlog ? { backlog } : {}),
  };
}

function roundOrNull(n: number | null): number | null {
  return n == null ? null : Math.round(n);
}
