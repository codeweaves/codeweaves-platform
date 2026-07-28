import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AnalyticsService } from '../../../src/services/analytics.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { Role } from '@prisma/client';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockPrismaService = {
    agent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const otherOrgId = '223e4567-e89b-12d3-a456-426614174000';
  const agentId1 = '333e4567-e89b-12d3-a456-426614174000';
  const agentId2 = '444e4567-e89b-12d3-a456-426614174000';

  const adminUser: CurrentUserData = {
    clerkId: 'user_admin',
    email: 'admin@test.com',
    id: 'admin-user-id',
    role: Role.ADMIN,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const clientUser: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@test.com',
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const superAdminUser: CurrentUserData = {
    clerkId: 'user_superadmin',
    email: 'superadmin@test.com',
    id: 'superadmin-user-id',
    role: Role.SUPER_ADMIN,
    organizationId: null,
    organization: null,
  };

  const clientUserNoOrg: CurrentUserData = {
    clerkId: 'user_client-no-org',
    email: 'client-no-org@test.com',
    id: 'client-no-org-user-id',
    role: Role.CLIENT,
    organizationId: null,
    organization: null,
  };

  const baseQuery = {
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    timezone: 'UTC',
  };

  // Helper to mock all $queryRaw calls needed for getSummary (8 calls total):
  // 1. current session metrics, 2. current message metrics, 3. current response time,
  // 4. prev session metrics, 5. prev message metrics, 6. prev response time,
  // 7. current couldn't-answer rate, 8. prev couldn't-answer rate.
  // Retention is derived from session metrics (returning_users / total_users), not a separate query.
  function mockSummaryQueryRaws(overrides?: {
    currentSessions?: { total_conversations: bigint; total_users: bigint; returning_users: bigint };
    currentMessages?: { user_count: bigint; assistant_count: bigint };
    currentResponseTime?: { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null };
    prevSessions?: { total_conversations: bigint; total_users: bigint; returning_users: bigint };
    prevMessages?: { user_count: bigint; assistant_count: bigint };
    prevResponseTime?: { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null };
    couldntAnswer?: { flagged: bigint; tracked: bigint };
    prevCouldntAnswer?: { flagged: bigint; tracked: bigint };
  }) {
    const defaults = {
      currentSessions: { total_conversations: BigInt(0), total_users: BigInt(0), returning_users: BigInt(0) },
      currentMessages: { user_count: BigInt(0), assistant_count: BigInt(0) },
      currentResponseTime: { avg_ms: null, p50: null, p95: null, p99: null },
      prevSessions: { total_conversations: BigInt(0), total_users: BigInt(0), returning_users: BigInt(0) },
      prevMessages: { user_count: BigInt(0), assistant_count: BigInt(0) },
      prevResponseTime: { avg_ms: null, p50: null, p95: null, p99: null },
      couldntAnswer: { flagged: BigInt(0), tracked: BigInt(0) },
      prevCouldntAnswer: { flagged: BigInt(0), tracked: BigInt(0) },
      ...overrides,
    };

    mockPrismaService.$queryRaw
      .mockResolvedValueOnce([defaults.currentSessions])
      .mockResolvedValueOnce([defaults.currentMessages])
      .mockResolvedValueOnce([defaults.currentResponseTime])
      .mockResolvedValueOnce([defaults.prevSessions])
      .mockResolvedValueOnce([defaults.prevMessages])
      .mockResolvedValueOnce([defaults.prevResponseTime])
      .mockResolvedValueOnce([defaults.couldntAnswer])
      .mockResolvedValueOnce([defaults.prevCouldntAnswer]);
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
    // Default: no agent has fallback phrases (hasFallbackPhrases → false).
    // getSummary calls agent.findFirst for the `fallbackConfigured` flag.
    mockPrismaService.agent.findFirst.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================
  // Tenant Isolation Tests (AC: 3, 13)
  // ==========================================

  describe('tenant isolation', () => {
    it('should filter by organizationId for CLIENT users', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockSummaryQueryRaws();

      await service.getSummary(baseQuery, clientUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deletedAt: null,
          organizationId: orgId,
        }),
        select: { id: true },
      });
    });

    it('should NOT filter by organizationId for ADMIN users', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockSummaryQueryRaws();

      await service.getSummary(baseQuery, adminUser);

      const callArgs = mockPrismaService.agent.findMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ deletedAt: null });
    });

    it('should NOT filter by organizationId for SUPER_ADMIN users', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockSummaryQueryRaws();

      await service.getSummary(baseQuery, superAdminUser);

      const callArgs = mockPrismaService.agent.findMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ deletedAt: null });
    });

    it('should allow ADMIN/SUPER_ADMIN to filter by orgId', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockSummaryQueryRaws();

      await service.getSummary({ ...baseQuery, orgId: otherOrgId }, superAdminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deletedAt: null,
          organizationId: { in: [otherOrgId] },
        }),
        select: { id: true },
      });
    });

    it('should throw ForbiddenException for CLIENT user with no organization', async () => {
      await expect(service.getSummary(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================
  // Date Range Filtering Tests (AC: 4)
  // ==========================================

  describe('date range filtering', () => {
    it('should call $queryRaw with date parameters for session metrics', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockSummaryQueryRaws();

      await service.getSummary(baseQuery, adminUser);

      // $queryRaw is called with tagged template literals, verify it was called
      expect(mockPrismaService.$queryRaw).toHaveBeenCalled();
      // 6 calls: sessions, messages, responseTime x2 (current+prev). Retention is derived, not queried.
      expect(mockPrismaService.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(6);
    });
  });

  // ==========================================
  // Agent ID Filtering Tests (AC: 5)
  // ==========================================

  describe('agentId filtering', () => {
    it('should filter agents by agentId when provided', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockSummaryQueryRaws();

      await service.getSummary({ ...baseQuery, agentId: agentId1 }, adminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deletedAt: null,
          id: { in: [agentId1] },
        }),
        select: { id: true },
      });
    });
  });

  // ==========================================
  // Summary KPIs (AC: 1, 6)
  // ==========================================

  describe('getSummary', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return all KPIs with correct shape', async () => {
      mockSummaryQueryRaws({
        currentSessions: { total_conversations: BigInt(3), total_users: BigInt(2), returning_users: BigInt(0) },
        currentMessages: { user_count: BigInt(10), assistant_count: BigInt(9) },
        currentResponseTime: { avg_ms: 1500, p50: 1200, p95: 3000, p99: 5000 },
        prevSessions: { total_conversations: BigInt(1), total_users: BigInt(1), returning_users: BigInt(0) },
        prevMessages: { user_count: BigInt(5), assistant_count: BigInt(4) },
        prevResponseTime: { avg_ms: 1600, p50: 1300, p95: 3100, p99: 5100 },
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.period).toBeDefined();
      expect(result.period.start).toBe('2026-01-01T00:00:00.000Z');
      // Exclusive upper bound = start of the day after endDate in the requested timezone.
      expect(result.period.end).toBe('2026-02-01T00:00:00.000Z');

      // Check KPI structure
      expect(result.kpis.totalUsers).toHaveProperty('value');
      expect(result.kpis.totalUsers).toHaveProperty('trend');
      expect(result.kpis.newUsers).toHaveProperty('value');
      expect(result.kpis.totalConversations).toHaveProperty('value');
      expect(result.kpis.totalMessagesSent).toHaveProperty('value');
      expect(result.kpis.totalMessagesReceived).toHaveProperty('value');
      expect(result.kpis.totalMessagesExchanged).toHaveProperty('value');
      expect(result.kpis.userRetentionRate).toHaveProperty('value');
      expect(result.kpis.userGrowthRate).toHaveProperty('value');
      expect(result.kpis.avgResponseTimeMs).toHaveProperty('value');
      expect(result.kpis.p50ResponseTimeMs).toHaveProperty('value');
      expect(result.kpis.p95ResponseTimeMs).toHaveProperty('value');
      expect(result.kpis.p99ResponseTimeMs).toHaveProperty('value');

      // Verify actual KPI values
      expect(result.kpis.totalUsers.value).toBe(2);
      expect(result.kpis.totalConversations.value).toBe(3);
      expect(result.kpis.totalMessagesSent.value).toBe(10);
      expect(result.kpis.totalMessagesReceived.value).toBe(9);
      expect(result.kpis.totalMessagesExchanged.value).toBe(19);
      expect(result.kpis.avgResponseTimeMs.value).toBe(1500);
      expect(result.kpis.p50ResponseTimeMs.value).toBe(1200);
    });

    it('should return zeros when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockSummaryQueryRaws();

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.kpis.totalUsers.value).toBe(0);
      expect(result.kpis.totalConversations.value).toBe(0);
      expect(result.kpis.totalMessagesSent.value).toBe(0);
    });

    it('should calculate trend as percentage change', async () => {
      // Current: 3 conversations, Prev: 2 conversations → trend = +50%
      mockSummaryQueryRaws({
        currentSessions: { total_conversations: BigInt(3), total_users: BigInt(3), returning_users: BigInt(0) },
        prevSessions: { total_conversations: BigInt(2), total_users: BigInt(2), returning_users: BigInt(0) },
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.kpis.totalConversations.trend).toBe(50);
    });

    it('should calculate userRetentionRate trend', async () => {
      // Retention = returning_users / total_users.
      // Current: 2/10 = 20%, Prev: 1/10 = 10% → trend = +100%.
      mockSummaryQueryRaws({
        currentSessions: { total_conversations: BigInt(10), total_users: BigInt(10), returning_users: BigInt(2) },
        prevSessions: { total_conversations: BigInt(10), total_users: BigInt(10), returning_users: BigInt(1) },
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.kpis.userRetentionRate.value).toBe(20);
      expect(result.kpis.userRetentionRate.trend).toBe(100); // 20% vs 10% = 100% increase
    });

    it('should calculate couldntAnswerRate as flagged / tracked replies', async () => {
      mockSummaryQueryRaws({
        couldntAnswer: { flagged: BigInt(3), tracked: BigInt(12) }, // 25%
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.kpis.couldntAnswerRate.value).toBe(25);
    });

    it('sets fallbackConfigured=true when an in-scope agent has fallback phrases', async () => {
      mockSummaryQueryRaws();
      mockPrismaService.agent.findFirst.mockResolvedValue({ id: agentId1 });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.fallbackConfigured).toBe(true);
    });

    it('sets fallbackConfigured=false when no in-scope agent has fallback phrases', async () => {
      mockSummaryQueryRaws();
      // beforeEach default: agent.findFirst → null (no phrases)

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.fallbackConfigured).toBe(false);
    });
  });

  // ==========================================
  // Conversations Chart (AC: 8)
  // ==========================================

  describe('getConversationsChart', () => {
    it('should return daily conversation counts', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw.mockResolvedValue([
        { date: new Date('2026-01-01'), count: BigInt(5) },
        { date: new Date('2026-01-02'), count: BigInt(8) },
      ]);

      const result = await service.getConversationsChart(baseQuery, adminUser);

      expect(result.data).toHaveLength(2);
      const firstDay = result.data[0]!;
      expect(firstDay).toHaveProperty('date');
      expect(firstDay).toHaveProperty('count');
      expect(typeof firstDay.count).toBe('number');
    });

    it('should return empty data when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getConversationsChart(baseQuery, adminUser);

      expect(result.data).toEqual([]);
    });
  });

  describe('getConversationsByWeekday', () => {
    it('returns all 7 weekdays, filling missing days with 0', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw.mockResolvedValue([
        { dow: 1, count: BigInt(5) },
        { dow: 3, count: BigInt(9) },
      ]);

      const result = await service.getConversationsByWeekday(baseQuery, adminUser);

      expect(result.data).toHaveLength(7);
      expect(result.data.map((d) => d.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(result.data[1]).toEqual({ day: 1, count: 5 });
      expect(result.data[3]).toEqual({ day: 3, count: 9 });
      expect(result.data[0]).toEqual({ day: 0, count: 0 });
    });

    it('returns all-zero 7 days when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getConversationsByWeekday(baseQuery, adminUser);

      expect(result.data).toHaveLength(7);
      expect(result.data.every((d) => d.count === 0)).toBe(true);
    });
  });

  // ==========================================
  // Conversation Classification & Channel Analytics
  // ==========================================

  describe('getConversationCategories', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should split named categories from uncategorized and compute percentages over classified sessions', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { category: 'Pricing', count: BigInt(60) },
        { category: 'Support', count: BigInt(30) },
        { category: 'Refunds', count: BigInt(10) },
        { category: null, count: BigInt(25) },
      ]);

      const result = await service.getConversationCategories(baseQuery, adminUser);

      expect(result.uncategorized).toBe(25);
      expect(result.categories).toHaveLength(3);
      // Percentages are over the 100 classified sessions, not 125 total
      expect(result.categories[0]).toEqual({ category: 'Pricing', count: 60, percentage: 60 });
      expect(result.categories[1]).toEqual({ category: 'Support', count: 30, percentage: 30 });
      expect(result.categories[2]).toEqual({ category: 'Refunds', count: 10, percentage: 10 });
    });

    it('should return only the uncategorized count when nothing is classified', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([{ category: null, count: BigInt(7) }]);

      const result = await service.getConversationCategories(baseQuery, adminUser);

      expect(result.categories).toEqual([]);
      expect(result.uncategorized).toBe(7);
    });

    it('should return empty when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getConversationCategories(baseQuery, adminUser);

      expect(result).toEqual({ categories: [], uncategorized: 0 });
    });
  });

  describe('getConversationLanguages', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return language distribution with percentages', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { language: 'en', count: BigInt(70) },
        { language: 'hi', count: BigInt(30) },
      ]);

      const result = await service.getConversationLanguages(baseQuery, adminUser);

      expect(result.languages).toHaveLength(2);
      expect(result.languages[0]).toEqual({ language: 'en', count: 70, percentage: 70 });
      expect(result.languages[1]).toEqual({ language: 'hi', count: 30, percentage: 30 });
    });

    it('should return empty array when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getConversationLanguages(baseQuery, adminUser);

      expect(result.languages).toEqual([]);
    });
  });

  describe('getConversationChannels', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return channel split with percentages', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { source: 'WIDGET', count: BigInt(50) },
        { source: 'WHATSAPP', count: BigInt(30) },
        { source: 'DEMO', count: BigInt(20) },
      ]);

      const result = await service.getConversationChannels(baseQuery, adminUser);

      expect(result.channels).toHaveLength(3);
      expect(result.channels[0]).toEqual({ source: 'WIDGET', count: 50, percentage: 50 });
      expect(result.channels[1]).toEqual({ source: 'WHATSAPP', count: 30, percentage: 30 });
      expect(result.channels[2]).toEqual({ source: 'DEMO', count: 20, percentage: 20 });
    });

    it('should return empty array when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getConversationChannels(baseQuery, adminUser);

      expect(result.channels).toEqual([]);
    });

    it('should throw ForbiddenException for CLIENT without organization', async () => {
      await expect(service.getConversationCategories(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getConversationLanguages(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getConversationChannels(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================
  // Response Time Distribution (AC: 9)
  // ==========================================

  describe('getResponseTimeDistribution', () => {
    it('should return 5 buckets with counts, percentages and percentiles from single query', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      // Combined query now returns buckets with percentiles in each row
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { bucket: 'lt1s', count: BigInt(50), p50: 800, p95: 2500, p99: 5000 },
        { bucket: '1to2s', count: BigInt(30), p50: 800, p95: 2500, p99: 5000 },
        { bucket: '2to5s', count: BigInt(15), p50: 800, p95: 2500, p99: 5000 },
        { bucket: '5to10s', count: BigInt(4), p50: 800, p95: 2500, p99: 5000 },
        { bucket: 'gt10s', count: BigInt(1), p50: 800, p95: 2500, p99: 5000 },
      ]);

      const result = await service.getResponseTimeDistribution(baseQuery, adminUser);

      expect(result.buckets).toHaveLength(5);
      const firstBucket = result.buckets[0]!;
      expect(firstBucket.label).toBe('<1s');
      expect(firstBucket.count).toBe(50);
      expect(firstBucket.percentage).toBe(50);
      expect(result.percentiles.p50).toBe(800);
      expect(result.percentiles.p95).toBe(2500);
      expect(result.percentiles.p99).toBe(5000);

      // Verify only one $queryRaw call (combined query instead of two)
      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should return zero counts when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getResponseTimeDistribution(baseQuery, adminUser);

      expect(result.buckets).toHaveLength(5);
      expect(result.buckets.every((b) => b.count === 0)).toBe(true);
    });

    it('should use null for last bucket max instead of Infinity', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getResponseTimeDistribution(baseQuery, adminUser);

      const lastBucket = result.buckets[4]!;
      expect(lastBucket.label).toBe('>10s');
      expect(lastBucket.max).toBeNull();
    });
  });

  // ==========================================
  // Message Volume Heatmap (AC: 10)
  // ==========================================

  describe('getMessageVolumeHeatmap', () => {
    it('should return day x hour data points', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw.mockResolvedValue([
        { day: 1, hour: 9, count: BigInt(15) },
        { day: 1, hour: 10, count: BigInt(20) },
        { day: 2, hour: 14, count: BigInt(12) },
      ]);

      const result = await service.getMessageVolumeHeatmap(baseQuery, adminUser);

      expect(result.data).toHaveLength(3);
      const first = result.data[0]!;
      expect(first).toHaveProperty('day');
      expect(first).toHaveProperty('hour');
      expect(first).toHaveProperty('count');
      expect(typeof first.day).toBe('number');
      expect(typeof first.hour).toBe('number');
    });

    it('should return empty data when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getMessageVolumeHeatmap(baseQuery, adminUser);

      expect(result.data).toEqual([]);
    });
  });

  // ==========================================
  // Agent Metrics (AC: 11)
  // ==========================================

  describe('getAgentMetrics', () => {
    const agentQuery = {
      ...baseQuery,
      page: 1,
      limit: 20,
      sortBy: 'conversations' as const,
      sortOrder: 'desc' as const,
    };

    it('should return paginated agent metrics', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }, { id: agentId2 }]);
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{ total: BigInt(2) }]) // count query
        .mockResolvedValueOnce([ // data query
          {
            agent_id: agentId1,
            agent_name: 'Agent 1',
            conversations: BigInt(50),
            messages: BigInt(200),
            avg_response_time_ms: 1500,
            queries_raised: BigInt(100),
          },
          {
            agent_id: agentId2,
            agent_name: 'Agent 2',
            conversations: BigInt(30),
            messages: BigInt(120),
            avg_response_time_ms: 1200,
            queries_raised: BigInt(60),
          },
        ]);

      const result = await service.getAgentMetrics(agentQuery, adminUser);

      expect(result.data).toHaveLength(2);
      const firstAgent = result.data[0]!;
      expect(firstAgent.agentId).toBe(agentId1);
      expect(firstAgent.agentName).toBe('Agent 1');
      expect(firstAgent.conversations).toBe(50);
      expect(firstAgent.messages).toBe(200);
      expect(firstAgent.avgResponseTimeMs).toBe(1500);
      expect(firstAgent.queriesRaised).toBe(100);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should return empty data when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getAgentMetrics(agentQuery, adminUser);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should respect pagination parameters', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{ total: BigInt(1) }])
        .mockResolvedValueOnce([]);

      const result = await service.getAgentMetrics(
        { ...agentQuery, page: 2, limit: 10 },
        adminUser,
      );

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
    });
  });

  // ==========================================
  // ==========================================
  // Export Log (Story 8-11, AC: 6)
  // ==========================================

  describe('logExport', () => {
    const exportBody = {
      format: 'csv' as const,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    };

    it('should create audit log entry with correct data for admin user', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({ id: 'log-1' });

      const result = await service.logExport(exportBody, adminUser);

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: adminUser.id,
          clerkId: adminUser.clerkId,
          contextId: adminUser.organizationId,
          organizationId: adminUser.organizationId,
          event: 'ANALYTICS_EXPORT',
          data: {
            format: 'csv',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
        },
      });
    });

    it('should create audit log entry for client user', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({ id: 'log-2' });

      const result = await service.logExport(exportBody, clientUser);

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: clientUser.id,
          clerkId: clientUser.clerkId,
          contextId: clientUser.organizationId,
          organizationId: clientUser.organizationId,
          event: 'ANALYTICS_EXPORT',
          data: {
            format: 'csv',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
        },
      });
    });

    it('should use userId as contextId when organizationId is null', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({ id: 'log-3' });

      await service.logExport(exportBody, superAdminUser);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contextId: superAdminUser.id,
        }),
      });
    });

    it('should log json format correctly', async () => {
      const jsonBody = { ...exportBody, format: 'json' as const };
      mockPrismaService.auditLog.create.mockResolvedValue({ id: 'log-4' });

      await service.logExport(jsonBody, adminUser);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          data: expect.objectContaining({ format: 'json' }),
        }),
      });
    });
  });

  // ==========================================
  // Voice Analytics — getVoiceSummary (Story 10-14, AC: 4, 7, 8)
  // ==========================================

  describe('getVoiceSummary', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return correct voice summary with counts and ratios', async () => {
      // current period voice metrics + previous period voice metrics (called in parallel)
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{
          voice_count: BigInt(30),
          text_count: BigInt(70),
          avg_stt_latency: 450.5,
          avg_tts_latency: 800.3,
          error_count: BigInt(2),
        }])
        .mockResolvedValueOnce([{
          voice_count: BigInt(20),
          text_count: BigInt(80),
          avg_stt_latency: 500,
          avg_tts_latency: 900,
          error_count: BigInt(1),
        }]);

      const result = await service.getVoiceSummary(baseQuery, adminUser);

      expect(result.totalVoiceMessages).toBe(30);
      expect(result.totalTextMessages).toBe(70);
      expect(result.voiceRatio).toBe(0.3);
      expect(result.avgSttLatencyMs).toBe(451);
      expect(result.avgTtsLatencyMs).toBe(800);
      expect(result.voiceErrorCount).toBe(2);
      expect(result.trend.voiceMessagesTrend).toBe(50); // 30 vs 20 = +50%
    });

    it('should return zeros when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getVoiceSummary(baseQuery, adminUser);

      expect(result.totalVoiceMessages).toBe(0);
      expect(result.totalTextMessages).toBe(0);
      expect(result.voiceRatio).toBe(0);
      expect(result.avgSttLatencyMs).toBe(0);
      expect(result.avgTtsLatencyMs).toBe(0);
      expect(result.voiceErrorCount).toBe(0);
      expect(result.trend.voiceMessagesTrend).toBe(0);
    });

    it('should return zeros when no voice messages exist', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{
          voice_count: BigInt(0),
          text_count: BigInt(50),
          avg_stt_latency: null,
          avg_tts_latency: null,
          error_count: BigInt(0),
        }])
        .mockResolvedValueOnce([{
          voice_count: BigInt(0),
          text_count: BigInt(40),
          avg_stt_latency: null,
          avg_tts_latency: null,
          error_count: BigInt(0),
        }]);

      const result = await service.getVoiceSummary(baseQuery, adminUser);

      expect(result.totalVoiceMessages).toBe(0);
      expect(result.voiceRatio).toBe(0);
      expect(result.avgSttLatencyMs).toBe(0);
    });

    it('should respect tenant isolation for CLIENT users', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([{ voice_count: BigInt(5), text_count: BigInt(10), avg_stt_latency: 300, avg_tts_latency: 600, error_count: BigInt(0) }])
        .mockResolvedValueOnce([{ voice_count: BigInt(3), text_count: BigInt(8), avg_stt_latency: 350, avg_tts_latency: 650, error_count: BigInt(0) }]);

      await service.getVoiceSummary(baseQuery, clientUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ organizationId: orgId }),
        select: { id: true },
      });
    });
  });

  // ==========================================
  // Voice Analytics — getLanguageDistribution (Story 10-14, AC: 5, 7, 8)
  // ==========================================

  describe('getLanguageDistribution', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return language distribution with percentages', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { language: 'hi', count: BigInt(60) },
        { language: 'en', count: BigInt(30) },
        { language: 'mr', count: BigInt(10) },
      ]);

      const result = await service.getLanguageDistribution(baseQuery, adminUser);

      expect(result.languages).toHaveLength(3);
      expect(result.languages[0]).toEqual({ language: 'hi', count: 60, percentage: 60 });
      expect(result.languages[1]).toEqual({ language: 'en', count: 30, percentage: 30 });
      expect(result.languages[2]).toEqual({ language: 'mr', count: 10, percentage: 10 });
    });

    it('should return empty array when no voice messages exist', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getLanguageDistribution(baseQuery, adminUser);

      expect(result.languages).toEqual([]);
    });

    it('should return empty when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getLanguageDistribution(baseQuery, adminUser);

      expect(result.languages).toEqual([]);
    });
  });

  // ==========================================
  // Voice Analytics — getVoiceLatencyByProvider (Story 10-14, AC: 6, 7, 8)
  // ==========================================

  describe('getVoiceLatencyByProvider', () => {
    beforeEach(() => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
    });

    it('should return STT and TTS latency by provider with P50/P95', async () => {
      // Four parallel queries: STT by-provider, TTS by-provider, STT aggregate, TTS aggregate.
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([
          { provider: 'sarvam', avg: 450, p50: 400, p95: 800, count: BigInt(50) },
          { provider: 'deepgram', avg: 300, p50: 250, p95: 600, count: BigInt(30) },
        ])
        .mockResolvedValueOnce([
          { provider: 'sarvam', avg: 700, p50: 650, p95: 1200, count: BigInt(40) },
          { provider: 'elevenlabs', avg: 500, p50: 450, p95: 900, count: BigInt(25) },
        ])
        .mockResolvedValueOnce([{ avg: 393, p50: 380, p95: 760, count: BigInt(80) }])
        .mockResolvedValueOnce([{ avg: 623, p50: 600, p95: 1100, count: BigInt(65) }]);

      const result = await service.getVoiceLatencyByProvider(baseQuery, adminUser);

      expect(result.stt).toHaveLength(2);
      expect(result.stt[0]).toEqual({ provider: 'sarvam', avg: 450, p50: 400, p95: 800, count: 50 });
      expect(result.stt[1]).toEqual({ provider: 'deepgram', avg: 300, p50: 250, p95: 600, count: 30 });

      expect(result.tts).toHaveLength(2);
      expect(result.tts[0]).toEqual({ provider: 'sarvam', avg: 700, p50: 650, p95: 1200, count: 40 });
      expect(result.tts[1]).toEqual({ provider: 'elevenlabs', avg: 500, p50: 450, p95: 900, count: 25 });

      // Provider-agnostic aggregates (what the client renders)
      expect(result.sttAggregate).toEqual({ avg: 393, p50: 380, p95: 760, count: 80 });
      expect(result.ttsAggregate).toEqual({ avg: 623, p50: 600, p95: 1100, count: 65 });
    });

    it('should return empty arrays when no agents found', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);

      const result = await service.getVoiceLatencyByProvider(baseQuery, adminUser);

      expect(result.stt).toEqual([]);
      expect(result.tts).toEqual([]);
    });

    it('should return empty arrays and null aggregates when no voice latency data exists', async () => {
      // by-provider queries return no rows; the aggregate queries always return
      // a single row (with count 0) — mapAggregate turns that into null.
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ avg: null, p50: null, p95: null, count: BigInt(0) }])
        .mockResolvedValueOnce([{ avg: null, p50: null, p95: null, count: BigInt(0) }]);

      const result = await service.getVoiceLatencyByProvider(baseQuery, adminUser);

      expect(result.stt).toEqual([]);
      expect(result.tts).toEqual([]);
      expect(result.sttAggregate).toBeNull();
      expect(result.ttsAggregate).toBeNull();
    });
  });

  // ==========================================
  // Voice Analytics — Error Cases (Story 10-14)
  // ==========================================

  describe('voice analytics error cases', () => {
    it('should throw ForbiddenException for CLIENT without organization on voice endpoints', async () => {
      await expect(service.getVoiceSummary(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getLanguageDistribution(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getVoiceLatencyByProvider(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
    });
  });

  // Error Cases (AC: 14)
  // ==========================================

  describe('error cases', () => {
    it('should throw ForbiddenException for CLIENT without organization on all endpoints', async () => {
      await expect(service.getSummary(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getConversationsChart(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getResponseTimeDistribution(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getMessageVolumeHeatmap(baseQuery, clientUserNoOrg)).rejects.toThrow(ForbiddenException);
      await expect(service.getAgentMetrics(
        { ...baseQuery, page: 1, limit: 20, sortBy: 'conversations', sortOrder: 'desc' },
        clientUserNoOrg,
      )).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getHandoverMetrics', () => {
    it('returns zeros and skips SQL when the user has no agents', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      const res = await service.getHandoverMetrics(baseQuery, clientUser);
      expect(res.totalHandovers).toBe(0);
      expect(res.handoverRate).toBe(0);
      expect(res.reasons).toEqual([]);
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('computes rates, resolution split, reasons and timings', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([{ id: agentId1 }]);
      mockPrismaService.$queryRaw
        // 1) handover aggregation
        .mockResolvedValueOnce([
          {
            total: BigInt(10),
            taken_over: BigInt(6),
            resolved_human: BigInt(5),
            auto_resolved: BigInt(3),
            abandoned: BigInt(2),
            swept_after_takeover: BigInt(1),
            r_user: BigInt(7),
            r_fallback: BigInt(1),
            r_frustration: BigInt(2),
            r_manual: BigInt(0),
            avg_wait_ms: 12000,
            avg_handle_ms: 300000,
          },
        ])
        // 2) getSessionMetrics (for the handover rate denominator)
        .mockResolvedValueOnce([
          { total_conversations: BigInt(100), total_users: BigInt(50), returning_users: BigInt(10) },
        ]);

      const res = await service.getHandoverMetrics(baseQuery, clientUser);

      expect(res.totalHandovers).toBe(10);
      expect(res.totalConversations).toBe(100);
      expect(res.handoverRate).toBe(10); // 10 / 100
      expect(res.takenOver).toBe(6);
      expect(res.takenOverRate).toBe(60); // 6 / 10
      expect(res.resolvedByHuman).toBe(5);
      expect(res.autoResolved).toBe(3);
      expect(res.abandoned).toBe(2);
      expect(res.sweptAfterTakeover).toBe(1);
      expect(res.avgWaitMs).toBe(12000);
      expect(res.avgHandleMs).toBe(300000);
      // MANUAL (count 0) is dropped; the rest carry their share of the total.
      expect(res.reasons).toEqual([
        { reason: 'USER_REQUESTED', count: 7, percentage: 70 },
        { reason: 'BOT_FALLBACK', count: 1, percentage: 10 },
        { reason: 'FRUSTRATION', count: 2, percentage: 20 },
      ]);
    });
  });
});
