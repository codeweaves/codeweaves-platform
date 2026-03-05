import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AnalyticsController } from '../../../src/controllers/analytics/analytics.controller';
import { AnalyticsService } from '../../../src/services/analytics.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import { ZodValidationPipe } from '../../../src/pipes/zod-validation.pipe';
import {
  analyticsQuerySchema,
  agentAnalyticsQuerySchema,
  exportLogBodySchema,
} from '../../../src/models/analytics.dto';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { Role } from '@prisma/client';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;

  const mockAnalyticsService = {
    getSummary: jest.fn(),
    getConversationsChart: jest.fn(),
    getResponseTimeDistribution: jest.fn(),
    getMessageVolumeHeatmap: jest.fn(),
    getAgentMetrics: jest.fn(),
    logExport: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  const adminUser: CurrentUserData = {
    auth0Id: 'auth0|admin',
    email: 'admin@test.com',
    roles: ['ADMIN'],
    id: 'admin-user-id',
    role: Role.ADMIN,
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

  const mockRes = {
    set: jest.fn(),
  } as unknown as import('express').Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================
  // Role Authorization Tests (AC: 13)
  // ==========================================

  describe('role authorization', () => {
    it('should have ADMIN, SUPER_ADMIN, CLIENT roles on controller class', () => {
      const roles = Reflect.getMetadata('roles', AnalyticsController);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'CLIENT']);
    });
  });

  // ==========================================
  // Summary Endpoint (AC: 1-7)
  // ==========================================

  describe('getSummary', () => {
    const query = {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
    };

    const mockSummary = {
      period: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-31T00:00:00.000Z' },
      kpis: {
        totalUsers: { value: 100, trend: 10 },
        newUsers: { value: 50, trend: 5 },
        returningUsers: { value: 50, trend: 5 },
        totalConversations: { value: 200, trend: 15 },
        totalMessagesSent: { value: 500, trend: 20 },
        totalMessagesReceived: { value: 480, trend: 18 },
        totalMessagesExchanged: { value: 980, trend: 19 },
        userRetentionRate: { value: 25.5, trend: 0 },
        userGrowthRate: { value: 10, trend: 0 },
        avgResponseTimeMs: { value: 1500, trend: -5 },
        p50ResponseTimeMs: { value: 1200 },
        p95ResponseTimeMs: { value: 3000 },
        p99ResponseTimeMs: { value: 5000 },
        queriesRaised: { value: 500, trend: 20 },
      },
    };

    it('should return summary data', async () => {
      mockAnalyticsService.getSummary.mockResolvedValue(mockSummary);

      const result = await controller.getSummary(query, adminUser, mockRes);

      expect(result).toEqual(mockSummary);
      expect(mockAnalyticsService.getSummary).toHaveBeenCalledWith(query, adminUser);
    });

    it('should set Cache-Control header', async () => {
      mockAnalyticsService.getSummary.mockResolvedValue(mockSummary);

      await controller.getSummary(query, adminUser, mockRes);

      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    });

    it('should pass agentId filter to service', async () => {
      const queryWithAgent = { ...query, agentId };
      mockAnalyticsService.getSummary.mockResolvedValue(mockSummary);

      await controller.getSummary(queryWithAgent, adminUser, mockRes);

      expect(mockAnalyticsService.getSummary).toHaveBeenCalledWith(queryWithAgent, adminUser);
    });

    it('should pass orgId filter to service', async () => {
      const queryWithOrg = { ...query, orgId };
      mockAnalyticsService.getSummary.mockResolvedValue(mockSummary);

      await controller.getSummary(queryWithOrg, superAdminUser, mockRes);

      expect(mockAnalyticsService.getSummary).toHaveBeenCalledWith(queryWithOrg, superAdminUser);
    });
  });

  // ==========================================
  // Chart Endpoints (AC: 8-10)
  // ==========================================

  describe('getConversationsChart', () => {
    const query = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') };
    const mockChart = { data: [{ date: '2026-01-01', count: 10 }] };

    it('should return conversations chart data', async () => {
      mockAnalyticsService.getConversationsChart.mockResolvedValue(mockChart);

      const result = await controller.getConversationsChart(query, adminUser, mockRes);

      expect(result).toEqual(mockChart);
      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    });
  });

  describe('getResponseTimeDistribution', () => {
    const query = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') };
    const mockDistribution = {
      buckets: [{ label: '<1s', min: 0, max: 1000, count: 50, percentage: 50 }],
      percentiles: { p50: 800, p95: 2500, p99: 5000 },
    };

    it('should return response time distribution', async () => {
      mockAnalyticsService.getResponseTimeDistribution.mockResolvedValue(mockDistribution);

      const result = await controller.getResponseTimeDistribution(query, adminUser, mockRes);

      expect(result).toEqual(mockDistribution);
      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    });
  });

  describe('getMessageVolumeHeatmap', () => {
    const query = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') };
    const mockHeatmap = { data: [{ day: 0, hour: 9, count: 15 }] };

    it('should return message volume heatmap data', async () => {
      mockAnalyticsService.getMessageVolumeHeatmap.mockResolvedValue(mockHeatmap);

      const result = await controller.getMessageVolumeHeatmap(query, adminUser, mockRes);

      expect(result).toEqual(mockHeatmap);
      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    });
  });

  // ==========================================
  // Agent Metrics Endpoint (AC: 11)
  // ==========================================

  describe('getAgentMetrics', () => {
    const query = {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      page: 1,
      limit: 20,
      sortBy: 'conversations' as const,
      sortOrder: 'desc' as const,
    };

    const mockMetrics = {
      data: [{
        agentId,
        agentName: 'Test Agent',
        conversations: 50,
        messages: 200,
        avgResponseTimeMs: 1500,
        queriesRaised: 100,
      }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };

    it('should return paginated agent metrics', async () => {
      mockAnalyticsService.getAgentMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getAgentMetrics(query, adminUser, mockRes);

      expect(result).toEqual(mockMetrics);
      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
    });

    it('should pass pagination and sort params to service', async () => {
      const customQuery = { ...query, page: 2, limit: 10, sortBy: 'messages' as const, sortOrder: 'asc' as const };
      mockAnalyticsService.getAgentMetrics.mockResolvedValue(mockMetrics);

      await controller.getAgentMetrics(customQuery, adminUser, mockRes);

      expect(mockAnalyticsService.getAgentMetrics).toHaveBeenCalledWith(customQuery, adminUser);
    });
  });

  // ==========================================
  // Export Log Endpoint (Story 8-11, AC: 6)
  // ==========================================

  describe('logExport', () => {
    const exportBody = {
      format: 'csv' as const,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    };

    it('should call analyticsService.logExport with body and user', async () => {
      mockAnalyticsService.logExport.mockResolvedValue({ success: true });

      const result = await controller.logExport(exportBody, adminUser);

      expect(result).toEqual({ success: true });
      expect(mockAnalyticsService.logExport).toHaveBeenCalledWith(exportBody, adminUser);
    });

    it('should work for CLIENT role users', async () => {
      const clientUser: CurrentUserData = {
        auth0Id: 'auth0|client',
        email: 'client@test.com',
        roles: ['CLIENT'],
        id: 'client-user-id',
        role: Role.CLIENT,
        organizationId: orgId,
        organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
      };
      mockAnalyticsService.logExport.mockResolvedValue({ success: true });

      const result = await controller.logExport(exportBody, clientUser);

      expect(result).toEqual({ success: true });
      expect(mockAnalyticsService.logExport).toHaveBeenCalledWith(exportBody, clientUser);
    });

    it('should accept json format', async () => {
      const jsonBody = { ...exportBody, format: 'json' as const };
      mockAnalyticsService.logExport.mockResolvedValue({ success: true });

      await controller.logExport(jsonBody, adminUser);

      expect(mockAnalyticsService.logExport).toHaveBeenCalledWith(jsonBody, adminUser);
    });
  });

  // ==========================================
  // Validation Tests (AC: 12)
  // ==========================================

  describe('validation', () => {
    const queryPipe = new ZodValidationPipe(analyticsQuerySchema);
    const agentQueryPipe = new ZodValidationPipe(agentAnalyticsQuerySchema);

    it('should reject missing startDate', () => {
      expect(() => queryPipe.transform({ endDate: '2026-01-31' })).toThrow(BadRequestException);
    });

    it('should reject missing endDate', () => {
      expect(() => queryPipe.transform({ startDate: '2026-01-01' })).toThrow(BadRequestException);
    });

    it('should reject startDate after endDate', () => {
      expect(() =>
        queryPipe.transform({ startDate: '2026-02-01', endDate: '2026-01-01' }),
      ).toThrow(BadRequestException);
    });

    it('should accept valid date range', () => {
      const result = queryPipe.transform({ startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should accept optional agentId', () => {
      const result = queryPipe.transform({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        agentId: agentId,
      });
      expect(result.agentId).toBe(agentId);
    });

    it('should reject invalid agentId UUID', () => {
      expect(() =>
        queryPipe.transform({
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          agentId: 'not-a-uuid',
        }),
      ).toThrow(BadRequestException);
    });

    it('should accept optional orgId', () => {
      const result = queryPipe.transform({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        orgId: orgId,
      });
      expect(result.orgId).toBe(orgId);
    });

    it('should apply defaults for agent analytics query', () => {
      const result = agentQueryPipe.transform({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('conversations');
      expect(result.sortOrder).toBe('desc');
    });

    it('should accept custom pagination params', () => {
      const result = agentQueryPipe.transform({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        page: '2',
        limit: '10',
      });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    it('should reject invalid sortBy for agent analytics', () => {
      expect(() =>
        agentQueryPipe.transform({
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          sortBy: 'invalid',
        }),
      ).toThrow(BadRequestException);
    });

    it('should coerce date strings to Date objects', () => {
      const result = queryPipe.transform({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.999Z',
      });
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    // Export log body validation (Story 8-11)
    describe('exportLogBody', () => {
      const exportPipe = new ZodValidationPipe(exportLogBodySchema);

      it('should accept valid csv export body', () => {
        const result = exportPipe.transform({ format: 'csv', startDate: '2026-01-01', endDate: '2026-01-31' });
        expect(result.format).toBe('csv');
      });

      it('should accept valid json export body', () => {
        const result = exportPipe.transform({ format: 'json', startDate: '2026-01-01', endDate: '2026-01-31' });
        expect(result.format).toBe('json');
      });

      it('should reject invalid format', () => {
        expect(() =>
          exportPipe.transform({ format: 'xml', startDate: '2026-01-01', endDate: '2026-01-31' }),
        ).toThrow(BadRequestException);
      });

      it('should reject missing format', () => {
        expect(() =>
          exportPipe.transform({ startDate: '2026-01-01', endDate: '2026-01-31' }),
        ).toThrow(BadRequestException);
      });

      it('should reject missing startDate', () => {
        expect(() =>
          exportPipe.transform({ format: 'csv', endDate: '2026-01-31' }),
        ).toThrow(BadRequestException);
      });

      it('should reject empty startDate', () => {
        expect(() =>
          exportPipe.transform({ format: 'csv', startDate: '', endDate: '2026-01-31' }),
        ).toThrow(BadRequestException);
      });

      it('should strip extra fields', () => {
        const result = exportPipe.transform({
          format: 'csv', startDate: '2026-01-01', endDate: '2026-01-31', malicious: 'payload',
        });
        expect((result as Record<string, unknown>).malicious).toBeUndefined();
      });
    });
  });
});
