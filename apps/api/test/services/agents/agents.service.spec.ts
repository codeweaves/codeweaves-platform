import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AgentsService } from '../../../src/services/agents.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentLoggerService } from '../../../src/common/logger/agent.logger';
import { Prisma, Role } from '@prisma/client';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import * as publicIdUtils from '../../../src/utils/public-id';

describe('AgentsService', () => {
  let service: AgentsService;

  const mockPrismaService = {
    agent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  };

  const mockAgentLogger = {
    logAgentCreated: jest.fn(),
    logAgentCreationException: jest.fn(),
    logAgentUpdated: jest.fn(),
    logAgentUpdateException: jest.fn(),
    logAgentDeleted: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const otherOrgId = '223e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  const mockAgent = {
    id: agentId,
    publicId: 'AbCd1234',
    name: 'Test Agent',
    status: 'ACTIVE',
    organizationId: orgId,
    allowedDomains: [],
    systemPrompt: null,
    welcomeMessage: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
  };

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

  const clientOtherOrg: CurrentUserData = {
    auth0Id: 'auth0|client2',
    email: 'client2@test.com',
    roles: ['CLIENT'],
    id: 'client2-user-id',
    role: Role.CLIENT,
    organizationId: otherOrgId,
    organization: { id: otherOrgId, name: 'Other Org', slug: 'other-org' },
  };

  const p2002Error = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['publicId'] } },
  );

  const p2025Error = new Prisma.PrismaClientKnownRequestError(
    'Record to update not found',
    { code: 'P2025', clientVersion: '5.0.0' },
  );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentLoggerService, useValue: mockAgentLogger },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    jest.clearAllMocks();
    jest.spyOn(publicIdUtils, 'generatePublicId').mockReturnValue('AbCd1234');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = { name: 'Test Agent', organizationId: orgId };

    beforeEach(() => {
      mockPrismaService.organization.findUnique.mockResolvedValue({ id: orgId, name: 'Test Org' });
    });

    it('should create an agent with generated publicId', async () => {
      mockPrismaService.agent.create.mockResolvedValue(mockAgent);

      const result = await service.create(createDto, adminUser);

      expect(result).toEqual(mockAgent);
      expect(result.publicId).toBe('AbCd1234');
      expect(mockPrismaService.organization.findUnique).toHaveBeenCalledWith({
        where: { id: orgId },
      });
      expect(mockPrismaService.agent.create).toHaveBeenCalledWith({
        data: {
          publicId: 'AbCd1234',
          name: 'Test Agent',
          organizationId: orgId,
        },
      });
      expect(mockAgentLogger.logAgentCreated).toHaveBeenCalledWith(
        mockAgent.id,
        expect.objectContaining({ agent: mockAgent, request: createDto }),
      );
    });

    it('should throw NotFoundException for nonexistent organizationId', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, adminUser)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.agent.create).not.toHaveBeenCalled();
    });

    it('should retry on publicId collision (P2002)', async () => {
      jest.spyOn(publicIdUtils, 'generatePublicId')
        .mockReturnValueOnce('COLLIDE1')
        .mockReturnValueOnce('UnIqUe99');

      mockPrismaService.agent.create
        .mockRejectedValueOnce(p2002Error)
        .mockResolvedValueOnce({ ...mockAgent, publicId: 'UnIqUe99' });

      const result = await service.create(createDto, adminUser);

      expect(result.publicId).toBe('UnIqUe99');
      expect(mockPrismaService.agent.create).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException after 3 failed retries', async () => {
      mockPrismaService.agent.create.mockRejectedValue(p2002Error);

      await expect(service.create(createDto, adminUser)).rejects.toThrow(ConflictException);
      expect(mockPrismaService.agent.create).toHaveBeenCalledTimes(3);
    });

    it('should rethrow non-P2002 errors without retry', async () => {
      mockPrismaService.agent.create.mockRejectedValue(new Error('DB down'));

      await expect(service.create(createDto, adminUser)).rejects.toThrow('DB down');
      expect(mockPrismaService.agent.create).toHaveBeenCalledTimes(1);
      expect(mockAgentLogger.logAgentCreationException).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    const defaultQuery = { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    it('should return paginated agents for ADMIN (all orgs)', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([mockAgent]);
      mockPrismaService.agent.count.mockResolvedValue(1);

      const result = await service.findAll(defaultQuery, adminUser);

      expect(result.data).toEqual([mockAgent]);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should auto-scope CLIENT to own org', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([mockAgent]);
      mockPrismaService.agent.count.mockResolvedValue(1);

      await service.findAll(defaultQuery, clientUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            organizationId: orgId,
          }),
        }),
      );
    });

    it('should allow SUPER_ADMIN to filter by organizationId', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockPrismaService.agent.count.mockResolvedValue(0);

      await service.findAll({ ...defaultQuery, organizationId: orgId }, superAdminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            organizationId: orgId,
          }),
        }),
      );
    });

    it('should apply search filter on name', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockPrismaService.agent.count.mockResolvedValue(0);

      await service.findAll({ ...defaultQuery, search: 'test' }, adminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'test', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should filter by status', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockPrismaService.agent.count.mockResolvedValue(0);

      await service.findAll({ ...defaultQuery, status: 'ACTIVE' }, adminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('should apply pagination correctly', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockPrismaService.agent.count.mockResolvedValue(25);

      const result = await service.findAll({ ...defaultQuery, page: 2, limit: 10 }, adminUser);

      expect(mockPrismaService.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta.totalPages).toBe(3);
    });

    it('should return empty data when no agents exist', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([]);
      mockPrismaService.agent.count.mockResolvedValue(0);

      const result = await service.findAll(defaultQuery, adminUser);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return agent by id for ADMIN', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      const result = await service.findById(agentId, adminUser);

      expect(result).toEqual(mockAgent);
      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
      });
    });

    it('should scope findById for CLIENT to own org', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await service.findById(agentId, clientUser);

      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: orgId },
      });
    });

    it('should throw NotFoundException when agent not found', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.findById('nonexistent', adminUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when CLIENT queries other org agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.findById(agentId, clientOtherOrg)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update agent name', async () => {
      const updated = { ...mockAgent, name: 'New Name' };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      const result = await service.update(agentId, { name: 'New Name' }, adminUser);

      expect(result.name).toBe('New Name');
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { name: 'New Name' },
      });
    });

    it('should NOT include organizationId in update data', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(mockAgent);

      await service.update(agentId, { name: 'Updated' }, adminUser);

      const updateCall = mockPrismaService.agent.update.mock.calls[0]![0];
      expect(updateCall.data).not.toHaveProperty('organizationId');
    });

    it('should throw NotFoundException on P2025', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockRejectedValue(p2025Error);

      await expect(
        service.update(agentId, { name: 'New' }, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should rethrow non-Prisma errors', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockRejectedValue(new Error('DB down'));

      await expect(
        service.update(agentId, { name: 'New' }, adminUser),
      ).rejects.toThrow('DB down');
      expect(mockAgentLogger.logAgentUpdateException).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt on soft delete', async () => {
      const deleted = { ...mockAgent, deletedAt: new Date() };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(deleted);

      const result = await service.softDelete(agentId, adminUser);

      expect(result.deletedAt).toBeDefined();
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockAgentLogger.logAgentDeleted).toHaveBeenCalledWith(
        deleted.id,
        expect.objectContaining({ agent: deleted, userId: adminUser.id }),
      );
    });

    it('should throw NotFoundException if agent already deleted', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.softDelete(agentId, adminUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when CLIENT tries to delete other org agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.softDelete(agentId, clientOtherOrg)).rejects.toThrow(NotFoundException);
    });
  });
});
