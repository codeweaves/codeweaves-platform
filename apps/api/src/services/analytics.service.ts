import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, Role } from '@prisma/client';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import type { AnalyticsQuery, AgentAnalyticsQuery, ExportLogBody } from '../models/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build SQL fragment to filter chat_sessions by source.
   * Always excludes DEMO; optionally narrows to a specific source.
   */
  private getSourceFilter(source?: string): Prisma.Sql {
    if (source === 'WIDGET') {
      return Prisma.sql`AND "source" = 'WIDGET'`;
    }
    if (source === 'WHATSAPP') {
      return Prisma.sql`AND "source" = 'WHATSAPP'`;
    }
    // Default: exclude DEMO
    return Prisma.sql`AND "source" != 'DEMO'`;
  }

  /**
   * Build agent IDs scoped to user's role and query filters.
   * CLIENT users only see their own org. ADMIN/SUPER_ADMIN see all (or filter by orgId).
   */
  private async getAgentIds(
    query: { agentId?: string; orgId?: string },
    user: CurrentUserData,
  ): Promise<string[]> {
    if (user.role === Role.CLIENT && !user.organizationId) {
      throw new ForbiddenException('Client user must be associated with an organization');
    }

    const agentFilter: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(user.role === Role.CLIENT && { organizationId: user.organizationId! }),
      ...(user.role !== Role.CLIENT && query.orgId && { organizationId: query.orgId }),
      ...(query.agentId && { id: query.agentId }),
    };

    const agents = await this.prisma.agent.findMany({
      where: agentFilter,
      select: { id: true },
    });

    return agents.map((a) => a.id);
  }

  /**
   * Compute the previous period of equal duration for trend calculation.
   */
  private getPreviousPeriod(startDate: Date, endDate: Date): { prevStart: Date; prevEnd: Date } {
    const durationMs = endDate.getTime() - startDate.getTime();
    // Minimum 1 day duration to avoid zero-length window when startDate === endDate
    const effectiveDurationMs = Math.max(durationMs, 86_400_000);
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - effectiveDurationMs);
    return { prevStart, prevEnd };
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
  private async getSessionMetrics(agentIds: string[], startDate: Date, endDate: Date, sourceFilter: Prisma.Sql = Prisma.empty) {
    if (agentIds.length === 0) {
      return { totalConversations: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
    }

    const result = await this.prisma.$queryRaw<
      { total_conversations: bigint; total_users: bigint; returning_users: bigint }[]
    >`
      SELECT
        COUNT(*) as total_conversations,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "visitorId" IS NOT NULL) as total_users,
        COUNT(DISTINCT "visitorId") FILTER (
          WHERE "visitorId" IS NOT NULL
          AND "visitorId" IN (
            SELECT DISTINCT "visitorId" FROM chat_sessions
            WHERE "agentId" = ANY(${agentIds}::text[])
              AND "createdAt" < ${startDate}
              AND "visitorId" IS NOT NULL
              ${sourceFilter}
          )
        ) as returning_users
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
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
   * Uses SQL subquery instead of loading session IDs into memory.
   */
  private async getMessageMetrics(agentIds: string[], startDate: Date, endDate: Date, sourceFilter: Prisma.Sql = Prisma.empty) {
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
      WHERE cm."chatSessionId" IN (
        SELECT id FROM chat_sessions
        WHERE "agentId" = ANY(${agentIds}::text[])
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          ${sourceFilter}
      )
    `;

    const row = result[0];
    return {
      totalMessagesSent: Number(row?.user_count ?? 0),
      totalMessagesReceived: Number(row?.assistant_count ?? 0),
    };
  }

  /**
   * Calculate user retention rate: visitors who appear in sessions > 60 days apart / total unique visitors.
   * Scoped to sessions up to endDate so we can compare across periods for trend calculation.
   */
  private async getUserRetentionRate(agentIds: string[], endDate: Date, sourceFilter: Prisma.Sql = Prisma.empty): Promise<number> {
    if (agentIds.length === 0) return 0;

    const result = await this.prisma.$queryRaw<{ retained: bigint; total: bigint }[]>`
      SELECT
        COUNT(DISTINCT CASE WHEN date_range > INTERVAL '60 days' THEN visitor_id END) as retained,
        COUNT(DISTINCT visitor_id) as total
      FROM (
        SELECT "visitorId" as visitor_id, MAX("createdAt") - MIN("createdAt") as date_range
        FROM chat_sessions
        WHERE "agentId" = ANY(${agentIds}::text[])
          AND "visitorId" IS NOT NULL
          AND "createdAt" <= ${endDate}
          ${sourceFilter}
        GROUP BY "visitorId"
      ) sub
    `;

    const row = result[0];
    if (!row || Number(row.total) === 0) return 0;
    return Math.round((Number(row.retained) / Number(row.total)) * 10000) / 100;
  }

  /**
   * Calculate response time metrics using raw SQL for JSONB aggregation.
   */
  private async getResponseTimeMetrics(
    agentIds: string[],
    startDate: Date,
    endDate: Date,
    sourceFilter: Prisma.Sql = Prisma.empty,
  ): Promise<{ avg: number; p50: number; p95: number; p99: number; avgTimeToFirstToken: number | null }> {
    if (agentIds.length === 0) {
      return { avg: 0, p50: 0, p95: 0, p99: 0, avgTimeToFirstToken: null };
    }

    const result = await this.prisma.$queryRaw<
      { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null; avg_ttft: number | null }[]
    >`
      SELECT
        AVG((metadata->>'responseLatencyMs')::numeric) as avg_ms,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p99,
        AVG((metadata->>'timeToFirstToken')::numeric) FILTER (
          WHERE metadata->>'timeToFirstToken' IS NOT NULL
            AND metadata->>'timeToFirstToken' ~ '^[0-9]+(\\.[0-9]+)?$'
        ) as avg_ttft
      FROM chat_messages
      WHERE role = 'ASSISTANT'
        AND metadata->>'responseLatencyMs' IS NOT NULL
        AND metadata->>'responseLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$'
        AND "chatSessionId" IN (
          SELECT id FROM chat_sessions
          WHERE "agentId" = ANY(${agentIds}::text[])
            AND "createdAt" >= ${startDate}
            AND "createdAt" <= ${endDate}
            ${sourceFilter}
        )
    `;

    const row = result[0];
    return {
      avg: Math.round(Number(row?.avg_ms ?? 0)),
      p50: Math.round(Number(row?.p50 ?? 0)),
      p95: Math.round(Number(row?.p95 ?? 0)),
      p99: Math.round(Number(row?.p99 ?? 0)),
      avgTimeToFirstToken: row?.avg_ttft != null ? Math.round(Number(row.avg_ttft)) : null,
    };
  }

  // ==========================================
  // Public API Methods
  // ==========================================

  async getSummary(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const { prevStart, prevEnd } = this.getPreviousPeriod(startDate, endDate);
    const sf = this.getSourceFilter(query.source);

    const [sessions, messages, responseTime, prevSessions, prevMessages, prevResponseTime, retentionRate, prevRetentionRate] = await Promise.all([
      this.getSessionMetrics(agentIds, startDate, endDate, sf),
      this.getMessageMetrics(agentIds, startDate, endDate, sf),
      this.getResponseTimeMetrics(agentIds, startDate, endDate, sf),
      this.getSessionMetrics(agentIds, prevStart, prevEnd, sf),
      this.getMessageMetrics(agentIds, prevStart, prevEnd, sf),
      this.getResponseTimeMetrics(agentIds, prevStart, prevEnd, sf),
      this.getUserRetentionRate(agentIds, endDate, sf),
      this.getUserRetentionRate(agentIds, prevEnd, sf),
    ]);

    const userGrowthRate = prevSessions.newUsers === 0
      ? (sessions.newUsers > 0 ? 100 : 0)
      : Math.round(((sessions.newUsers - prevSessions.newUsers) / prevSessions.newUsers) * 10000) / 100;

    const totalExchanged = messages.totalMessagesSent + messages.totalMessagesReceived;
    const prevTotalExchanged = prevMessages.totalMessagesSent + prevMessages.totalMessagesReceived;

    return {
      period: { start: startDate.toISOString(), end: endDate.toISOString() },
      kpis: {
        totalUsers: { value: sessions.totalUsers, trend: this.calcTrend(sessions.totalUsers, prevSessions.totalUsers) },
        newUsers: { value: sessions.newUsers, trend: this.calcTrend(sessions.newUsers, prevSessions.newUsers) },
        returningUsers: { value: sessions.returningUsers, trend: this.calcTrend(sessions.returningUsers, prevSessions.returningUsers) },
        totalConversations: { value: sessions.totalConversations, trend: this.calcTrend(sessions.totalConversations, prevSessions.totalConversations) },
        totalMessagesSent: { value: messages.totalMessagesSent, trend: this.calcTrend(messages.totalMessagesSent, prevMessages.totalMessagesSent) },
        totalMessagesReceived: { value: messages.totalMessagesReceived, trend: this.calcTrend(messages.totalMessagesReceived, prevMessages.totalMessagesReceived) },
        totalMessagesExchanged: { value: totalExchanged, trend: this.calcTrend(totalExchanged, prevTotalExchanged) },
        userRetentionRate: { value: retentionRate, trend: this.calcTrend(retentionRate, prevRetentionRate) },
        userGrowthRate: { value: userGrowthRate, trend: 0 },
        avgResponseTimeMs: { value: responseTime.avg, trend: this.calcTrend(responseTime.avg, prevResponseTime.avg) },
        p50ResponseTimeMs: { value: responseTime.p50 },
        p95ResponseTimeMs: { value: responseTime.p95 },
        p99ResponseTimeMs: { value: responseTime.p99 },
        avgTimeToFirstTokenMs: {
          value: responseTime.avgTimeToFirstToken,
          trend: responseTime.avgTimeToFirstToken != null && prevResponseTime.avgTimeToFirstToken != null
            ? this.calcTrend(responseTime.avgTimeToFirstToken, prevResponseTime.avgTimeToFirstToken)
            : null,
        },
        queriesRaised: { value: messages.totalMessagesSent, trend: this.calcTrend(messages.totalMessagesSent, prevMessages.totalMessagesSent) },
      },
    };
  }

  async getConversationsChart(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    if (agentIds.length === 0) return { data: [] };

    const result = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT DATE("createdAt") as date, COUNT(*) as count
      FROM chat_sessions
      WHERE "agentId" = ANY(${agentIds}::text[])
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
        ${sf}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    return {
      data: result.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        count: Number(r.count),
      })),
    };
  }

  async getResponseTimeDistribution(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    const emptyBuckets = [
      { label: '<1s', min: 0, max: 1000, count: 0, percentage: 0 },
      { label: '1-2s', min: 1000, max: 2000, count: 0, percentage: 0 },
      { label: '2-5s', min: 2000, max: 5000, count: 0, percentage: 0 },
      { label: '5-10s', min: 5000, max: 10000, count: 0, percentage: 0 },
      { label: '>10s', min: 10000, max: null, count: 0, percentage: 0 },
    ];

    if (agentIds.length === 0) {
      return { buckets: emptyBuckets, percentiles: { p50: 0, p95: 0, p99: 0 } };
    }

    // Single query for both buckets and percentiles
    const result = await this.prisma.$queryRaw<{
      bucket: string;
      count: bigint;
      p50: number | null;
      p95: number | null;
      p99: number | null;
    }[]>`
      WITH filtered AS (
        SELECT (metadata->>'responseLatencyMs')::numeric as latency
        FROM chat_messages
        WHERE role = 'ASSISTANT'
          AND metadata->>'responseLatencyMs' IS NOT NULL
          AND metadata->>'responseLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$'
          AND "chatSessionId" IN (
            SELECT id FROM chat_sessions
            WHERE "agentId" = ANY(${agentIds}::text[])
              AND "createdAt" >= ${startDate}
              AND "createdAt" <= ${endDate}
              ${sf}
          )
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
    let p50 = 0, p95 = 0, p99 = 0;
    for (const r of result) {
      bucketMap[r.bucket] = Number(r.count);
      // Percentile values are the same across all rows
      p50 = Math.round(Number(r.p50 ?? 0));
      p95 = Math.round(Number(r.p95 ?? 0));
      p99 = Math.round(Number(r.p99 ?? 0));
    }

    const total = Object.values(bucketMap).reduce((a, b) => a + b, 0);

    const buckets = [
      { label: '<1s', min: 0, max: 1000, count: bucketMap['lt1s'] ?? 0, percentage: 0 },
      { label: '1-2s', min: 1000, max: 2000, count: bucketMap['1to2s'] ?? 0, percentage: 0 },
      { label: '2-5s', min: 2000, max: 5000, count: bucketMap['2to5s'] ?? 0, percentage: 0 },
      { label: '5-10s', min: 5000, max: 10000, count: bucketMap['5to10s'] ?? 0, percentage: 0 },
      { label: '>10s' as const, min: 10000, max: null as number | null, count: bucketMap['gt10s'] ?? 0, percentage: 0 },
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
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    if (agentIds.length === 0) return { data: [] };

    const result = await this.prisma.$queryRaw<{ day: number; hour: number; count: bigint }[]>`
      SELECT
        EXTRACT(DOW FROM cm."createdAt") as day,
        EXTRACT(HOUR FROM cm."createdAt") as hour,
        COUNT(*) as count
      FROM chat_messages cm
      INNER JOIN chat_sessions cs ON cm."chatSessionId" = cs.id
      WHERE cs."agentId" = ANY(${agentIds}::text[])
        AND cs."createdAt" >= ${startDate}
        AND cs."createdAt" <= ${endDate}
        ${sf}
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
    const { startDate, endDate, page = 1, limit = 20, sortBy = 'conversations', sortOrder = 'desc' } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    if (agentIds.length === 0) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    const countResult = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT a.id) as total
      FROM agents a
      INNER JOIN chat_sessions cs ON cs."agentId" = a.id
      WHERE a.id = ANY(${agentIds}::text[])
        AND cs."createdAt" >= ${startDate}
        AND cs."createdAt" <= ${endDate}
        ${sf}
    `;

    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    const sortColSql = sortBy === 'agentName' ? 'agent_name' : sortBy === 'avgResponseTimeMs' ? 'avg_response_time_ms' : sortBy === 'queriesRaised' ? 'queries_raised' : sortBy;

    // Use separate queries per sort column to avoid dynamic SQL injection
    let orderByClause: ReturnType<typeof Prisma.sql>;
    switch (sortColSql) {
      case 'agent_name':
        orderByClause = sortOrder === 'asc'
          ? Prisma.sql`ORDER BY a.name ASC NULLS LAST`
          : Prisma.sql`ORDER BY a.name DESC NULLS LAST`;
        break;
      case 'messages':
        orderByClause = sortOrder === 'asc'
          ? Prisma.sql`ORDER BY COUNT(cm.id) ASC NULLS LAST`
          : Prisma.sql`ORDER BY COUNT(cm.id) DESC NULLS LAST`;
        break;
      case 'avg_response_time_ms':
        orderByClause = sortOrder === 'asc'
          ? Prisma.sql`ORDER BY AVG(CASE WHEN cm.role = 'ASSISTANT' AND cm.metadata->>'responseLatencyMs' IS NOT NULL THEN (cm.metadata->>'responseLatencyMs')::numeric END) ASC NULLS LAST`
          : Prisma.sql`ORDER BY AVG(CASE WHEN cm.role = 'ASSISTANT' AND cm.metadata->>'responseLatencyMs' IS NOT NULL THEN (cm.metadata->>'responseLatencyMs')::numeric END) DESC NULLS LAST`;
        break;
      case 'queries_raised':
        orderByClause = sortOrder === 'asc'
          ? Prisma.sql`ORDER BY COUNT(CASE WHEN cm.role = 'USER' THEN 1 END) ASC NULLS LAST`
          : Prisma.sql`ORDER BY COUNT(CASE WHEN cm.role = 'USER' THEN 1 END) DESC NULLS LAST`;
        break;
      default: // conversations
        orderByClause = sortOrder === 'asc'
          ? Prisma.sql`ORDER BY COUNT(DISTINCT cs.id) ASC NULLS LAST`
          : Prisma.sql`ORDER BY COUNT(DISTINCT cs.id) DESC NULLS LAST`;
        break;
    }

    const data = await this.prisma.$queryRaw<
      {
        agent_id: string;
        agent_name: string;
        conversations: bigint;
        messages: bigint;
        avg_response_time_ms: number | null;
        queries_raised: bigint;
      }[]
    >`
      SELECT
        a.id as agent_id,
        a.name as agent_name,
        COUNT(DISTINCT cs.id) as conversations,
        COUNT(cm.id) as messages,
        AVG(CASE WHEN cm.role = 'ASSISTANT' AND cm.metadata->>'responseLatencyMs' IS NOT NULL
            THEN (cm.metadata->>'responseLatencyMs')::numeric END) as avg_response_time_ms,
        COUNT(CASE WHEN cm.role = 'USER' THEN 1 END) as queries_raised
      FROM agents a
      INNER JOIN chat_sessions cs ON cs."agentId" = a.id
      LEFT JOIN chat_messages cm ON cm."chatSessionId" = cs.id
      WHERE a.id = ANY(${agentIds}::text[])
        AND cs."createdAt" >= ${startDate}
        AND cs."createdAt" <= ${endDate}
        ${sf}
      GROUP BY a.id, a.name
      ${orderByClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

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
  // Voice Analytics Methods (Story 10-14)
  // ==========================================

  async getVoiceSummary(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const { prevStart, prevEnd } = this.getPreviousPeriod(startDate, endDate);
    const sf = this.getSourceFilter(query.source);

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
      this.getVoiceMetrics(agentIds, startDate, endDate, sf),
      this.getVoiceMetrics(agentIds, prevStart, prevEnd, sf),
    ]);

    const total = current.voiceCount + current.textCount;
    return {
      totalVoiceMessages: current.voiceCount,
      totalTextMessages: current.textCount,
      voiceRatio: total > 0 ? Math.round((current.voiceCount / total) * 10000) / 10000 : 0,
      avgSttLatencyMs: Math.round(current.avgSttLatency),
      avgTtsLatencyMs: Math.round(current.avgTtsLatency),
      voiceErrorCount: current.errorCount,
      trend: {
        voiceMessagesTrend: this.calcTrend(current.voiceCount, previous.voiceCount),
      },
    };
  }

  private async getVoiceMetrics(agentIds: string[], startDate: Date, endDate: Date, sourceFilter: Prisma.Sql = Prisma.empty) {
    const result = await this.prisma.$queryRaw<
      {
        voice_count: bigint;
        text_count: bigint;
        avg_stt_latency: number | null;
        avg_tts_latency: number | null;
        error_count: bigint;
      }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE cm.metadata->>'inputType' = 'voice' AND cm.role = 'USER') as voice_count,
        COUNT(*) FILTER (WHERE (cm.metadata->>'inputType' IS NULL OR cm.metadata->>'inputType' != 'voice') AND cm.role = 'USER') as text_count,
        AVG((cm.metadata->>'sttLatencyMs')::numeric) FILTER (WHERE cm.metadata->>'sttLatencyMs' IS NOT NULL AND cm.metadata->>'sttLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$') as avg_stt_latency,
        AVG((cm.metadata->>'ttsLatencyMs')::numeric) FILTER (WHERE cm.metadata->>'ttsLatencyMs' IS NOT NULL AND cm.metadata->>'ttsLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$') as avg_tts_latency,
        COUNT(*) FILTER (WHERE cm.metadata->>'ttsError' IS NOT NULL AND cm.role = 'ASSISTANT') as error_count
      FROM chat_messages cm
      WHERE cm."chatSessionId" IN (
        SELECT id FROM chat_sessions
        WHERE "agentId" = ANY(${agentIds}::text[])
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          ${sourceFilter}
      )
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
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    if (agentIds.length === 0) {
      return { languages: [] };
    }

    const result = await this.prisma.$queryRaw<
      { language: string; count: bigint }[]
    >`
      SELECT
        cm.metadata->>'detectedLanguage' as language,
        COUNT(*) as count
      FROM chat_messages cm
      WHERE cm.metadata->>'inputType' = 'voice'
        AND cm.metadata->>'detectedLanguage' IS NOT NULL
        AND cm.role = 'USER'
        AND cm."chatSessionId" IN (
          SELECT id FROM chat_sessions
          WHERE "agentId" = ANY(${agentIds}::text[])
            AND "createdAt" >= ${startDate}
            AND "createdAt" <= ${endDate}
            ${sf}
        )
      GROUP BY cm.metadata->>'detectedLanguage'
      ORDER BY count DESC
    `;

    const total = result.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      languages: result.map((r) => ({
        language: r.language,
        count: Number(r.count),
        percentage: total > 0 ? Math.round((Number(r.count) / total) * 10000) / 100 : 0,
      })),
    };
  }

  async getVoiceLatencyByProvider(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const sf = this.getSourceFilter(query.source);

    if (agentIds.length === 0) {
      return { stt: [], tts: [] };
    }

    const [sttResult, ttsResult] = await Promise.all([
      this.prisma.$queryRaw<
        { provider: string; avg: number | null; p50: number | null; p95: number | null; count: bigint }[]
      >`
        SELECT
          cm.metadata->>'sttProvider' as provider,
          AVG((cm.metadata->>'sttLatencyMs')::numeric) as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (cm.metadata->>'sttLatencyMs')::numeric) as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (cm.metadata->>'sttLatencyMs')::numeric) as p95,
          COUNT(*) as count
        FROM chat_messages cm
        WHERE cm.metadata->>'inputType' = 'voice'
          AND cm.metadata->>'sttProvider' IS NOT NULL
          AND cm.metadata->>'sttLatencyMs' IS NOT NULL
          AND cm.metadata->>'sttLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$'
          AND cm.role = 'USER'
          AND cm."chatSessionId" IN (
            SELECT id FROM chat_sessions
            WHERE "agentId" = ANY(${agentIds}::text[])
              AND "createdAt" >= ${startDate}
              AND "createdAt" <= ${endDate}
              ${sf}
          )
        GROUP BY cm.metadata->>'sttProvider'
      `,
      this.prisma.$queryRaw<
        { provider: string; avg: number | null; p50: number | null; p95: number | null; count: bigint }[]
      >`
        SELECT
          cm.metadata->>'ttsProvider' as provider,
          AVG((cm.metadata->>'ttsLatencyMs')::numeric) as avg,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (cm.metadata->>'ttsLatencyMs')::numeric) as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (cm.metadata->>'ttsLatencyMs')::numeric) as p95,
          COUNT(*) as count
        FROM chat_messages cm
        WHERE cm.metadata->>'inputType' = 'voice'
          AND cm.metadata->>'ttsProvider' IS NOT NULL
          AND cm.metadata->>'ttsLatencyMs' IS NOT NULL
          AND cm.metadata->>'ttsLatencyMs' ~ '^[0-9]+(\\.[0-9]+)?$'
          AND cm.role = 'ASSISTANT'
          AND cm."chatSessionId" IN (
            SELECT id FROM chat_sessions
            WHERE "agentId" = ANY(${agentIds}::text[])
              AND "createdAt" >= ${startDate}
              AND "createdAt" <= ${endDate}
              ${sf}
          )
        GROUP BY cm.metadata->>'ttsProvider'
      `,
    ]);

    const mapRow = (r: { provider: string; avg: number | null; p50: number | null; p95: number | null; count: bigint }) => ({
      provider: r.provider,
      avg: Math.round(Number(r.avg ?? 0)),
      p50: Math.round(Number(r.p50 ?? 0)),
      p95: Math.round(Number(r.p95 ?? 0)),
      count: Number(r.count),
    });

    return {
      stt: sttResult.map(mapRow),
      tts: ttsResult.map(mapRow),
    };
  }

  async logExport(
    body: ExportLogBody,
    user: CurrentUserData,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        auth0Id: user.auth0Id,
        contextId: user.organizationId ?? user.id,
        event: 'ANALYTICS_EXPORT',
        data: {
          format: body.format,
          startDate: body.startDate,
          endDate: body.endDate,
        } as Prisma.JsonObject,
      },
    });
    return { success: true };
  }
}
