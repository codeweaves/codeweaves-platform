import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentsService } from '../../../src/services/agents.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentLoggerService } from '../../../src/common/logger/agent.logger';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
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
    agentSecret: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    agentTheme: {
      findUnique: jest.fn(),
    },
  };

  const mockAgentLogger = {
    logAgentCreated: jest.fn(),
    logAgentCreationException: jest.fn(),
    logAgentUpdated: jest.fn(),
    logAgentUpdateException: jest.fn(),
    logAgentDeleted: jest.fn(),
    logDomainsUpdated: jest.fn(),
    logStatusChanged: jest.fn(),
    logSecretCreated: jest.fn(),
    logSecretUpdated: jest.fn(),
    logWebhookUpdated: jest.fn(),
  };

  const mockCryptoService = {
    encrypt: jest.fn((val: string) => `encrypted:${val}`),
    decrypt: jest.fn((val: string) => val.replace('encrypted:', '')),
  };

  const mockAgentCacheService = {
    getAgentWithKnowledge: jest.fn().mockResolvedValue(null),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn((key: string): string | undefined => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'DEFAULT_WEBHOOK_URL') return undefined;
      return undefined;
    }),
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
    hmacEnabled: false,
    voiceEnabled: false,
    voiceConfig: null,
    systemPrompt: null,
    welcomeMessage: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    organization: { id: orgId, name: 'Test Org' },
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
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AgentCacheService, useValue: mockAgentCacheService },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    jest.clearAllMocks();
    jest.spyOn(publicIdUtils, 'generatePublicId').mockReturnValue('AbCd1234');

    // Restore mock implementations after clearAllMocks
    mockCryptoService.encrypt.mockImplementation((val: string) => `encrypted:${val}`);
    mockCryptoService.decrypt.mockImplementation((val: string) => val.replace('encrypted:', ''));
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'DEFAULT_WEBHOOK_URL') return undefined;
      return undefined;
    });
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
          include: { organization: { select: { id: true, name: true } } },
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
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should scope findById for CLIENT to own org', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await service.findById(agentId, clientUser);

      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: orgId },
        include: { organization: { select: { id: true, name: true } } },
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
        include: { organization: { select: { id: true, name: true } } },
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

  describe('update — allowedDomains', () => {
    const agentWithDomains = { ...mockAgent, allowedDomains: ['example.com', 'test.com'] };

    it('should normalize and deduplicate domains before saving', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(agentWithDomains);

      await service.update(
        agentId,
        { allowedDomains: ['https://Example.COM/path', 'EXAMPLE.COM', 'test.com'] },
        adminUser,
      );

      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { allowedDomains: ['example.com', 'test.com'] },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should accept empty array (no domain restriction)', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithDomains);
      mockPrismaService.agent.update.mockResolvedValue({ ...mockAgent, allowedDomains: [] });

      await service.update(agentId, { allowedDomains: [] }, adminUser);

      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { allowedDomains: [] },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should audit log domain changes', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(agentWithDomains);

      await service.update(agentId, { allowedDomains: ['example.com'] }, adminUser);

      expect(mockAgentLogger.logDomainsUpdated).toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({
          oldDomains: mockAgent.allowedDomains,
          newDomains: ['example.com'],
          userId: adminUser.id,
        }),
      );
    });

    it('should not audit log domains if allowedDomains not in update', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue({ ...mockAgent, name: 'Renamed' });

      await service.update(agentId, { name: 'Renamed' }, adminUser);

      expect(mockAgentLogger.logDomainsUpdated).not.toHaveBeenCalled();
    });

    it('should reject invalid domain formats', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(agentId, { allowedDomains: ['not a domain'] }, adminUser),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.agent.update).not.toHaveBeenCalled();
    });

    it('should reject when any domain in the list is invalid', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(
          agentId,
          { allowedDomains: ['example.com', 'invalid domain!', 'test.org'] },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.agent.update).not.toHaveBeenCalled();
    });

    it('should include invalid domain names in the error message', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(agentId, { allowedDomains: ['bad domain'] }, adminUser),
      ).rejects.toThrow('Invalid domain(s): bad domain');
    });
  });

  describe('response filtering — stripSensitiveFields', () => {
    const agentWithDomains = { ...mockAgent, allowedDomains: ['example.com'] };

    it('should strip allowedDomains from findById response for CLIENT', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithDomains);

      const result = await service.findById(agentId, clientUser);

      expect(result).not.toHaveProperty('allowedDomains');
    });

    it('should include allowedDomains in findById response for ADMIN', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithDomains);

      const result = await service.findById(agentId, adminUser);

      expect(result).toHaveProperty('allowedDomains', ['example.com']);
    });

    it('should include allowedDomains in findById response for SUPER_ADMIN', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithDomains);

      const result = await service.findById(agentId, superAdminUser);

      expect(result).toHaveProperty('allowedDomains', ['example.com']);
    });

    it('should strip allowedDomains from findAll response for CLIENT', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([agentWithDomains]);
      mockPrismaService.agent.count.mockResolvedValue(1);

      const result = await service.findAll(
        { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
        clientUser,
      );

      expect(result.data[0]).not.toHaveProperty('allowedDomains');
    });

    it('should include allowedDomains in findAll response for ADMIN', async () => {
      mockPrismaService.agent.findMany.mockResolvedValue([agentWithDomains]);
      mockPrismaService.agent.count.mockResolvedValue(1);

      const result = await service.findAll(
        { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
        adminUser,
      );

      expect(result.data[0]).toHaveProperty('allowedDomains', ['example.com']);
    });

    it('should strip allowedDomains from update response for CLIENT', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithDomains);
      mockPrismaService.agent.update.mockResolvedValue(agentWithDomains);

      const result = await service.update(agentId, { name: 'Updated' }, clientUser);

      expect(result).not.toHaveProperty('allowedDomains');
    });
  });

  describe('update — status management', () => {
    it('should update status from ACTIVE to INACTIVE', async () => {
      const inactiveAgent = { ...mockAgent, status: 'INACTIVE' };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(inactiveAgent);

      const result = await service.update(agentId, { status: 'INACTIVE' }, adminUser);

      expect(result.status).toBe('INACTIVE');
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { status: 'INACTIVE' },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should audit log status change', async () => {
      const inactiveAgent = { ...mockAgent, status: 'INACTIVE' };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(inactiveAgent);

      await service.update(agentId, { status: 'INACTIVE' }, adminUser);

      expect(mockAgentLogger.logStatusChanged).toHaveBeenCalledWith(agentId, {
        oldStatus: 'ACTIVE',
        newStatus: 'INACTIVE',
      });
    });

    it('should not audit log if status unchanged', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(mockAgent);

      await service.update(agentId, { status: 'ACTIVE' }, adminUser);

      expect(mockAgentLogger.logStatusChanged).not.toHaveBeenCalled();
    });

    it('should allow CLIENT to toggle status for own org agent', async () => {
      const inactiveAgent = { ...mockAgent, status: 'INACTIVE' };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(inactiveAgent);

      const result = await service.update(agentId, { status: 'INACTIVE' }, clientUser);

      expect(result).not.toHaveProperty('allowedDomains');
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { status: 'INACTIVE' },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should reject CLIENT toggling other org agent (via findById scoping)', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.update(agentId, { status: 'INACTIVE' }, clientOtherOrg),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkAgentActive', () => {
    it('should return true for ACTIVE agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue({ status: 'ACTIVE' });

      const result = await service.checkAgentActive(agentId);

      expect(result).toBe(true);
      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
        select: { status: true },
      });
    });

    it('should return false for INACTIVE agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue({ status: 'INACTIVE' });

      const result = await service.checkAgentActive(agentId);

      expect(result).toBe(false);
    });

    it('should return false for deleted/nonexistent agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      const result = await service.checkAgentActive(agentId);

      expect(result).toBe(false);
    });
  });

  // ==========================================
  // Webhook Management Tests (Story 3-6)
  // ==========================================

  describe('setWebhookUrl', () => {
    const webhookUrl = 'https://n8n.example.com/webhook/abc123';

    it('should encrypt and store webhook URL', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      const result = await service.setWebhookUrl(agentId, webhookUrl, adminUser);

      expect(result).toEqual({ message: 'Webhook URL updated' });
      expect(mockCryptoService.encrypt).toHaveBeenCalledWith(webhookUrl);
      expect(mockPrismaService.agentSecret.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId },
          create: expect.objectContaining({ agentId }),
          update: expect.objectContaining({ webhookUrl: expect.any(String) }),
        }),
      );
    });

    it('should log AGENT_SECRET_CREATED when no previous secret exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      await service.setWebhookUrl(agentId, webhookUrl, adminUser);

      expect(mockAgentLogger.logSecretCreated).toHaveBeenCalledWith(agentId, adminUser.id);
      expect(mockAgentLogger.logSecretUpdated).not.toHaveBeenCalled();
    });

    it('should log AGENT_SECRET_UPDATED when secret already exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue({ agentId, webhookUrl: 'old' });
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      await service.setWebhookUrl(agentId, webhookUrl, adminUser);

      expect(mockAgentLogger.logSecretUpdated).toHaveBeenCalledWith(agentId, adminUser.id);
      expect(mockAgentLogger.logSecretCreated).not.toHaveBeenCalled();
    });

    it('should always log AGENT_WEBHOOK_UPDATED', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      await service.setWebhookUrl(agentId, webhookUrl, adminUser);

      expect(mockAgentLogger.logWebhookUpdated).toHaveBeenCalledWith(agentId, adminUser.id);
    });

    it('should allow HTTP URLs in development mode', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      const result = await service.setWebhookUrl(
        agentId,
        'http://localhost:5678/webhook/test',
        adminUser,
      );

      expect(result).toEqual({ message: 'Webhook URL updated' });
    });

    it('should reject HTTP URLs in production mode', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.setWebhookUrl(agentId, 'http://example.com/webhook', adminUser),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setWebhookUrl(agentId, 'http://example.com/webhook', adminUser),
      ).rejects.toThrow('Webhook URL must use HTTPS in production');
    });

    it('should allow HTTPS URLs in production mode', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockPrismaService.agentSecret.upsert.mockResolvedValue({});

      const result = await service.setWebhookUrl(agentId, webhookUrl, adminUser);

      expect(result).toEqual({ message: 'Webhook URL updated' });
    });

    it('should throw NotFoundException for nonexistent agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.setWebhookUrl(agentId, webhookUrl, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWebhookUrl', () => {
    it('should return decrypted webhook URL', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue({
        agentId,
        webhookUrl: 'encrypted:https://example.com/webhook',
      });

      const result = await service.getWebhookUrl(agentId, adminUser);

      expect(result).toEqual({ webhookUrl: 'https://example.com/webhook' });
      expect(mockCryptoService.decrypt).toHaveBeenCalledWith('encrypted:https://example.com/webhook');
    });

    it('should return fallback URL when no agent-specific webhook exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DEFAULT_WEBHOOK_URL') return 'https://default.example.com/webhook';
        return 'development';
      });

      const result = await service.getWebhookUrl(agentId, adminUser);

      expect(result).toEqual({
        webhookUrl: 'https://default.example.com/webhook',
        isFallback: true,
      });
    });

    it('should return null when no webhook and no fallback configured', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);

      const result = await service.getWebhookUrl(agentId, adminUser);

      expect(result).toEqual({ webhookUrl: null });
    });

    it('should return null when secret exists but webhookUrl is null', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue({
        agentId,
        webhookUrl: null,
      });

      const result = await service.getWebhookUrl(agentId, adminUser);

      expect(result).toEqual({ webhookUrl: null });
    });

    it('should throw NotFoundException for nonexistent agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.getWebhookUrl(agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEffectiveWebhookUrl', () => {
    it('should return decrypted agent-specific URL', async () => {
      mockPrismaService.agentSecret.findUnique.mockResolvedValue({
        agentId,
        webhookUrl: 'encrypted:https://example.com/webhook',
      });

      const result = await service.getEffectiveWebhookUrl(agentId);

      expect(result).toBe('https://example.com/webhook');
    });

    it('should return fallback URL when no agent-specific webhook', async () => {
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DEFAULT_WEBHOOK_URL') return 'https://default.example.com/webhook';
        return 'development';
      });

      const result = await service.getEffectiveWebhookUrl(agentId);

      expect(result).toBe('https://default.example.com/webhook');
    });

    it('should throw NotFoundException when no webhook and no fallback', async () => {
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);

      await expect(service.getEffectiveWebhookUrl(agentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('testWebhook', () => {
    it('should throw NotFoundException when no webhook configured', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);

      await expect(service.testWebhook(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for nonexistent agent', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.testWebhook(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==========================================
  // Voice Configuration Tests (Story 10-6)
  // ==========================================

  describe('update — voice configuration', () => {
    const validVoiceConfig = {
      sttEnabled: true,
      ttsEnabled: true,
      sttProvider: 'deepgram' as const,
      ttsProvider: 'elevenlabs' as const,
      defaultLanguage: 'en' as const,
      supportedLanguages: ['en' as const],
      ttsVoiceId: 'Xb7hH8MSUJpSbSDYk0k2',
      ttsSpeed: 1.0,
      autoDetectLanguage: true,
      ttsStreaming: false,
    };

    it('should reject voiceEnabled: true when no voiceConfig exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(agentId, { voiceEnabled: true }, adminUser),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.agent.update).not.toHaveBeenCalled();
    });

    it('should allow voiceEnabled: true when agent already has voiceConfig', async () => {
      const agentWithConfig = { ...mockAgent, voiceConfig: validVoiceConfig };
      const updated = { ...agentWithConfig, voiceEnabled: true };
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithConfig);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      const result = await service.update(agentId, { voiceEnabled: true }, adminUser);

      expect(result.voiceEnabled).toBe(true);
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { voiceEnabled: true },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should update agent with full voiceConfig object', async () => {
      const updated = { ...mockAgent, voiceEnabled: true, voiceConfig: validVoiceConfig };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      const result = await service.update(
        agentId,
        { voiceEnabled: true, voiceConfig: validVoiceConfig },
        adminUser,
      );

      expect(result.voiceEnabled).toBe(true);
      expect(result.voiceConfig).toEqual(validVoiceConfig);
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: {
          voiceEnabled: true,
          voiceConfig: expect.objectContaining({
            sttEnabled: true,
            ttsEnabled: true,
            sttProvider: 'deepgram',
            ttsProvider: 'elevenlabs',
          }),
        },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should reject voiceConfig with invalid provider name as BadRequestException', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(
          agentId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { voiceConfig: { ...validVoiceConfig, sttProvider: 'invalid-provider' } as any },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.agent.update).not.toHaveBeenCalled();
    });

    it('should reject voiceConfig with ttsSpeed out of range as BadRequestException', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.update(
          agentId,
          { voiceConfig: { ...validVoiceConfig, ttsSpeed: 5.0 } },
          adminUser,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.agent.update).not.toHaveBeenCalled();
    });

    it('should apply defaults for missing voiceConfig fields', async () => {
      const minimalConfig = {};
      const expectedDefaults = {
        sttEnabled: true,
        ttsEnabled: true,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        ttsSpeed: 1.0,
        autoDetectLanguage: true,
      };
      const updated = { ...mockAgent, voiceConfig: expectedDefaults };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.update(agentId, { voiceConfig: minimalConfig as any }, adminUser);

      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: {
          voiceConfig: expect.objectContaining({
            sttEnabled: true,
            ttsEnabled: true,
            defaultLanguage: 'en',
            supportedLanguages: ['en'],
            ttsSpeed: 1.0,
            autoDetectLanguage: true,
          }),
        },
        include: { organization: { select: { id: true, name: true } } },
      });
    });

    it('should preserve voiceConfig when disabling voice', async () => {
      const agentWithVoice = { ...mockAgent, voiceEnabled: true, voiceConfig: validVoiceConfig };
      const updated = { ...agentWithVoice, voiceEnabled: false };
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithVoice);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      const result = await service.update(agentId, { voiceEnabled: false }, adminUser);

      expect(result.voiceEnabled).toBe(false);
      // voiceConfig should NOT be in the update data (not deleted)
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { voiceEnabled: false },
        include: { organization: { select: { id: true, name: true } } },
      });
      // The existing voiceConfig is preserved (still on the returned agent)
      expect(result.voiceConfig).toEqual(validVoiceConfig);
    });

    it('should include voiceEnabled and voiceConfig in agent response', async () => {
      const agentWithVoice = { ...mockAgent, voiceEnabled: true, voiceConfig: validVoiceConfig };
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithVoice);

      const result = await service.findById(agentId, adminUser);

      expect(result).toHaveProperty('voiceEnabled', true);
      expect(result).toHaveProperty('voiceConfig', validVoiceConfig);
    });

    it('should clear voiceConfig when set to null', async () => {
      const agentWithVoice = { ...mockAgent, voiceEnabled: false, voiceConfig: validVoiceConfig };
      const updated = { ...agentWithVoice, voiceConfig: null };
      mockPrismaService.agent.findFirst.mockResolvedValue(agentWithVoice);
      mockPrismaService.agent.update.mockResolvedValue(updated);

      const result = await service.update(agentId, { voiceConfig: null }, adminUser);

      expect(result.voiceConfig).toBeNull();
      expect(mockPrismaService.agent.update).toHaveBeenCalledWith({
        where: { id: agentId },
        data: { voiceConfig: Prisma.DbNull },
        include: { organization: { select: { id: true, name: true } } },
      });
    });
  });

  describe('getDemoInfo — voice config in widget response', () => {
    it('should return sanitized voiceConfig (no provider details) when voiceEnabled is true', async () => {
      const voiceConfig = {
        sttEnabled: true,
        ttsEnabled: true,
        sttProvider: 'deepgram',
        ttsProvider: 'elevenlabs',
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        ttsVoiceId: 'Xb7hH8MSUJpSbSDYk0k2',
        ttsSpeed: 1.0,
        autoDetectLanguage: true,
      };
      mockPrismaService.agent.findFirst.mockResolvedValue({
        id: agentId,
        publicId: 'AbCd1234',
        name: 'Test Agent',
        welcomeMessage: null,
        voiceEnabled: true,
        voiceConfig,
      });
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      const result = await service.getDemoInfo(agentId);

      // Should include only widget-safe fields
      expect(result.voiceConfig).toEqual({
        sttEnabled: true,
        ttsEnabled: true,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        autoDetectLanguage: true,
      });
      // Should NOT expose provider internals
      expect(result.voiceConfig).not.toHaveProperty('sttProvider');
      expect(result.voiceConfig).not.toHaveProperty('ttsProvider');
      expect(result.voiceConfig).not.toHaveProperty('ttsVoiceId');
      expect(result.voiceConfig).not.toHaveProperty('ttsSpeed');
    });

    it('should return null voiceConfig when voiceEnabled is false', async () => {
      const voiceConfig = { sttEnabled: true, ttsEnabled: true, defaultLanguage: 'en' };
      mockPrismaService.agent.findFirst.mockResolvedValue({
        id: agentId,
        publicId: 'AbCd1234',
        name: 'Test Agent',
        welcomeMessage: null,
        voiceEnabled: false,
        voiceConfig,
      });
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      const result = await service.getDemoInfo(agentId);

      expect(result.voiceConfig).toBeNull();
    });
  });

  describe('getWidgetConfig', () => {
    const publicId = 'AbCd1234';

    it('should return config with theme, agent info, and allowedDomains', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue({
        id: agentId,
        name: 'Test Agent',
        welcomeMessage: 'Hi there',
        allowedDomains: ['example.com'],
      });
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { icon: { position: 'right' }, starters: [{ message: 'Hello' }] },
        version: 5,
      });

      const result = await service.getWidgetConfig(publicId);

      expect(result.config.agent.name).toBe('Test Agent');
      expect(result.config.agent.greeting).toBe('Hi there');
      expect(result.config.agent.starters).toEqual(['Hello']);
      expect(result.config.allowedDomains).toEqual(['example.com']);
      expect(result.config.theme).toBeDefined();
      expect(result.version).toBe(5);
      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: { publicId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true, welcomeMessage: true, allowedDomains: true, voiceEnabled: true, voiceConfig: true },
      });
    });

    it('should return version 0 and null theme when no theme exists', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue({
        id: agentId,
        name: 'Test Agent',
        welcomeMessage: null,
        allowedDomains: [],
      });
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      const result = await service.getWidgetConfig(publicId);

      expect(result.config.theme).toBeNull();
      expect(result.config.agent.greeting).toBe('');
      expect(result.config.agent.starters).toEqual([]);
      expect(result.version).toBe(0);
    });

    it('should throw NotFoundException for unknown publicId', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.getWidgetConfig('unknown1')).rejects.toThrow(
        'Agent not found',
      );
    });

    it('should handle empty starters array', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue({
        id: agentId,
        name: 'Agent',
        welcomeMessage: null,
        allowedDomains: [],
      });
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { starters: [] },
        version: 1,
      });

      const result = await service.getWidgetConfig(publicId);

      expect(result.config.agent.starters).toEqual([]);
    });
  });
});
