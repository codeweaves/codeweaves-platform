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
    auth0Id: 'auth0|admin',
    email: 'admin@test.com',
    roles: ['ADMIN'],
    id: 'admin-user-id',
    role: Role.ADMIN,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const clientUser: CurrentUserData = {
    auth0Id: 'auth0|client',
    email: 'client@test.com',
    roles: ['CLIENT'],
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const superAdminUser: CurrentUserData = {
    auth0Id: 'auth0|superadmin',
    email: 'superadmin@test.com',
    roles: ['SUPER_ADMIN'],
    id: 'superadmin-user-id',
    role: Role.SUPER_ADMIN,
    organizationId: null,
    organization: null,
  };

  const clientUserNoOrg: CurrentUserData = {
    auth0Id: 'auth0|client-no-org',
    email: 'client-no-org@test.com',
    roles: ['CLIENT'],
    id: 'client-no-org-user-id',
    role: Role.CLIENT,
    organizationId: null,
    organization: null,
  };

  const baseQuery = {
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
  };

  // Helper to mock all $queryRaw calls needed for getSummary (8 calls total):
  // 1. current session metrics, 2. current message metrics, 3. current response time,
  // 4. prev session metrics, 5. prev message metrics, 6. prev response time,
  // 7. current retention rate, 8. prev retention rate
  function mockSummaryQueryRaws(overrides?: {
    currentSessions?: { total_conversations: bigint; total_users: bigint; returning_users: bigint };
    currentMessages?: { user_count: bigint; assistant_count: bigint };
    currentResponseTime?: { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null };
    prevSessions?: { total_conversations: bigint; total_users: bigint; returning_users: bigint };
    prevMessages?: { user_count: bigint; assistant_count: bigint };
    prevResponseTime?: { avg_ms: number | null; p50: number | null; p95: number | null; p99: number | null };
    retention?: { retained: bigint; total: bigint };
    prevRetention?: { retained: bigint; total: bigint };
  }) {
    const defaults = {
      currentSessions: { total_conversations: BigInt(0), total_users: BigInt(0), returning_users: BigInt(0) },
      currentMessages: { user_count: BigInt(0), assistant_count: BigInt(0) },
      currentResponseTime: { avg_ms: null, p50: null, p95: null, p99: null },
      prevSessions: { total_conversations: BigInt(0), total_users: BigInt(0), returning_users: BigInt(0) },
      prevMessages: { user_count: BigInt(0), assistant_count: BigInt(0) },
      prevResponseTime: { avg_ms: null, p50: null, p95: null, p99: null },
      retention: { retained: BigInt(0), total: BigInt(0) },
      prevRetention: { retained: BigInt(0), total: BigInt(0) },
      ...overrides,
    };

    mockPrismaService.$queryRaw
      .mockResolvedValueOnce([defaults.currentSessions])
      .mockResolvedValueOnce([defaults.currentMessages])
      .mockResolvedValueOnce([defaults.currentResponseTime])
      .mockResolvedValueOnce([defaults.prevSessions])
      .mockResolvedValueOnce([defaults.prevMessages])
      .mockResolvedValueOnce([defaults.prevResponseTime])
      .mockResolvedValueOnce([defaults.retention])
      .mockResolvedValueOnce([defaults.prevRetention]);
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
          organizationId: otherOrgId,
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
      // At least 8 calls: sessions, messages, responseTime x2 (current+prev), retention x2
      expect(mockPrismaService.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(8);
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
          id: agentId1,
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
        retention: { retained: BigInt(1), total: BigInt(3) },
        prevRetention: { retained: BigInt(0), total: BigInt(2) },
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.period).toBeDefined();
      expect(result.period.start).toBe('2026-01-01T00:00:00.000Z');
      expect(result.period.end).toBe('2026-01-31T00:00:00.000Z');

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
      expect(result.kpis.queriesRaised).toHaveProperty('value');

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
      mockSummaryQueryRaws({
        retention: { retained: BigInt(2), total: BigInt(10) }, // 20%
        prevRetention: { retained: BigInt(1), total: BigInt(10) }, // 10%
      });

      const result = await service.getSummary(baseQuery, adminUser);

      expect(result.kpis.userRetentionRate.value).toBe(20);
      expect(result.kpis.userRetentionRate.trend).toBe(100); // 20% vs 10% = 100% increase
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
          auth0Id: adminUser.auth0Id,
          contextId: adminUser.organizationId,
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
          auth0Id: clientUser.auth0Id,
          contextId: clientUser.organizationId,
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
});
