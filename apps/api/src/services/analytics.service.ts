import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Prisma, Role } from '@prisma/client';
import type { CurrentUserData } from '../decorators/current-user.decorator';
import type { AnalyticsQuery, AgentAnalyticsQuery, ExportLogBody } from '../models/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);
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
  private async getSessionMetrics(agentIds: string[], startDate: Date, endDate: Date) {
    if (agentIds.length === 0) {
      return { totalConversations: 0, totalUsers: 0, newUsers: 0, returningUsers: 0 };
    }

    const result = await this.prisma.$queryRaw<
      { total_conversations: bigint; total_users: bigint; returning_users: bigint }[]
    >`
      SELECT
        COUNT(*) as total_conversations,
        COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL) as total_users,
        COUNT(DISTINCT visitor_id) FILTER (
          WHERE visitor_id IS NOT NULL
          AND visitor_id IN (
            SELECT DISTINCT visitor_id FROM chat_sessions
            WHERE agent_id = ANY(${agentIds}::uuid[])
              AND created_at < ${startDate}
              AND visitor_id IS NOT NULL
          )
        ) as returning_users
      FROM chat_sessions
      WHERE agent_id = ANY(${agentIds}::uuid[])
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
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
  private async getMessageMetrics(agentIds: string[], startDate: Date, endDate: Date) {
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
      WHERE cm.chat_session_id IN (
        SELECT id FROM chat_sessions
        WHERE agent_id = ANY(${agentIds}::uuid[])
          AND created_at >= ${startDate}
          AND created_at <= ${endDate}
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
  private async getUserRetentionRate(agentIds: string[], endDate: Date): Promise<number> {
    if (agentIds.length === 0) return 0;

    const result = await this.prisma.$queryRaw<{ retained: bigint; total: bigint }[]>`
      SELECT
        COUNT(DISTINCT CASE WHEN date_range > INTERVAL '60 days' THEN visitor_id END) as retained,
        COUNT(DISTINCT visitor_id) as total
      FROM (
        SELECT visitor_id, MAX(created_at) - MIN(created_at) as date_range
        FROM chat_sessions
        WHERE agent_id = ANY(${agentIds}::uuid[])
          AND visitor_id IS NOT NULL
          AND created_at <= ${endDate}
        GROUP BY visitor_id
      ) sub
    `;

    const row = result[0];
    if (!row || Number(row.total) === 0) return 0;
    return Math.round((Number(row.retained) / Number(row.total)) * 10000) / 100;
  }

  /**
   * Calculate response time metrics using raw SQL for JSONB aggregation.
   */
  private async getResponseTimeMetrics(agentIds: string[], startDate: Date, endDate: Date) {
    if (agentIds.length === 0) {
      return { avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const result = await this.prisma.$queryRaw<
      { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null }[]
    >`
      SELECT
        AVG((metadata->>'responseLatencyMs')::numeric) as avg_ms,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY (metadata->>'responseLatencyMs')::numeric) as p99
      FROM chat_messages
      WHERE role = 'ASSISTANT'
        AND metadata->>'responseLatencyMs' IS NOT NULL
        AND chat_session_id IN (
          SELECT id FROM chat_sessions
          WHERE agent_id = ANY(${agentIds}::uuid[])
            AND created_at >= ${startDate}
            AND created_at <= ${endDate}
        )
    `;

    const row = result[0];
    return {
      avg: Math.round(Number(row?.avg_ms ?? 0)),
      p50: Math.round(Number(row?.p50 ?? 0)),
      p95: Math.round(Number(row?.p95 ?? 0)),
      p99: Math.round(Number(row?.p99 ?? 0)),
    };
  }

  // ==========================================
  // Public API Methods
  // ==========================================

  async getSummary(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);
    const { prevStart, prevEnd } = this.getPreviousPeriod(startDate, endDate);

    const [sessions, messages, responseTime, prevSessions, prevMessages, prevResponseTime, retentionRate, prevRetentionRate] = await Promise.all([
      this.getSessionMetrics(agentIds, startDate, endDate),
      this.getMessageMetrics(agentIds, startDate, endDate),
      this.getResponseTimeMetrics(agentIds, startDate, endDate),
      this.getSessionMetrics(agentIds, prevStart, prevEnd),
      this.getMessageMetrics(agentIds, prevStart, prevEnd),
      this.getResponseTimeMetrics(agentIds, prevStart, prevEnd),
      this.getUserRetentionRate(agentIds, endDate),
      this.getUserRetentionRate(agentIds, prevEnd),
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
        queriesRaised: { value: messages.totalMessagesSent, trend: this.calcTrend(messages.totalMessagesSent, prevMessages.totalMessagesSent) },
      },
    };
  }

  async getConversationsChart(query: AnalyticsQuery, user: CurrentUserData) {
    const { startDate, endDate } = query;
    const agentIds = await this.getAgentIds(query, user);

    if (agentIds.length === 0) return { data: [] };

    const result = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM chat_sessions
      WHERE agent_id = ANY(${agentIds}::uuid[])
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY DATE(created_at)
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
          AND chat_session_id IN (
            SELECT id FROM chat_sessions
            WHERE agent_id = ANY(${agentIds}::uuid[])
              AND created_at >= ${startDate}
              AND created_at <= ${endDate}
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

    if (agentIds.length === 0) return { data: [] };

    const result = await this.prisma.$queryRaw<{ day: number; hour: number; count: bigint }[]>`
      SELECT
        EXTRACT(DOW FROM cm.created_at) as day,
        EXTRACT(HOUR FROM cm.created_at) as hour,
        COUNT(*) as count
      FROM chat_messages cm
      INNER JOIN chat_sessions cs ON cm.chat_session_id = cs.id
      WHERE cs.agent_id = ANY(${agentIds}::uuid[])
        AND cs.created_at >= ${startDate}
        AND cs.created_at <= ${endDate}
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

    if (agentIds.length === 0) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    const countResult = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT a.id) as total
      FROM agents a
      INNER JOIN chat_sessions cs ON cs.agent_id = a.id
      WHERE a.id = ANY(${agentIds}::uuid[])
        AND cs.created_at >= ${startDate}
        AND cs.created_at <= ${endDate}
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
      INNER JOIN chat_sessions cs ON cs.agent_id = a.id
      LEFT JOIN chat_messages cm ON cm.chat_session_id = cs.id
      WHERE a.id = ANY(${agentIds}::uuid[])
        AND cs.created_at >= ${startDate}
        AND cs.created_at <= ${endDate}
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
