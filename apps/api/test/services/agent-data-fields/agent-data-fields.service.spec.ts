import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgentDataFieldsService } from '../../../src/services/agent-data-fields.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentDataFieldsService', () => {
  let service: AgentDataFieldsService;

  const tx = {
    agentDataField: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const mockPrisma = {
    agent: { findFirst: jest.fn() },
    agentDataField: { findMany: jest.fn() },
    collectedData: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const mockCache = { invalidate: jest.fn() };
  // Passthrough: decryption behaviour is unit-tested in crypto.service.spec.ts.
  // Implementation applied in beforeEach (jest resetMocks: true).
  const mockCrypto = { decryptFieldValues: jest.fn() };
  const mockTracer = { logAuditEvent: jest.fn() };

  const agentId = 'agent-uuid';
  const adminUser = {
    id: 'u1',
    role: Role.ADMIN,
    organizationId: 'org1',
  } as CurrentUserData;
  const clientUser = {
    id: 'u2',
    role: Role.CLIENT,
    organizationId: 'org2',
  } as CurrentUserData;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.decryptFieldValues.mockImplementation(
      (d: Record<string, unknown> | null | undefined) => d ?? {},
    );
    mockPrisma.$transaction.mockImplementation(
      async (cb: (t: typeof tx) => unknown) => cb(tx),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDataFieldsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: TracerService, useValue: mockTracer },
      ],
    }).compile();
    service = moduleRef.get(AgentDataFieldsService);
  });

  describe('list()', () => {
    it('returns fields in order when the agent is accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([{ key: 'email' }]);

      const result = await service.list(agentId, adminUser);

      expect(result).toEqual([{ key: 'email' }]);
      expect(mockPrisma.agentDataField.findMany).toHaveBeenCalledWith({
        where: { agentId },
        orderBy: { order: 'asc' },
      });
    });

    it('throws NotFound when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.list(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes CLIENT users to their own organisation', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([]);

      await service.list(agentId, clientUser);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: 'org2' },
        select: { id: true, organizationId: true },
      });
    });

    it('does NOT org-scope ADMIN users', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([]);

      await service.list(agentId, adminUser);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
        select: { id: true, organizationId: true },
      });
    });
  });

  describe('replaceAll()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: 'org1' });
    });

    it('wipes + recreates fields with order from array index, then busts cache', async () => {
      tx.agentDataField.findMany.mockResolvedValue([{ key: 'email', order: 0 }]);

      const result = await service.replaceAll(
        agentId,
        {
          fields: [
            {
              key: 'email',
              label: 'Email',
              type: 'EMAIL',
              required: true,
              description: null,
            },
          ],
        },
        adminUser,
      );

      expect(tx.agentDataField.deleteMany).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(tx.agentDataField.createMany).toHaveBeenCalledWith({
        data: [
          {
            agentId,
            key: 'email',
            label: 'Email',
            type: 'EMAIL',
            required: true,
            description: null,
            order: 0,
          },
        ],
      });
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
      expect(result).toEqual([{ key: 'email', order: 0 }]);
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'AGENT_DATA_FIELDS_UPDATED',
        expect.anything(),
        { organizationId: 'org1', agentId },
      );
    });

    it('clears fields without createMany when the list is empty', async () => {
      tx.agentDataField.findMany.mockResolvedValue([]);

      await service.replaceAll(agentId, { fields: [] }, adminUser);

      expect(tx.agentDataField.deleteMany).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(tx.agentDataField.createMany).not.toHaveBeenCalled();
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
    });

    it('throws NotFound and writes nothing when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.replaceAll(agentId, { fields: [] }, adminUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getCollectedDataView()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      // distinct keys present in stored data: two current fields (defined in
      // NON-alphabetical order) + one orphaned key — so the assertion proves
      // the alphabetical-by-label sort, not just insertion order.
      mockPrisma.$queryRaw.mockResolvedValue([
        { key: 'zname' },
        { key: 'aname' },
        { key: 'mid_field' },
      ]);
      mockPrisma.agentDataField.findMany.mockResolvedValue([
        { key: 'zname', label: 'Zebra' },
        { key: 'aname', label: 'Apple' },
      ]);
      mockPrisma.collectedData.findMany.mockResolvedValue([
        { chatSessionId: 's1', data: { aname: 'a@b.com' }, extractedAt: new Date() },
      ]);
      mockPrisma.collectedData.count.mockResolvedValue(1);
    });

    it('orders columns alphabetically by label (case-insensitive); orphaned keys use the raw key as label', async () => {
      const result = await service.getCollectedDataView(agentId, adminUser, 1, 20);

      expect(result.columns).toEqual([
        { key: 'aname', label: 'Apple' }, // current field → friendly label
        { key: 'mid_field', label: 'mid_field' }, // orphaned → raw key
        { key: 'zname', label: 'Zebra' }, // current field, sorted after the rest
      ]);
      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
    });

    it('clamps page size to the max and paginates (skip = (page-1)*limit)', async () => {
      await service.getCollectedDataView(agentId, adminUser, 2, 99999);
      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 }),
      );
    });

    it('defaults to newest-first and honors an explicit sort order', async () => {
      await service.getCollectedDataView(agentId, adminUser, 1, 20);
      expect(mockPrisma.collectedData.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { extractedAt: 'desc' } }),
      );

      await service.getCollectedDataView(agentId, adminUser, 1, 20, 'asc');
      expect(mockPrisma.collectedData.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { extractedAt: 'asc' } }),
      );
    });

    it('throws NotFound when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.getCollectedDataView(agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
