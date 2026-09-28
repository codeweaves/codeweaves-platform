import { Injectable, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { Prisma } from "@prisma/client";
import { AppLogger } from "../common/logger/app-logger";
import type { CurrentUserData } from "../decorators/current-user.decorator";
import type {
  AnalyticsQuery,
  AgentAnalyticsQuery,
  ExportLogBody,
} from "../models/analytics.dto";
import {
  startOfDayUtc,
  startOfNextDayUtc,
  isValidIanaTimezone,
} from "../utils/date-range";
import { isOrgScoped } from "../utils/tenant-filter";

/**
 * Outliers are detected DYNAMICALLY per metric using Tukey's interquartile
 * (IQR) rule, not a fixed millisecond cutoff. A latency counts as an outlier
 * when it sits above the upper fence `Q3 + IQR_MULTIPLIER * (Q3 - Q1)` of that
 * metric's own distribution, so the threshold adapts to scale: a lone 35s reply
 * is excluded when the cluster sits at 15s, but a steadily-slow RAG agent (all
 * replies 11-18s) keeps all of them. Outliers are removed from AVERAGES only —
 * percentiles (p50/p95/p99) and the distribution chart still include the full
 * tail so it stays visible.
 */
const IQR_MULTIPLIER = 1.5;

/**
 * Resolved date range used for SQL queries.
 * - `startUtc` (inclusive) and `endUtc` (exclusive) are the UTC interval that
 *   covers the user's local-day range in `timezone`.
 * - `prevStartUtc` / `prevEndUtc` are the equivalent interval for the
 *   immediately-preceding period (same UTC duration), used for trend deltas.
 */
interface ResolvedRange {
  startUtc: Date;
  endUtc: Date;
  prevStartUtc: Date;
  prevEndUtc: Date;
  timezone: string;
}

/**
 * The channel (source) filter as one SQL fragment per table. `message` expects
 * the chat_messages alias `cm` and `metric` the chat_message_metrics alias `mm`.
 */
interface SourceFilter {
  session: Prisma.Sql;
  message: Prisma.Sql;
  metric: Prisma.Sql;
}

const NO_SOURCE_FILTER: SourceFilter = {
  session: Prisma.empty,
  message: Prisma.empty,
  metric: Prisma.empty,
};

@Injectable()
export class AnalyticsService {
  private readonly log = new AppLogger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the channel filter. Supports both single `source` and multi-select
   * `sources`. When nothing is specified, includes all sources (no filter).
   *
   * Messages and metrics carry a copy of their session's `source` as `sessionSource` (ADR-0007),
   * so a channel filter never joins them to chat_sessions.
   */
  private getSourceFilter(source?: string, sources?: string[]): SourceFilter {
    const list = [...(source ? [source] : []), ...(sources ?? [])].filter(
      (s): s is "WIDGET" | "WHATSAPP" | "DEMO" =>
        s === "WIDGET" || s === "WHATSAPP" || s === "DEMO",
    );
    if (list.length === 0) {
      // No filter — include all sources (WIDGET + WHATSAPP + DEMO)
      return NO_SOURCE_FILTER;
    }
    return {
      session: Prisma.sql`AND "source"::text = ANY(${list}::text[])`,
      message: Prisma.sql`AND cm."sessionSource"::text = ANY(${list}::text[])`,
      metric: Prisma.sql`AND mm."sessionSource"::text = ANY(${list}::text[])`,
    };
  }

  /**
   * Build agent IDs scoped to user's role and query filters.
   * CLIENT users only see their own org. ADMIN/SUPER_ADMIN see all (or filter by orgId).
   */
  private async getAgentIds(
    query: {
      agentId?: string;
      agentIds?: string[];
      orgId?: string;
      orgIds?: string[];
    },
    user: CurrentUserData,
  ): Promise<string[]> {
    if (isOrgScoped(user) && !user.organizationId) {
      throw new ForbiddenException(
        "Client user must be associated with an organization",
      );
    }

    // Combine single + array forms for backward compat
    const agentIdList = [
      ...(query.agentId ? [query.agentId] : []),
      ...(query.agentIds ?? []),
    ];
    const orgIdList = [
      ...(query.orgId ? [query.orgId] : []),
      ...(query.orgIds ?? []),
    ];

    const agentFilter: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(isOrgScoped(user) && { organizationId: user.organizationId! }),
      ...(!isOrgScoped(user) &&
        orgIdList.length > 0 && {
          organizationId: { in: orgIdList },
        }),
      ...(agentIdList.length > 0 && { id: { in: agentIdList } }),
    };

    const agents = await this.prisma.agent.findMany({
      where: agentFilter,
      select: { id: true },
    });

    return agents.map((a) => a.id);
  }

  /**
   * Resolve `{ startDate, endDate, timezone }` query params to UTC instants
   * using IANA tzdata. The end bound is `start of next day in tz` (exclusive)
   * so SQL `< endUtc` includes events on the user's local end-day.
   *
   * Falls back to UTC if the supplied timezone isn't a known IANA name —
   * keeps existing single-tz callers working and prevents `EST`/`GMT`
   * abbreviation footguns from leaking past the validation layer.
   */
  private resolveRange(query: {
    startDate: string;
    endDate: string;
    timezone?: string;
  }): ResolvedRange {
    const tz = isValidIanaTimezone(query.timezone) ? query.timezone : "UTC";
    const startUtc = startOfDayUtc(query.startDate, tz);
    const endUtc = startOfNextDayUtc(query.endDate, tz);
    // Previous period: equal UTC duration, ending right before startUtc.
    // Minimum 1-day duration avoids a zero-length window when startDate === endDate.
    const durationMs = Math.max(
      endUtc.getTime() - startUtc.getTime(),
      86_400_000,
    );
    const prevEndUtc = new Date(startUtc.getTime());
    const prevStartUtc = new Date(prevEndUtc.getTime() - durationMs);
    return { startUtc, endUtc, prevStartUtc, prevEndUtc, timezone: tz };
  }

  /**
   * Build a SQL fragment for an IANA timezone string literal, suitable for
   * embedding in `AT TIME ZONE` expressions. Postgres treats parameterized
   * `AT TIME ZONE $n` as different expressions in SELECT vs GROUP BY at
   * parse time (even when the runtime values match), which causes
   * "must appear in GROUP BY clause" errors. Injecting as a SQL literal
   * sidesteps that — safe because the timezone passes `isValidIanaTimezone`
   * before reaching here.
   */
  private tzLiteral(timezone: string): Prisma.Sql {
    if (!isValidIanaTimezone(timezone)) {
      throw new Error(
        `Refusing to inject non-IANA timezone literal: ${timezone}`,
      );
    }
    return Prisma.raw(`'${timezone}'`);
  }

  /**
   * Calculate trend as percentage change between current and previous values.
   */
  private calcTrend(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }

  /**
   * Get session-level metrics for a given period and agent set.
   * Uses SQL aggregation instead of loading all sessions into memory.
   */
  private async getSessionMetrics(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql = Prisma.empty,
  ) {
    if (agentIds.length === 0) {
      return {
        totalConversations: 0,
        totalUsers: 0,
        newUsers: 0,
        returningUsers: 0,
      };
    }

    // DEMO sessions are excluded from visitor-based metrics (new/returning users)
    // because they represent the agent owner testing their own widget.
    const result = await this.prisma.$queryRaw<
      {
        total_conversations: bigint;
        total_users: bigint;
        returning_users: bigint;
      }[]
    >`
      SELECT
        COUNT(*) as total_conversations,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "visitorId" IS NOT NULL AND "source"::text != 'DEMO') as total_users,
        COUNT(DISTINCT "visitorId") FILTER (
          WHERE "visitorId" IS NOT NULL
          AND "source"::text != 'DEMO'
          AND "visitorId" IN (
            SELECT DISTINCT "visitorId" FROM chat_sessions
            WHERE "agentId" = ANY(${agentIds}::text[])
              AND "createdAt" < ${startUtc}
              AND "visitorId" IS NOT NULL
              AND "source"::text != 'DEMO'
              ${sourceFilter}
          )
        ) as returning_users
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        ${sourceFilter}
    `;

    const row = result[0];
    const totalConversations = Number(row?.total_conversations ?? 0);
    const totalUsers = Number(row?.total_users ?? 0);
    const returningUsers = Number(row?.returning_users ?? 0);
    const newUsers = totalUsers - returningUsers;

    return { totalConversations, totalUsers, newUsers, returningUsers };
  }

  /**
   * Get message-level metrics for a given period and agent set.
   * One range scan of chat_messages (agentId, createdAt).
   */
  private async getMessageMetrics(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql = Prisma.empty,
  ) {
    if (agentIds.length === 0) {
      return { totalMessagesSent: 0, totalMessagesReceived: 0 };
    }

    const result = await this.prisma.$queryRaw<
      { user_count: bigint; assistant_count: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE cm.role = 'USER') as user_count,
        COUNT(*) FILTER (WHERE cm.role = 'ASSISTANT') as assistant_count
      FROM chat_messages cm
      WHERE cm."agentId" = ANY(${agentIds}::text[])
        AND cm."createdAt" >= ${startUtc}
        AND cm."createdAt" < ${endUtc}
        ${sourceFilter}
    `;

    const row = result[0];
    return {
      totalMessagesSent: Number(row?.user_count ?? 0),
      totalMessagesReceived: Number(row?.assistant_count ?? 0),
    };
  }

  /**
   * Calculate response time metrics using raw SQL for JSONB aggregation.
   */
  private async getResponseTimeMetrics(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql = Prisma.empty,
  ): Promise<{
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    avgTimeToFirstToken: number | null;
  }> {
    if (agentIds.length === 0) {
      return { avg: 0, p50: 0, p95: 0, p99: 0, avgTimeToFirstToken: null };
    }

    const result = await this.prisma.$queryRaw<
      {
        avg_ms: number | null;
        p50: number | null;
        p95: number | null;
        p99: number | null;
        avg_ttft: number | null;
      }[]
    >`
      WITH msgs AS (
        SELECT mm."responseLatencyMs" AS latency, mm."timeToFirstTokenMs" AS ttft
        FROM chat_message_metrics mm
        WHERE mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sourceFilter}
      ),
      resp_fence AS (
        SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY latency) AS q1,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY latency) AS q3
        FROM msgs
      ),
      ttft_fence AS (
        SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ttft) AS q1,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ttft) AS q3
        FROM msgs WHERE ttft IS NOT NULL
      )
      SELECT
        (SELECT AVG(latency) FROM msgs, resp_fence
           WHERE latency <= resp_fence.q3 + ${IQR_MULTIPLIER} * (resp_fence.q3 - resp_fence.q1)) as avg_ms,
        (SELECT PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency) FROM msgs) as p50,
        (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency) FROM msgs) as p95,
        (SELECT PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency) FROM msgs) as p99,
        (SELECT AVG(ttft) FROM msgs, ttft_fence
           WHERE ttft IS NOT NULL
             AND ttft <= ttft_fence.q3 + ${IQR_MULTIPLIER} * (ttft_fence.q3 - ttft_fence.q1)) as avg_ttft
    `;

    const row = result[0];
    return {
      avg: Math.round(Number(row?.avg_ms ?? 0)),
      p50: Math.round(Number(row?.p50 ?? 0)),
      p95: Math.round(Number(row?.p95 ?? 0)),
      p99: Math.round(Number(row?.p99 ?? 0)),
      avgTimeToFirstToken:
        row?.avg_ttft != null ? Math.round(Number(row.avg_ttft)) : null,
    };
  }

  /**
   * Share of assistant replies flagged "couldn't answer" (fuzzy-matched to the
   * agent's fallback phrases), as a percentage. Denominator counts only replies
   * from agents that HAVE phrases configured (couldntAnswer IS NOT NULL), so
   * untracked agents don't dilute the rate.
   */
  private async getCouldntAnswerRate(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql = Prisma.empty,
  ): Promise<number> {
    if (agentIds.length === 0) return 0;
    const result = await this.prisma.$queryRaw<
      { flagged: bigint; tracked: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE mm."couldntAnswer" = true) as flagged,
        COUNT(*) FILTER (WHERE mm."couldntAnswer" IS NOT NULL) as tracked
      FROM chat_message_metrics mm
      WHERE mm."agentId" = ANY(${agentIds}::text[])
        AND mm."createdAt" >= ${startUtc}
        AND mm."createdAt" < ${endUtc}
        ${sourceFilter}
    `;
    const row = result[0];
    const tracked = Number(row?.tracked ?? 0);
    const flagged = Number(row?.flagged ?? 0);
    return tracked > 0 ? Math.round((flagged / tracked) * 10000) / 100 : 0;
  }

  /**
   * True when at least one of the in-scope agents currently has fallback
   * phrases configured. Drives whether the dashboard shows the "Fallback Rate"
   * card — config-based, so removing all phrases hides the card immediately
   * regardless of historical data still sitting in the date range.
   */
  private async hasFallbackPhrases(agentIds: string[]): Promise<boolean> {
    if (agentIds.length === 0) return false;
    const agent = await this.prisma.agent.findFirst({
      where: { id: { in: agentIds }, fallbackPhrases: { isEmpty: false } },
      select: { id: true },
    });
    return agent !== null;
  }

  // ==========================================
  // Public API Methods
  // ==========================================

  async getSummary(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    this.log.debug("getSummary", "computing analytics summary", {
      role: user.role,
      agentCount: agentIds.length,
    });
    const { startUtc, endUtc, prevStartUtc, prevEndUtc } =
      this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    const [
      sessions,
      messages,
      responseTime,
      prevSessions,
      prevMessages,
      prevResponseTime,
      couldntAnswerRate,
      prevCouldntAnswerRate,
      fallbackConfigured,
    ] = await Promise.all([
      this.getSessionMetrics(agentIds, startUtc, endUtc, sf.session),
      this.getMessageMetrics(agentIds, startUtc, endUtc, sf.message),
      this.getResponseTimeMetrics(agentIds, startUtc, endUtc, sf.metric),
      this.getSessionMetrics(agentIds, prevStartUtc, prevEndUtc, sf.session),
      this.getMessageMetrics(agentIds, prevStartUtc, prevEndUtc, sf.message),
      this.getResponseTimeMetrics(
        agentIds,
        prevStartUtc,
        prevEndUtc,
        sf.metric,
      ),
      this.getCouldntAnswerRate(agentIds, startUtc, endUtc, sf.metric),
      this.getCouldntAnswerRate(agentIds, prevStartUtc, prevEndUtc, sf.metric),
      this.hasFallbackPhrases(agentIds),
    ]);

    // Retention = share of this period's users who had ALSO engaged before the
    // period started (returningUsers / totalUsers). This is period-scoped and
    // derived from data we already fetched. The previous implementation flagged
    // visitors whose first/last session were >60 days apart while ignoring the
    // selected date range entirely, so it neither matched its label nor the
    // active filter.
    const retentionRate =
      sessions.totalUsers > 0
        ? Math.round((sessions.returningUsers / sessions.totalUsers) * 10000) /
          100
        : 0;
    const prevRetentionRate =
      prevSessions.totalUsers > 0
        ? Math.round(
            (prevSessions.returningUsers / prevSessions.totalUsers) * 10000,
          ) / 100
        : 0;

    const userGrowthRate =
      prevSessions.newUsers === 0
        ? sessions.newUsers > 0
          ? 100
          : 0
        : Math.round(
            ((sessions.newUsers - prevSessions.newUsers) /
              prevSessions.newUsers) *
              10000,
          ) / 100;

    const totalExchanged =
      messages.totalMessagesSent + messages.totalMessagesReceived;
    const prevTotalExchanged =
      prevMessages.totalMessagesSent + prevMessages.totalMessagesReceived;

    return {
      period: { start: startUtc.toISOString(), end: endUtc.toISOString() },
      fallbackConfigured,
      kpis: {
        totalUsers: {
          value: sessions.totalUsers,
          trend: this.calcTrend(sessions.totalUsers, prevSessions.totalUsers),
        },
        newUsers: {
          value: sessions.newUsers,
          trend: this.calcTrend(sessions.newUsers, prevSessions.newUsers),
        },
        returningUsers: {
          value: sessions.returningUsers,
          trend: this.calcTrend(
            sessions.returningUsers,
            prevSessions.returningUsers,
          ),
        },
        totalConversations: {
          value: sessions.totalConversations,
          trend: this.calcTrend(
            sessions.totalConversations,
            prevSessions.totalConversations,
          ),
        },
        totalMessagesSent: {
          value: messages.totalMessagesSent,
          trend: this.calcTrend(
            messages.totalMessagesSent,
            prevMessages.totalMessagesSent,
          ),
        },
        totalMessagesReceived: {
          value: messages.totalMessagesReceived,
          trend: this.calcTrend(
            messages.totalMessagesReceived,
            prevMessages.totalMessagesReceived,
          ),
        },
        totalMessagesExchanged: {
          value: totalExchanged,
          trend: this.calcTrend(totalExchanged, prevTotalExchanged),
        },
        userRetentionRate: {
          value: retentionRate,
          trend: this.calcTrend(retentionRate, prevRetentionRate),
        },
        userGrowthRate: { value: userGrowthRate, trend: 0 },
        avgResponseTimeMs: {
          value: responseTime.avg,
          trend: this.calcTrend(responseTime.avg, prevResponseTime.avg),
        },
        p50ResponseTimeMs: { value: responseTime.p50 },
        p95ResponseTimeMs: { value: responseTime.p95 },
        p99ResponseTimeMs: { value: responseTime.p99 },
        avgTimeToFirstTokenMs: {
          value: responseTime.avgTimeToFirstToken,
          trend:
            responseTime.avgTimeToFirstToken != null &&
            prevResponseTime.avgTimeToFirstToken != null
              ? this.calcTrend(
                  responseTime.avgTimeToFirstToken,
                  prevResponseTime.avgTimeToFirstToken,
                )
              : null,
        },
        couldntAnswerRate: {
          value: couldntAnswerRate,
          trend: this.calcTrend(couldntAnswerRate, prevCouldntAnswerRate),
        },
      },
    };
  }

  /** Raw handover aggregation for one window (shared by current + previous). */
  private async getHandoverAgg(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql,
  ) {
    // handover_events has no source column, so the channel filter joins through
    // the session — the same filter every other analytics method applies.
    const rows = await this.prisma.$queryRaw<
      {
        total: bigint;
        taken_over: bigint;
        resolved_human: bigint;
        auto_resolved: bigint;
        abandoned: bigint;
        swept_after_takeover: bigint;
        r_user: bigint;
        r_fallback: bigint;
        r_frustration: bigint;
        r_manual: bigint;
        avg_wait_ms: number | null;
        avg_handle_ms: number | null;
      }[]
    >`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE he."startedAt" IS NOT NULL) AS taken_over,
        COUNT(*) FILTER (WHERE he.resolution = 'HUMAN') AS resolved_human,
        COUNT(*) FILTER (WHERE he.resolution = 'AUTO_INACTIVE') AS auto_resolved,
        COUNT(*) FILTER (WHERE he.resolution = 'AUTO_INACTIVE' AND he."startedAt" IS NULL) AS abandoned,
        COUNT(*) FILTER (WHERE he.resolution = 'AUTO_INACTIVE' AND he."startedAt" IS NOT NULL) AS swept_after_takeover,
        COUNT(*) FILTER (WHERE he.reason = 'USER_REQUESTED') AS r_user,
        COUNT(*) FILTER (WHERE he.reason = 'BOT_FALLBACK') AS r_fallback,
        COUNT(*) FILTER (WHERE he.reason = 'FRUSTRATION') AS r_frustration,
        COUNT(*) FILTER (WHERE he.reason = 'MANUAL') AS r_manual,
        AVG(EXTRACT(EPOCH FROM (he."startedAt" - he."requestedAt")) * 1000)
          FILTER (WHERE he."startedAt" IS NOT NULL) AS avg_wait_ms,
        AVG(EXTRACT(EPOCH FROM (he."resolvedAt" - he."startedAt")) * 1000)
          FILTER (WHERE he."startedAt" IS NOT NULL AND he."resolvedAt" IS NOT NULL) AS avg_handle_ms
      FROM handover_events he
      JOIN chat_sessions cs ON cs."id" = he."chatSessionId"
      WHERE he."agentId" = ANY(${agentIds}::text[])
        AND he."requestedAt" >= ${startUtc}
        AND he."requestedAt" < ${endUtc}
        ${sourceFilter}
    `;
    const row = rows[0];
    const ms = (v: number | null | undefined) =>
      v == null ? null : Math.round(Number(v));
    return {
      total: Number(row?.total ?? 0),
      takenOver: Number(row?.taken_over ?? 0),
      resolvedByHuman: Number(row?.resolved_human ?? 0),
      autoResolved: Number(row?.auto_resolved ?? 0),
      abandoned: Number(row?.abandoned ?? 0),
      sweptAfterTakeover: Number(row?.swept_after_takeover ?? 0),
      avgWaitMs: ms(row?.avg_wait_ms),
      avgHandleMs: ms(row?.avg_handle_ms),
      reasonCounts: {
        USER_REQUESTED: Number(row?.r_user ?? 0),
        BOT_FALLBACK: Number(row?.r_fallback ?? 0),
        FRUSTRATION: Number(row?.r_frustration ?? 0),
        MANUAL: Number(row?.r_manual ?? 0),
      },
    };
  }

  /**
   * Human-handover metrics for the period, plus a trend vs the previous period
   * for each headline number (like getSummary). Read from the append-only
   * handover_events log; all aggregation runs in SQL.
   */
  async getHandoverMetrics(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, prevStartUtc, prevEndUtc } =
      this.resolveRange(query);

    const empty = {
      period: { start: startUtc.toISOString(), end: endUtc.toISOString() },
      totalHandovers: 0,
      totalHandoversTrend: 0,
      totalConversations: 0,
      handoverRate: 0,
      handoverRateTrend: 0,
      takenOver: 0,
      takenOverTrend: 0,
      takenOverRate: 0,
      resolvedByHuman: 0,
      resolvedByHumanTrend: 0,
      autoResolved: 0,
      abandoned: 0,
      sweptAfterTakeover: 0,
      avgWaitMs: null as number | null,
      avgWaitTrend: null as number | null,
      avgHandleMs: null as number | null,
      avgHandleTrend: null as number | null,
      reasons: [] as { reason: string; count: number; percentage: number }[],
    };
    if (agentIds.length === 0) return empty;

    const sf = this.getSourceFilter(query.source, query.sources);
    const [cur, prev, sessions, prevSessions] = await Promise.all([
      this.getHandoverAgg(agentIds, startUtc, endUtc, sf.session),
      this.getHandoverAgg(agentIds, prevStartUtc, prevEndUtc, sf.session),
      this.getSessionMetrics(agentIds, startUtc, endUtc, sf.session),
      this.getSessionMetrics(agentIds, prevStartUtc, prevEndUtc, sf.session),
    ]);

    const pct = (n: number, d: number) =>
      d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
    const trendNullable = (a: number | null, b: number | null) =>
      a != null && b != null ? this.calcTrend(a, b) : null;

    const handoverRate = pct(cur.total, sessions.totalConversations);
    const prevHandoverRate = pct(prev.total, prevSessions.totalConversations);

    const reasons = [
      { reason: "USER_REQUESTED", count: cur.reasonCounts.USER_REQUESTED },
      { reason: "BOT_FALLBACK", count: cur.reasonCounts.BOT_FALLBACK },
      { reason: "FRUSTRATION", count: cur.reasonCounts.FRUSTRATION },
      { reason: "MANUAL", count: cur.reasonCounts.MANUAL },
    ]
      .filter((r) => r.count > 0)
      .map((r) => ({ ...r, percentage: pct(r.count, cur.total) }));

    return {
      period: { start: startUtc.toISOString(), end: endUtc.toISOString() },
      totalHandovers: cur.total,
      totalHandoversTrend: this.calcTrend(cur.total, prev.total),
      totalConversations: sessions.totalConversations,
      handoverRate,
      handoverRateTrend: this.calcTrend(handoverRate, prevHandoverRate),
      takenOver: cur.takenOver,
      takenOverTrend: this.calcTrend(cur.takenOver, prev.takenOver),
      takenOverRate: pct(cur.takenOver, cur.total),
      resolvedByHuman: cur.resolvedByHuman,
      resolvedByHumanTrend: this.calcTrend(
        cur.resolvedByHuman,
        prev.resolvedByHuman,
      ),
      autoResolved: cur.autoResolved,
      abandoned: cur.abandoned,
      sweptAfterTakeover: cur.sweptAfterTakeover,
      avgWaitMs: cur.avgWaitMs,
      avgWaitTrend: trendNullable(cur.avgWaitMs, prev.avgWaitMs),
      avgHandleMs: cur.avgHandleMs,
      avgHandleTrend: trendNullable(cur.avgHandleMs, prev.avgHandleMs),
      reasons,
    };
  }

  private async countLeads(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: Prisma.Sql,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM collected_data cd
      JOIN chat_sessions cs ON cs."id" = cd."chatSessionId"
      WHERE cd."agentId" = ANY(${agentIds}::text[])
        AND cd."extractedAt" >= ${startUtc}
        AND cd."extractedAt" < ${endUtc}
        ${sourceFilter}
    `;
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Org-wide leads captured (collected_data rows) in the period + trend vs the
   * previous period. Count only — never returns lead contents (PII). Aggregated
   * in SQL, scoped by agent + the shared channel filter.
   */
  async getLeadsCaptured(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, prevStartUtc, prevEndUtc } =
      this.resolveRange(query);
    const period = { start: startUtc.toISOString(), end: endUtc.toISOString() };
    if (agentIds.length === 0)
      return { period, totalLeads: 0, totalLeadsTrend: 0 };

    const sf = this.getSourceFilter(query.source, query.sources);
    const [cur, prev] = await Promise.all([
      this.countLeads(agentIds, startUtc, endUtc, sf.session),
      this.countLeads(agentIds, prevStartUtc, prevEndUtc, sf.session),
    ]);
    return {
      period,
      totalLeads: cur,
      totalLeadsTrend: this.calcTrend(cur, prev),
    };
  }

  async getConversationsChart(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, timezone } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) return { data: [] };

    // Bucket by day in the user's timezone, not UTC. The double AT TIME ZONE
    // converts naive UTC `createdAt` → tz-aware → naive local time, which
    // DATE() then truncates against the local-day boundary. The raw
    // `createdAt >= startUtc AND < endUtc` filter is kept in addition to
    // the bucket expression so the index on createdAt is still used.
    //
    // `tzSql` is injected as a SQL literal (not a bind parameter) because
    // Postgres doesn't recognize parameterized `AT TIME ZONE $n` expressions
    // as equivalent across SELECT/GROUP BY at parse time. The IANA-name
    // validation in resolveRange() makes this safe from injection.
    const tzSql = this.tzLiteral(timezone);
    const result = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT DATE("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql}) as date,
             COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        ${sf.session}
      GROUP BY DATE("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql})
      ORDER BY date ASC
    `;

    return {
      data: result.map((r) => ({
        date:
          r.date instanceof Date
            ? r.date.toISOString().split("T")[0]
            : String(r.date),
        count: Number(r.count),
      })),
    };
  }

  /**
   * Conversations grouped by day of the week (0=Sun … 6=Sat) in the user's
   * timezone, summed across the whole selected period. Answers "which weekday
   * is busiest?" — complements the hour heatmap. Always returns all 7 days so
   * the chart has a stable shape; missing days come back as 0.
   */
  async getConversationsByWeekday(
    query: AnalyticsQuery,
    user: CurrentUserData,
  ) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, timezone } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    const allDays = Array.from({ length: 7 }, (_, day) => ({ day, count: 0 }));
    if (agentIds.length === 0) return { data: allDays };

    // Same double AT TIME ZONE trick as getConversationsChart: naive UTC →
    // tz-aware → naive local, so DOW is bucketed against the local-day boundary.
    const tzSql = this.tzLiteral(timezone);
    const result = await this.prisma.$queryRaw<
      { dow: number; count: bigint }[]
    >`
      SELECT EXTRACT(DOW FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql})::int as dow,
             COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        ${sf.session}
      GROUP BY dow
      ORDER BY dow ASC
    `;

    const counts = new Map(result.map((r) => [Number(r.dow), Number(r.count)]));
    return {
      data: allDays.map(({ day }) => ({ day, count: counts.get(day) ?? 0 })),
    };
  }

  async getResponseTimeDistribution(
    query: AnalyticsQuery,
    user: CurrentUserData,
  ) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    const emptyBuckets = [
      { label: "<1s", min: 0, max: 1000, count: 0, percentage: 0 },
      { label: "1-2s", min: 1000, max: 2000, count: 0, percentage: 0 },
      { label: "2-5s", min: 2000, max: 5000, count: 0, percentage: 0 },
      { label: "5-10s", min: 5000, max: 10000, count: 0, percentage: 0 },
      { label: ">10s", min: 10000, max: null, count: 0, percentage: 0 },
    ];

    if (agentIds.length === 0) {
      return { buckets: emptyBuckets, percentiles: { p50: 0, p95: 0, p99: 0 } };
    }

    // Single query for both buckets and percentiles
    const result = await this.prisma.$queryRaw<
      {
        bucket: string;
        count: bigint;
        p50: number | null;
        p95: number | null;
        p99: number | null;
      }[]
    >`
      WITH filtered AS (
        SELECT mm."responseLatencyMs" as latency
        FROM chat_message_metrics mm
        WHERE mm."agentId" = ANY(${agentIds}::text[])
          AND mm."responseLatencyMs" IS NOT NULL
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sf.metric}
      ),
      percentiles AS (
        SELECT
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency) as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency) as p95,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency) as p99
        FROM filtered
      )
      SELECT
        CASE
          WHEN f.latency < 1000 THEN 'lt1s'
          WHEN f.latency < 2000 THEN '1to2s'
          WHEN f.latency < 5000 THEN '2to5s'
          WHEN f.latency < 10000 THEN '5to10s'
          ELSE 'gt10s'
        END as bucket,
        COUNT(*) as count,
        (SELECT p50 FROM percentiles) as p50,
        (SELECT p95 FROM percentiles) as p95,
        (SELECT p99 FROM percentiles) as p99
      FROM filtered f
      GROUP BY bucket
    `;

    const bucketMap: Record<string, number> = {};
    let p50 = 0,
      p95 = 0,
      p99 = 0;
    for (const r of result) {
      bucketMap[r.bucket] = Number(r.count);
      // Percentile values are the same across all rows
      p50 = Math.round(Number(r.p50 ?? 0));
      p95 = Math.round(Number(r.p95 ?? 0));
      p99 = Math.round(Number(r.p99 ?? 0));
    }

    const total = Object.values(bucketMap).reduce((a, b) => a + b, 0);

    const buckets = [
      {
        label: "<1s",
        min: 0,
        max: 1000,
        count: bucketMap["lt1s"] ?? 0,
        percentage: 0,
      },
      {
        label: "1-2s",
        min: 1000,
        max: 2000,
        count: bucketMap["1to2s"] ?? 0,
        percentage: 0,
      },
      {
        label: "2-5s",
        min: 2000,
        max: 5000,
        count: bucketMap["2to5s"] ?? 0,
        percentage: 0,
      },
      {
        label: "5-10s",
        min: 5000,
        max: 10000,
        count: bucketMap["5to10s"] ?? 0,
        percentage: 0,
      },
      {
        label: ">10s" as const,
        min: 10000,
        max: null as number | null,
        count: bucketMap["gt10s"] ?? 0,
        percentage: 0,
      },
    ].map((b) => ({
      ...b,
      percentage: total > 0 ? Math.round((b.count / total) * 10000) / 100 : 0,
    }));

    return {
      buckets,
      percentiles: { p50, p95, p99 },
    };
  }

  async getMessageVolumeHeatmap(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, timezone } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) return { data: [] };

    // Bucket day-of-week and hour in the user's timezone — a 9 PM IST event
    // should land in the IST 21:00 bucket on Tuesday, not the UTC 15:30
    // bucket on Tuesday. The `cm.createdAt` range (indexed) drives selection —
    // a message lands in the period it was SENT, not when its session began.
    // tzSql is injected as a SQL literal (see getConversationsChart for the
    // reason). IANA validation in resolveRange() makes this injection-safe.
    const tzSql = this.tzLiteral(timezone);
    const result = await this.prisma.$queryRaw<
      { day: number; hour: number; count: bigint }[]
    >`
      SELECT
        EXTRACT(DOW FROM cm."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql}) as day,
        EXTRACT(HOUR FROM cm."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql}) as hour,
        COUNT(*) as count
      FROM chat_messages cm
      WHERE cm."agentId" = ANY(${agentIds}::text[])
        AND cm."createdAt" >= ${startUtc}
        AND cm."createdAt" < ${endUtc}
        ${sf.message}
      GROUP BY day, hour
      ORDER BY day, hour
    `;

    return {
      data: result.map((r) => ({
        day: Number(r.day),
        hour: Number(r.hour),
        count: Number(r.count),
      })),
    };
  }

  async getAgentMetrics(query: AgentAnalyticsQuery, user: CurrentUserData) {
    const {
      page = 1,
      limit = 20,
      sortBy = "conversations",
      sortOrder = "desc",
    } = query;
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    const offset = (page - 1) * limit;

    const sortColSql =
      sortBy === "agentName"
        ? "agent_name"
        : sortBy === "avgResponseTimeMs"
          ? "avg_response_time_ms"
          : sortBy === "queriesRaised"
            ? "queries_raised"
            : sortBy;

    // Order by the SELECT output-column alias. Postgres resolves these to the
    // aggregate expressions below (including the IQR-trimmed average), so we
    // don't repeat them. `sortColSql` is a fixed whitelist and `dir` is a fixed
    // literal, so this stays injection-safe.
    const dir = sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    let orderByClause: ReturnType<typeof Prisma.sql>;
    switch (sortColSql) {
      case "agent_name":
        orderByClause = Prisma.sql`ORDER BY agent_name ${dir} NULLS LAST`;
        break;
      case "messages":
        orderByClause = Prisma.sql`ORDER BY messages ${dir} NULLS LAST`;
        break;
      case "avg_response_time_ms":
        orderByClause = Prisma.sql`ORDER BY avg_response_time_ms ${dir} NULLS LAST`;
        break;
      case "queries_raised":
        orderByClause = Prisma.sql`ORDER BY queries_raised ${dir} NULLS LAST`;
        break;
      default: // conversations
        orderByClause = Prisma.sql`ORDER BY conversations ${dir} NULLS LAST`;
        break;
    }

    // Each measure is aggregated on its own table's (agentId, createdAt) index
    // and joined per agent, instead of joining every session to every message
    // (ADR-0007). An agent is listed when it had a conversation start in the
    // period. Messages, questions and latency count by the time each message
    // was sent, the same time rule as the summary cards.
    const [countResult, data] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(DISTINCT "agentId") as total
        FROM chat_sessions
        WHERE "agentId" = ANY(${agentIds}::text[])
          AND "createdAt" >= ${startUtc}
          AND "createdAt" < ${endUtc}
          ${sf.session}
      `,
      this.prisma.$queryRaw<
        {
          agent_id: string;
          agent_name: string;
          conversations: bigint;
          messages: bigint;
          avg_response_time_ms: number | null;
          queries_raised: bigint;
        }[]
      >`
        WITH conv AS (
          SELECT "agentId" AS agent_id, COUNT(*) AS conversations
          FROM chat_sessions
          WHERE "agentId" = ANY(${agentIds}::text[])
            AND "createdAt" >= ${startUtc}
            AND "createdAt" < ${endUtc}
            ${sf.session}
          GROUP BY "agentId"
        ),
        msgs AS (
          SELECT cm."agentId" AS agent_id,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE cm.role = 'USER') AS queries_raised
          FROM chat_messages cm
          WHERE cm."agentId" = ANY(${agentIds}::text[])
            AND cm."createdAt" >= ${startUtc}
            AND cm."createdAt" < ${endUtc}
            ${sf.message}
          GROUP BY cm."agentId"
        ),
        latencies AS (
          SELECT mm."agentId" AS agent_id, mm."responseLatencyMs" AS latency
          FROM chat_message_metrics mm
          WHERE mm."agentId" = ANY(${agentIds}::text[])
            AND mm."createdAt" >= ${startUtc}
            AND mm."createdAt" < ${endUtc}
            AND mm."responseLatencyMs" IS NOT NULL
            ${sf.metric}
        ),
        fences AS (
          SELECT agent_id,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY latency) AS q1,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY latency) AS q3
          FROM latencies
          GROUP BY agent_id
        ),
        trimmed AS (
          SELECT l.agent_id, AVG(l.latency) AS avg_response_time_ms
          FROM latencies l
          JOIN fences f ON f.agent_id = l.agent_id
          WHERE l.latency <= f.q3 + ${IQR_MULTIPLIER} * (f.q3 - f.q1)
          GROUP BY l.agent_id
        )
        SELECT
          c.agent_id,
          a.name AS agent_name,
          c.conversations,
          COALESCE(m.messages, 0) AS messages,
          t.avg_response_time_ms,
          COALESCE(m.queries_raised, 0) AS queries_raised
        FROM conv c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN msgs m ON m.agent_id = c.agent_id
        LEFT JOIN trimmed t ON t.agent_id = c.agent_id
        ${orderByClause}
        LIMIT ${limit}
        OFFSET ${offset}
      `,
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((d) => ({
        agentId: d.agent_id,
        agentName: d.agent_name,
        conversations: Number(d.conversations),
        messages: Number(d.messages),
        avgResponseTimeMs: Math.round(Number(d.avg_response_time_ms ?? 0)),
        queriesRaised: Number(d.queries_raised),
      })),
      meta: { page, limit, total, totalPages },
    };
  }

  // ==========================================
  // Conversation Classification & Channel Analytics
  // ==========================================

  /**
   * Distribution of conversations across the AI-classifier categories
   * (`chat_sessions.category`). Percentages are computed over *classified*
   * sessions only; the count of still-unclassified sessions is returned
   * separately so the UI can be honest about coverage rather than skewing
   * the breakdown.
   */
  async getConversationCategories(
    query: AnalyticsQuery,
    user: CurrentUserData,
  ) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { categories: [], uncategorized: 0 };
    }

    const result = await this.prisma.$queryRaw<
      { category: string | null; count: bigint }[]
    >`
      SELECT "category", COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        ${sf.session}
      GROUP BY "category"
      ORDER BY count DESC
    `;

    let uncategorized = 0;
    const named: { category: string; count: number }[] = [];
    for (const r of result) {
      const count = Number(r.count);
      if (r.category === null) {
        uncategorized += count;
      } else {
        named.push({ category: r.category, count });
      }
    }

    const total = named.reduce((sum, c) => sum + c.count, 0);
    return {
      categories: named.map((c) => ({
        category: c.category,
        count: c.count,
        percentage: total > 0 ? Math.round((c.count / total) * 10000) / 100 : 0,
      })),
      uncategorized,
    };
  }

  /**
   * Distribution of conversations across the classifier-detected language
   * (`chat_sessions.detectedLanguage`). Covers ALL conversations (text +
   * voice) — distinct from `getLanguageDistribution`, which reads the
   * per-message voice STT language and only counts voice turns.
   */
  async getConversationLanguages(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { languages: [] };
    }

    const result = await this.prisma.$queryRaw<
      { language: string; count: bigint }[]
    >`
      SELECT "detectedLanguage" as language, COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        AND "detectedLanguage" IS NOT NULL
        ${sf.session}
      GROUP BY "detectedLanguage"
      ORDER BY count DESC
    `;

    const total = result.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      languages: result.map((r) => ({
        language: r.language,
        count: Number(r.count),
        percentage:
          total > 0 ? Math.round((Number(r.count) / total) * 10000) / 100 : 0,
      })),
    };
  }

  /**
   * Conversation volume split by channel/source (WIDGET, WHATSAPP, DEMO).
   * When the caller has narrowed `sources`, only those channels appear —
   * consistent with every other endpoint's source filter.
   */
  async getConversationChannels(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { channels: [] };
    }

    const result = await this.prisma.$queryRaw<
      { source: string; count: bigint }[]
    >`
      SELECT "source"::text as source, COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startUtc}
        AND "createdAt" < ${endUtc}
        ${sf.session}
      GROUP BY "source"
      ORDER BY count DESC
    `;

    const total = result.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      channels: result.map((r) => ({
        source: r.source,
        count: Number(r.count),
        percentage:
          total > 0 ? Math.round((Number(r.count) / total) * 10000) / 100 : 0,
      })),
    };
  }

  // ==========================================
  // Voice Analytics Methods (Story 10-14)
  // ==========================================

  async getVoiceSummary(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc, prevStartUtc, prevEndUtc } =
      this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return {
        totalVoiceMessages: 0,
        totalTextMessages: 0,
        voiceRatio: 0,
        avgSttLatencyMs: 0,
        avgTtsLatencyMs: 0,
        voiceErrorCount: 0,
        trend: { voiceMessagesTrend: 0 },
      };
    }

    const [current, previous] = await Promise.all([
      this.getVoiceMetrics(agentIds, startUtc, endUtc, sf),
      this.getVoiceMetrics(agentIds, prevStartUtc, prevEndUtc, sf),
    ]);

    const total = current.voiceCount + current.textCount;
    return {
      totalVoiceMessages: current.voiceCount,
      totalTextMessages: current.textCount,
      voiceRatio:
        total > 0
          ? Math.round((current.voiceCount / total) * 10000) / 10000
          : 0,
      avgSttLatencyMs: Math.round(current.avgSttLatency),
      avgTtsLatencyMs: Math.round(current.avgTtsLatency),
      voiceErrorCount: current.errorCount,
      trend: {
        voiceMessagesTrend: this.calcTrend(
          current.voiceCount,
          previous.voiceCount,
        ),
      },
    };
  }

  private async getVoiceMetrics(
    agentIds: string[],
    startUtc: Date,
    endUtc: Date,
    sourceFilter: SourceFilter,
  ) {
    const result = await this.prisma.$queryRaw<
      {
        voice_count: bigint;
        text_count: bigint;
        avg_stt_latency: number | null;
        avg_tts_latency: number | null;
        error_count: bigint;
      }[]
    >`
      WITH user_msgs AS (
        SELECT mm."inputType" AS input_type
        FROM chat_messages cm
        LEFT JOIN chat_message_metrics mm ON mm."messageId" = cm.id
        WHERE cm.role = 'USER'
          AND cm."agentId" = ANY(${agentIds}::text[])
          AND cm."createdAt" >= ${startUtc}
          AND cm."createdAt" < ${endUtc}
          ${sourceFilter.message}
      ),
      metricrows AS (
        SELECT mm."sttLatencyMs" AS stt, mm."ttsLatencyMs" AS tts, mm.errored AS errored, mm.role AS msg_role
        FROM chat_message_metrics mm
        WHERE mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sourceFilter.metric}
      ),
      stt_fence AS (
        SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY stt) AS q1,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY stt) AS q3
        FROM metricrows WHERE stt IS NOT NULL
      ),
      tts_fence AS (
        SELECT
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY tts) AS q1,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY tts) AS q3
        FROM metricrows WHERE tts IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*) FROM user_msgs WHERE input_type = 'voice') as voice_count,
        (SELECT COUNT(*) FROM user_msgs WHERE input_type IS NULL OR input_type != 'voice') as text_count,
        (SELECT AVG(stt) FROM metricrows, stt_fence
           WHERE stt IS NOT NULL
             AND stt <= stt_fence.q3 + ${IQR_MULTIPLIER} * (stt_fence.q3 - stt_fence.q1)) as avg_stt_latency,
        (SELECT AVG(tts) FROM metricrows, tts_fence
           WHERE tts IS NOT NULL
             AND tts <= tts_fence.q3 + ${IQR_MULTIPLIER} * (tts_fence.q3 - tts_fence.q1)) as avg_tts_latency,
        (SELECT COUNT(*) FROM metricrows WHERE errored = true AND msg_role = 'ASSISTANT') as error_count
    `;

    const row = result[0];
    return {
      voiceCount: Number(row?.voice_count ?? 0),
      textCount: Number(row?.text_count ?? 0),
      avgSttLatency: Number(row?.avg_stt_latency ?? 0),
      avgTtsLatency: Number(row?.avg_tts_latency ?? 0),
      errorCount: Number(row?.error_count ?? 0),
    };
  }

  async getLanguageDistribution(query: AnalyticsQuery, user: CurrentUserData) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { languages: [] };
    }

    const result = await this.prisma.$queryRaw<
      { language: string; count: bigint }[]
    >`
      SELECT
        mm."detectedLanguage" as language,
        COUNT(*) as count
      FROM chat_message_metrics mm
      WHERE mm."inputType" = 'voice'
        AND mm."detectedLanguage" IS NOT NULL
        AND mm.role = 'USER'
        AND mm."agentId" = ANY(${agentIds}::text[])
        AND mm."createdAt" >= ${startUtc}
        AND mm."createdAt" < ${endUtc}
        ${sf.metric}
      GROUP BY mm."detectedLanguage"
      ORDER BY count DESC
    `;

    const total = result.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      languages: result.map((r) => ({
        language: r.language,
        count: Number(r.count),
        percentage:
          total > 0 ? Math.round((Number(r.count) / total) * 10000) / 100 : 0,
      })),
    };
  }

  async getVoiceLatencyByProvider(
    query: AnalyticsQuery,
    user: CurrentUserData,
  ) {
    const agentIds = await this.getAgentIds(query, user);
    const { startUtc, endUtc } = this.resolveRange(query);
    const sf = this.getSourceFilter(query.source, query.sources);

    if (agentIds.length === 0) {
      return { stt: [], tts: [], sttAggregate: null, ttsAggregate: null };
    }

    const [sttResult, ttsResult, sttAggResult, ttsAggResult] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            provider: string;
            avg: number | null;
            p50: number | null;
            p95: number | null;
            count: bigint;
          }[]
        >`
        SELECT
          mm."sttProvider" as provider,
          AVG(mm."sttLatencyMs") as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mm."sttLatencyMs") as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm."sttLatencyMs") as p95,
          COUNT(*) as count
        FROM chat_message_metrics mm
        WHERE mm."sttProvider" IS NOT NULL
          AND mm."sttLatencyMs" IS NOT NULL
          AND mm.role = 'USER'
          AND mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sf.metric}
        GROUP BY mm."sttProvider"
      `,
        this.prisma.$queryRaw<
          {
            provider: string;
            avg: number | null;
            p50: number | null;
            p95: number | null;
            count: bigint;
          }[]
        >`
        SELECT
          mm."ttsProvider" as provider,
          AVG(mm."ttsLatencyMs") as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mm."ttsLatencyMs") as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm."ttsLatencyMs") as p95,
          COUNT(*) as count
        FROM chat_message_metrics mm
        WHERE mm."ttsProvider" IS NOT NULL
          AND mm."ttsLatencyMs" IS NOT NULL
          AND mm.role = 'ASSISTANT'
          AND mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sf.metric}
        GROUP BY mm."ttsProvider"
      `,
        // Provider-agnostic aggregates — what the client sees (no provider names).
        // Percentiles must be computed across the whole set in SQL; they can't be
        // correctly averaged from the per-provider rows above.
        this.prisma.$queryRaw<
          {
            avg: number | null;
            p50: number | null;
            p95: number | null;
            count: bigint;
          }[]
        >`
        SELECT
          AVG(mm."sttLatencyMs") as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mm."sttLatencyMs") as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm."sttLatencyMs") as p95,
          COUNT(*) as count
        FROM chat_message_metrics mm
        WHERE mm."sttLatencyMs" IS NOT NULL
          AND mm.role = 'USER'
          AND mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sf.metric}
      `,
        this.prisma.$queryRaw<
          {
            avg: number | null;
            p50: number | null;
            p95: number | null;
            count: bigint;
          }[]
        >`
        SELECT
          AVG(mm."ttsLatencyMs") as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mm."ttsLatencyMs") as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mm."ttsLatencyMs") as p95,
          COUNT(*) as count
        FROM chat_message_metrics mm
        WHERE mm."ttsLatencyMs" IS NOT NULL
          AND mm.role = 'ASSISTANT'
          AND mm."agentId" = ANY(${agentIds}::text[])
          AND mm."createdAt" >= ${startUtc}
          AND mm."createdAt" < ${endUtc}
          ${sf.metric}
      `,
      ]);

    const mapRow = (r: {
      provider: string;
      avg: number | null;
      p50: number | null;
      p95: number | null;
      count: bigint;
    }) => ({
      provider: r.provider,
      avg: Math.round(Number(r.avg ?? 0)),
      p50: Math.round(Number(r.p50 ?? 0)),
      p95: Math.round(Number(r.p95 ?? 0)),
      count: Number(r.count),
    });

    const mapAggregate = (
      r:
        | {
            avg: number | null;
            p50: number | null;
            p95: number | null;
            count: bigint;
          }
        | undefined,
    ) => {
      const count = Number(r?.count ?? 0);
      if (count === 0) return null;
      return {
        avg: Math.round(Number(r?.avg ?? 0)),
        p50: Math.round(Number(r?.p50 ?? 0)),
        p95: Math.round(Number(r?.p95 ?? 0)),
        count,
      };
    };

    return {
      stt: sttResult.map(mapRow),
      tts: ttsResult.map(mapRow),
      sttAggregate: mapAggregate(sttAggResult[0]),
      ttsAggregate: mapAggregate(ttsAggResult[0]),
    };
  }

  async logExport(body: ExportLogBody, user: CurrentUserData) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        clerkId: user.clerkId,
        contextId: user.organizationId ?? user.id,
        // Typed org scope so exports are queryable + erasable by org.
        organizationId: user.organizationId ?? null,
        event: "ANALYTICS_EXPORT",
        data: {
          format: body.format,
          startDate: body.startDate,
          endDate: body.endDate,
        } as Prisma.JsonObject,
      },
    });
    this.log.info("logExport", "analytics export logged", {
      format: body.format,
      organizationId: user.organizationId ?? null,
    });
    return { success: true };
  }
}
