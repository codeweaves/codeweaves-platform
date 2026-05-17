import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ConversationsService } from '../../../src/services/conversations.service';
import { PrismaService } from '../../../src/services/prisma.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockPrisma = {
    agent: { findMany: jest.fn() },
    chatSession: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    chatTrace: { findMany: jest.fn() },
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const otherOrgId = '223e4567-e89b-12d3-a456-426614174000';
  const agentId1 = '333e4567-e89b-12d3-a456-426614174000';

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
    auth0Id: 'auth0|super',
    email: 'super@test.com',
    roles: ['SUPER_ADMIN'],
    id: 'super-user-id',
    role: Role.SUPER_ADMIN,
    organizationId: null,
    organization: null,
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

  const clientNoOrg: CurrentUserData = {
    auth0Id: 'auth0|client-no-org',
    email: 'client-no-org@test.com',
    roles: ['CLIENT'],
    id: 'client-no-org-id',
    role: Role.CLIENT,
    organizationId: null,
    organization: null,
  };

  const baseQuery = {
    page: 1,
    limit: 20,
    sortBy: 'lastMessageAt' as const,
    sortOrder: 'desc' as const,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // list — tenant scoping
  // ============================================================

  describe('list — tenant scoping', () => {
    beforeEach(() => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      mockPrisma.chatSession.count.mockResolvedValue(0);
    });

    it('scopes CLIENT to own org via the agent relation filter', async () => {
      await service.list(baseQuery, clientUser);

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agent: { deletedAt: null, organizationId: orgId },
          }),
        }),
      );
    });

    it('throws ForbiddenException for CLIENT without organizationId', async () => {
      await expect(service.list(baseQuery, clientNoOrg)).rejects.toThrow(ForbiddenException);
    });

    it('applies a deletedAt: null relation filter for ADMIN with no other filters', async () => {
      await service.list(baseQuery, adminUser);

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agent: { deletedAt: null },
          }),
        }),
      );
      // No agentId IN filter when no per-agent narrowing was requested
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ agentId: expect.anything() }),
        }),
      );
    });

    it('narrows ADMIN by orgId on the agent relation when supplied', async () => {
      await service.list({ ...baseQuery, orgId: otherOrgId }, adminUser);

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agent: { deletedAt: null, organizationId: otherOrgId },
          }),
        }),
      );
    });

    it('layers agentId IN filter on top of the relation scope when caller picks an agent', async () => {
      await service.list({ ...baseQuery, agentId: agentId1 }, clientUser);

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agent: { deletedAt: null, organizationId: orgId },
            agentId: { in: [agentId1] },
          }),
        }),
      );
    });

    it('applies deletedAt: null only for SUPER_ADMIN with no other filters', async () => {
      await service.list(baseQuery, superAdminUser);

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agent: { deletedAt: null } }),
        }),
      );
    });

    it('does not call agent.findMany — scoping is a single relation filter', async () => {
      await service.list(baseQuery, clientUser);
      expect(mockPrisma.agent.findMany).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // list — filtering and sorting
  // ============================================================

  describe('list — filters and sorting', () => {
    beforeEach(() => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      mockPrisma.chatSession.count.mockResolvedValue(0);
    });

    it('applies source filter', async () => {
      await service.list({ ...baseQuery, source: 'WIDGET' }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source: 'WIDGET' }),
        }),
      );
    });

    it('applies multi-source filter', async () => {
      await service.list({ ...baseQuery, sources: ['WIDGET', 'WHATSAPP'] }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source: { in: ['WIDGET', 'WHATSAPP'] } }),
        }),
      );
    });

    it('applies status filter', async () => {
      await service.list({ ...baseQuery, status: 'EXPIRED' }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });

    it('applies multi-status filter', async () => {
      await service.list({ ...baseQuery, statuses: ['ACTIVE', 'EXPIRED'] }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['ACTIVE', 'EXPIRED'] } }),
        }),
      );
    });

    it('applies date range filter', async () => {
      const from = '2026-05-01T00:00:00.000Z';
      const to = '2026-05-31T23:59:59.999Z';
      await service.list({ ...baseQuery, from, to }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(from), lte: new Date(to) },
          }),
        }),
      );
    });

    it('applies search across title, summary, and message content', async () => {
      await service.list({ ...baseQuery, search: 'refund' }, clientUser);
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.OR).toEqual([
        { title: { contains: 'refund', mode: 'insensitive' } },
        { summary: { contains: 'refund', mode: 'insensitive' } },
        { messages: { some: { content: { contains: 'refund', mode: 'insensitive' } } } },
      ]);
    });

    it('sorts by messageCount via _count relation', async () => {
      await service.list({ ...baseQuery, sortBy: 'messageCount', sortOrder: 'asc' }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { messages: { _count: 'asc' } } }),
      );
    });

    it('sorts by createdAt directly when requested', async () => {
      await service.list({ ...baseQuery, sortBy: 'createdAt', sortOrder: 'asc' }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });

    it('sorts by lastMessageAt with NULLS LAST so empty/errored sessions stay at the bottom', async () => {
      await service.list(baseQuery, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        }),
      );
    });

    it('respects sortOrder for lastMessageAt while keeping NULLS LAST', async () => {
      await service.list({ ...baseQuery, sortOrder: 'asc' }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastMessageAt: { sort: 'asc', nulls: 'last' } },
        }),
      );
    });

    it('paginates with skip/take', async () => {
      await service.list({ ...baseQuery, page: 3, limit: 10 }, clientUser);
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ============================================================
  // list — response shape
  // ============================================================

  describe('list — response shape', () => {
    it('maps rows and meta correctly', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        {
          id: 's1',
          sessionId: 'sess_1',
          source: 'WIDGET',
          visitorId: '1.2.3.4',
          status: 'ACTIVE',
          title: 'Pricing',
          createdAt: new Date('2026-05-10T10:00:00.000Z'),
          lastMessageAt: new Date('2026-05-10T10:05:00.000Z'),
          agent: { id: agentId1, name: 'Agent A', organizationId: orgId },
          _count: { messages: 6 },
        },
      ]);
      mockPrisma.chatSession.count.mockResolvedValue(1);

      const result = await service.list(baseQuery, clientUser);

      expect(result.data).toEqual([
        {
          id: 's1',
          sessionId: 'sess_1',
          agent: { id: agentId1, name: 'Agent A' },
          organizationId: orgId,
          source: 'WIDGET',
          status: 'ACTIVE',
          visitorId: '1.2.3.4',
          title: 'Pricing',
          messageCount: 6,
          createdAt: '2026-05-10T10:00:00.000Z',
          lastMessageAt: '2026-05-10T10:05:00.000Z',
          lastActivityAt: '2026-05-10T10:05:00.000Z',
        },
      ]);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('handles null lastMessageAt', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        {
          id: 's1',
          sessionId: 'sess_1',
          source: 'DEMO',
          visitorId: null,
          status: 'ACTIVE',
          title: null,
          createdAt: new Date('2026-05-10T10:00:00.000Z'),
          lastMessageAt: null,
          agent: { id: agentId1, name: 'Agent A', organizationId: orgId },
          _count: { messages: 0 },
        },
      ]);
      mockPrisma.chatSession.count.mockResolvedValue(1);

      const result = await service.list(baseQuery, clientUser);
      expect(result.data[0]!.lastMessageAt).toBeNull();
      expect(result.data[0]!.title).toBeNull();
      // lastActivityAt falls back to createdAt so the UI never renders a null timestamp
      expect(result.data[0]!.lastActivityAt).toBe('2026-05-10T10:00:00.000Z');
    });
  });

  // ============================================================
  // getBySessionId
  // ============================================================

  describe('getBySessionId', () => {
    const baseSession = {
      id: 's1',
      sessionId: 'sess_1',
      source: 'WIDGET',
      visitorId: '1.2.3.4',
      status: 'ACTIVE',
      title: 'Pricing',
      summary: null,
      createdAt: new Date('2026-05-10T10:00:00.000Z'),
      updatedAt: new Date('2026-05-10T10:05:00.000Z'),
      lastMessageAt: new Date('2026-05-10T10:05:00.000Z'),
      agent: {
        id: agentId1,
        name: 'Agent A',
        organizationId: orgId,
        organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
      },
      messages: [
        {
          id: 'm1',
          role: 'USER',
          content: 'Hi',
          metadata: null,
          createdAt: new Date('2026-05-10T10:00:00.000Z'),
        },
        {
          id: 'm2',
          role: 'ASSISTANT',
          content: 'Hello!',
          metadata: { responseLatencyMs: 1200 },
          createdAt: new Date('2026-05-10T10:00:02.000Z'),
        },
      ],
    };

    it('returns mapped session with messages and traces', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(baseSession);
      mockPrisma.chatTrace.findMany.mockResolvedValue([
        {
          id: 't1',
          traceId: 't_abc',
          messageId: 'm2',
          model: 'gpt-4',
          steps: [],
          startedAt: new Date('2026-05-10T10:00:00.500Z'),
          completedAt: new Date('2026-05-10T10:00:02.000Z'),
          totalDurationMs: 1500,
          success: true,
          errorMessage: null,
        },
      ]);

      const result = await service.getBySessionId('sess_1', clientUser);

      expect(result.sessionId).toBe('sess_1');
      expect(result.agent.id).toBe(agentId1);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]!.role).toBe('USER');
      expect(result.messages[1]!.role).toBe('ASSISTANT');
      expect(result.traces).toHaveLength(1);
      expect(result.traces[0]!.messageId).toBe('m2');
      expect(result.traces[0]!.startedAt).toBe('2026-05-10T10:00:00.500Z');
    });

    it('queries ChatTrace by session.sessionId, not session.id', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(baseSession);
      mockPrisma.chatTrace.findMany.mockResolvedValue([]);

      await service.getBySessionId('sess_1', clientUser);

      expect(mockPrisma.chatTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'sess_1' } }),
      );
    });

    it('throws NotFoundException when session does not exist', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(null);

      await expect(service.getBySessionId('nope', clientUser)).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup with sessionId AND tenant + soft-delete filter for CLIENT', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(null);

      await expect(service.getBySessionId('sess_1', clientUser)).rejects.toThrow(NotFoundException);

      expect(mockPrisma.chatSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sessionId: 'sess_1',
            agent: { deletedAt: null, organizationId: orgId },
          },
        }),
      );
    });

    it('hides cross-tenant sessions from CLIENT users (db lookup returns null → NotFound)', async () => {
      // With the relation filter baked into the query, a CLIENT looking at
      // a session in another org gets zero rows back — no in-memory check
      // needed.
      mockPrisma.chatSession.findFirst.mockResolvedValue(null);

      await expect(service.getBySessionId('sess_1', clientUser)).rejects.toThrow(NotFoundException);
    });

    it('hides sessions of soft-deleted agents from ADMIN unrestricted (db returns null → NotFound)', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(null);

      await expect(service.getBySessionId('sess_1', adminUser)).rejects.toThrow(NotFoundException);

      expect(mockPrisma.chatSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'sess_1', agent: { deletedAt: null } },
        }),
      );
    });

    it('allows ADMIN to read sessions in any org (no organizationId filter on agent)', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue({
        ...baseSession,
        agent: {
          ...baseSession.agent,
          organizationId: otherOrgId,
          organization: { id: otherOrgId, name: 'Other', slug: 'other' },
        },
      });
      mockPrisma.chatTrace.findMany.mockResolvedValue([]);

      const result = await service.getBySessionId('sess_1', adminUser);
      expect(result.sessionId).toBe('sess_1');
      expect(mockPrisma.chatSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'sess_1', agent: { deletedAt: null } },
        }),
      );
    });

    it('allows SUPER_ADMIN to read sessions in any org', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue({
        ...baseSession,
        agent: {
          ...baseSession.agent,
          organizationId: otherOrgId,
          organization: { id: otherOrgId, name: 'Other', slug: 'other' },
        },
      });
      mockPrisma.chatTrace.findMany.mockResolvedValue([]);

      const result = await service.getBySessionId('sess_1', superAdminUser);
      expect(result.sessionId).toBe('sess_1');
    });

    it('throws ForbiddenException for CLIENT without organizationId', async () => {
      await expect(service.getBySessionId('sess_1', clientNoOrg)).rejects.toThrow(ForbiddenException);
    });
  });
});
