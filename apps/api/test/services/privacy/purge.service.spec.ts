import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PurgeService } from '../../../src/services/purge.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { SupabaseStorageService } from '../../../src/services/supabase-storage.service';

describe('PurgeService', () => {
  let service: PurgeService;

  const mockPrisma = {
    chatSession: { findMany: jest.fn(), deleteMany: jest.fn() },
    piiToken: { deleteMany: jest.fn(), count: jest.fn() },
    chatTrace: { deleteMany: jest.fn(), count: jest.fn() },
    llmUsage: { deleteMany: jest.fn(), count: jest.fn() },
    eventLog: { deleteMany: jest.fn(), count: jest.fn() },
    auditLog: { deleteMany: jest.fn() },
    organization: { findUnique: jest.fn(), delete: jest.fn() },
    agent: { findMany: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn(), deleteMany: jest.fn() },
    userInvitation: { deleteMany: jest.fn() },
    file: { findMany: jest.fn(), deleteMany: jest.fn() },
    collectedData: { findMany: jest.fn() },
  };
  const mockTracer = { logAuditEvent: jest.fn() };
  const mockStorage = { remove: jest.fn() };
  const mockCrypto = { decryptFieldValues: jest.fn() };

  const ORG = 'org-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTracer.logAuditEvent.mockResolvedValue(undefined);
    mockStorage.remove.mockResolvedValue(undefined);
    mockCrypto.decryptFieldValues.mockImplementation(
      (d: Record<string, unknown> | null | undefined) => d ?? {},
    );
    // Default: every deleteMany removes 0 rows; tests override what they need.
    for (const table of Object.values(mockPrisma)) {
      const t = table as Record<string, jest.Mock>;
      t.deleteMany?.mockResolvedValue({ count: 0 });
      t.findMany?.mockResolvedValue([]);
      t.count?.mockResolvedValue(0);
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        PurgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TracerService, useValue: mockTracer },
        { provide: SupabaseStorageService, useValue: mockStorage },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    service = moduleRef.get(PurgeService);
  });

  describe('eraseVisitor', () => {
    const sessions = [
      { id: 'db-1', sessionId: 'pub-1', agentId: 'agent-1' },
      { id: 'db-2', sessionId: 'pub-2', agentId: 'agent-2' },
    ];

    it('deletes the FK-less tables by session-id union, then the sessions', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue(sessions);
      mockPrisma.piiToken.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.chatTrace.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.llmUsage.deleteMany.mockResolvedValue({ count: 7 });
      mockPrisma.eventLog.deleteMany.mockResolvedValue({ count: 9 });
      mockPrisma.chatSession.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.eraseVisitor(ORG, 'vh_abc');

      const union = ['db-1', 'db-2', 'pub-1', 'pub-2'];
      expect(mockPrisma.piiToken.deleteMany).toHaveBeenCalledWith({
        where: { chatSessionId: { in: union } },
      });
      expect(mockPrisma.chatTrace.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: { in: union } },
      });
      expect(mockPrisma.llmUsage.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: { in: union } },
      });
      expect(mockPrisma.chatSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['db-1', 'db-2'] } },
      });
      expect(result).toEqual({
        visitorId: 'vh_abc',
        organizationId: ORG,
        sessions: 2,
        piiTokens: 3,
        chatTraces: 5,
        llmUsage: 7,
        eventLogs: 9,
      });
    });

    it('scopes the session lookup to the organization', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      await service.eraseVisitor(ORG, 'vh_abc');
      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith({
        where: { visitorId: 'vh_abc', agent: { organizationId: ORG } },
        select: { id: true, sessionId: true, agentId: true },
      });
    });

    it('org-scopes the direct visitorId match on event logs (same hash at another org survives)', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue(sessions);

      await service.eraseVisitor(ORG, 'vh_abc');

      const where = mockPrisma.eventLog.deleteMany.mock.calls[0]![0].where;
      // Every visitorId-based clause must carry an org/agent scope.
      const visitorClauses = where.OR.filter(
        (c: Record<string, unknown>) => 'visitorId' in c,
      );
      expect(visitorClauses.length).toBeGreaterThan(0);
      for (const clause of visitorClauses) {
        expect(
          'organizationId' in clause || 'agentId' in clause,
        ).toBe(true);
      }
    });

    it('is idempotent: unknown visitor → all-zero counts, no session delete', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);

      const result = await service.eraseVisitor(ORG, 'vh_unknown');

      expect(result.sessions).toBe(0);
      expect(result.piiTokens).toBe(0);
      expect(mockPrisma.chatSession.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.piiToken.deleteMany).not.toHaveBeenCalled();
    });

    it('writes a counts-only audit record (no PII)', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue(sessions);

      await service.eraseVisitor(ORG, 'vh_abc');

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        ORG,
        'PRIVACY_VISITOR_ERASED',
        expect.not.objectContaining({ visitorId: expect.anything() }),
        { organizationId: ORG },
      );
    });
  });

  describe('summarizeVisitor', () => {
    it('returns sessions, decrypted collected data and record counts', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        {
          id: 'db-1',
          sessionId: 'pub-1',
          source: 'WIDGET',
          status: 'ACTIVE',
          createdAt: new Date('2026-07-01'),
          _count: { messages: 6 },
        },
      ]);
      mockPrisma.collectedData.findMany.mockResolvedValue([
        {
          chatSessionId: 'db-1',
          data: { email: 'enc:v1:x' },
          extractedAt: new Date('2026-07-02'),
        },
      ]);
      mockCrypto.decryptFieldValues.mockReturnValue({ email: 'a@b.com' });
      mockPrisma.chatTrace.count.mockResolvedValue(4);
      mockPrisma.eventLog.count.mockResolvedValue(8);
      mockPrisma.piiToken.count.mockResolvedValue(2);
      mockPrisma.llmUsage.count.mockResolvedValue(5);

      const summary = await service.summarizeVisitor(ORG, 'vh_abc');

      expect(summary.sessions).toEqual([
        expect.objectContaining({ sessionId: 'pub-1', messageCount: 6 }),
      ]);
      expect(summary.totalMessages).toBe(6);
      // The lead fields come back decrypted for the data principal…
      expect(summary.collectedData).toEqual([
        expect.objectContaining({
          sessionId: 'pub-1',
          fields: { email: 'a@b.com' },
        }),
      ]);
      expect(mockCrypto.decryptFieldValues).toHaveBeenCalledWith({ email: 'enc:v1:x' });
      expect(summary.recordCounts).toEqual({
        aiTraces: 4,
        eventLogs: 8,
        piiTokens: 2,
        llmUsage: 5,
      });
      expect(summary.processingPurposes.length).toBeGreaterThan(0);
    });

    it('scopes the lookup to the organization and never deletes anything', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);

      const summary = await service.summarizeVisitor(ORG, 'vh_unknown');

      expect(mockPrisma.chatSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { visitorId: 'vh_unknown', agent: { organizationId: ORG } },
        }),
      );
      expect(summary.sessions).toEqual([]);
      expect(summary.totalMessages).toBe(0);
      expect(summary.recordCounts).toEqual({
        aiTraces: 0,
        eventLogs: 0,
        piiTokens: 0,
        llmUsage: 0,
      });
      // Read-only: a summary must never touch a deleteMany.
      expect(mockPrisma.chatSession.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.piiToken.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.eventLog.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('eraseOrganization', () => {
    beforeEach(() => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: ORG });
      mockPrisma.agent.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      mockPrisma.organization.delete.mockResolvedValue({ id: ORG });
    });

    it('throws 404 for an unknown organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.eraseOrganization('nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.organization.delete).not.toHaveBeenCalled();
    });

    it('deletes children before parents and the org row last', async () => {
      const order: string[] = [];
      mockPrisma.chatSession.deleteMany.mockImplementation(async () => {
        order.push('sessions');
        return { count: 4 };
      });
      mockPrisma.agent.deleteMany.mockImplementation(async () => {
        order.push('agents');
        return { count: 2 };
      });
      mockPrisma.user.deleteMany.mockImplementation(async () => {
        order.push('users');
        return { count: 1 };
      });
      mockPrisma.organization.delete.mockImplementation(async () => {
        order.push('org');
        return { id: ORG };
      });

      await service.eraseOrganization(ORG);

      // Sessions must go before agents (Restrict FK), org row strictly last.
      expect(order.indexOf('sessions')).toBeLessThan(order.indexOf('agents'));
      expect(order[order.length - 1]).toBe('org');
    });

    it('deletes FK-less tables by scope columns, never by loaded session ids', async () => {
      await service.eraseOrganization(ORG);

      expect(mockPrisma.piiToken.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG },
      });
      expect(mockPrisma.chatTrace.deleteMany).toHaveBeenCalledWith({
        where: { agentId: { in: ['a1', 'a2'] } },
      });
      expect(mockPrisma.llmUsage.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG },
      });
      // Sessions are deleted by agent scope — chatSession.findMany is never
      // used to build id lists here (memory-safe at any org size).
      expect(mockPrisma.chatSession.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.deleteMany).toHaveBeenCalledWith({
        where: { agentId: { in: ['a1', 'a2'] } },
      });
    });

    it('erases audit logs by org/agent/user scope, then writes the proof record', async () => {
      const order: string[] = [];
      mockPrisma.auditLog.deleteMany.mockImplementation(async () => {
        order.push('auditDelete');
        return { count: 11 };
      });
      mockTracer.logAuditEvent.mockImplementation(async () => {
        order.push('auditWrite');
      });

      const result = await service.eraseOrganization(ORG);

      // Delete happens before the proof-of-erasure write survives it.
      expect(order).toEqual(['auditDelete', 'auditWrite']);
      expect(result.auditLogs).toBe(11);

      // Matches any of org / agent / user scope so nothing is left behind.
      const where = mockPrisma.auditLog.deleteMany.mock.calls[0]![0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { organizationId: ORG },
          { agentId: { in: ['a1', 'a2'] } },
          { userId: { in: ['u1'] } },
        ]),
      );

      // The proof record is org-scoped so it's queryable later.
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        ORG,
        'PRIVACY_ORG_ERASED',
        expect.objectContaining({ agents: 2, users: 1 }),
        { organizationId: ORG },
      );
    });

    it('removes storage objects per bucket before deleting file rows', async () => {
      mockPrisma.file.findMany.mockResolvedValue([
        { bucket: 'agent-assets', storageKey: 'k1' },
        { bucket: 'agent-assets', storageKey: 'k2' },
        { bucket: 'other', storageKey: 'k3' },
      ]);
      mockPrisma.file.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.eraseOrganization(ORG);

      expect(mockStorage.remove).toHaveBeenCalledWith('agent-assets', ['k1', 'k2']);
      expect(mockStorage.remove).toHaveBeenCalledWith('other', ['k3']);
      expect(result.files).toBe(3);
    });

    it('handles an org with no agents and no users', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.eraseOrganization(ORG);

      expect(result.agents).toBe(0);
      expect(result.sessions).toBe(0);
      expect(mockPrisma.chatTrace.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.agent.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({
        where: { id: ORG },
      });
    });
  });
});
