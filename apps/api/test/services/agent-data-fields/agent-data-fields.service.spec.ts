import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AgentDataFieldsService } from '../../../src/services/agent-data-fields.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
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
    collectedData: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockCache = { invalidate: jest.fn() };

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
    mockPrisma.$transaction.mockImplementation(
      async (cb: (t: typeof tx) => unknown) => cb(tx),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDataFieldsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
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
        select: { id: true },
      });
    });

    it('does NOT org-scope ADMIN users', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([]);

      await service.list(agentId, adminUser);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
        select: { id: true },
      });
    });
  });

  describe('replaceAll()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
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

  describe('listCollectedData()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.collectedData.findMany.mockResolvedValue([
        { data: { email: 'a@b.com' } },
      ]);
    });

    it('returns recent rows with a bounded default take', async () => {
      const result = await service.listCollectedData(agentId, adminUser);

      expect(result).toEqual([{ data: { email: 'a@b.com' } }]);
      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledWith({
        where: { agentId },
        orderBy: { extractedAt: 'desc' },
        take: 100,
      });
    });

    it('clamps an excessive limit to the max', async () => {
      await service.listCollectedData(agentId, adminUser, 99999);
      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
    });
  });
});
