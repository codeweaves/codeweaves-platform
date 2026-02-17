import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentsController } from '../../../src/controllers/agents/agents.controller';
import { AgentsService } from '../../../src/services/agents.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import { ZodValidationPipe } from '../../../src/pipes/zod-validation.pipe';
import {
  createAgentSchema,
  updateAgentSchema,
  agentListQuerySchema,
} from '../../../src/models/agent.dto';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { Role } from '@prisma/client';

describe('AgentsController', () => {
  let controller: AgentsController;

  const mockAgentsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
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

  const mockPaginatedResponse = {
    data: [mockAgent],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        { provide: AgentsService, useValue: mockAgentsService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentsController>(AgentsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an agent', async () => {
      const dto = { name: 'Test Agent', organizationId: orgId };
      mockAgentsService.create.mockResolvedValue(mockAgent);

      const result = await controller.create(dto, adminUser);

      expect(result).toEqual(mockAgent);
      expect(mockAgentsService.create).toHaveBeenCalledWith(dto, adminUser);
    });
  });

  describe('findAll', () => {
    const defaultQuery = { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    it('should return paginated agents', async () => {
      mockAgentsService.findAll.mockResolvedValue(mockPaginatedResponse);

      const result = await controller.findAll(defaultQuery, adminUser);

      expect(result).toEqual(mockPaginatedResponse);
      expect(mockAgentsService.findAll).toHaveBeenCalledWith(defaultQuery, adminUser);
    });

    it('should pass search and filter params to service', async () => {
      const query = { ...defaultQuery, search: 'test', status: 'ACTIVE' as const };
      mockAgentsService.findAll.mockResolvedValue(mockPaginatedResponse);

      await controller.findAll(query, adminUser);

      expect(mockAgentsService.findAll).toHaveBeenCalledWith(query, adminUser);
    });
  });

  describe('findById', () => {
    it('should return an agent by id', async () => {
      mockAgentsService.findById.mockResolvedValue(mockAgent);

      const result = await controller.findById(agentId, adminUser);

      expect(result).toEqual(mockAgent);
      expect(mockAgentsService.findById).toHaveBeenCalledWith(agentId, adminUser);
    });

    it('should propagate NotFoundException', async () => {
      mockAgentsService.findById.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(controller.findById('nonexistent', adminUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an agent', async () => {
      const dto = { name: 'Updated Agent' };
      const updated = { ...mockAgent, name: 'Updated Agent' };
      mockAgentsService.update.mockResolvedValue(updated);

      const result = await controller.update(agentId, dto, adminUser);

      expect(result.name).toBe('Updated Agent');
      expect(mockAgentsService.update).toHaveBeenCalledWith(agentId, dto, adminUser);
    });
  });

  describe('remove', () => {
    it('should soft-delete an agent and return void', async () => {
      mockAgentsService.softDelete.mockResolvedValue({ ...mockAgent, deletedAt: new Date() });

      const result = await controller.remove(agentId, adminUser);

      expect(result).toBeUndefined();
      expect(mockAgentsService.softDelete).toHaveBeenCalledWith(agentId, adminUser);
    });

    it('should have HttpCode 204 decorator', () => {
      const httpCode = Reflect.getMetadata('__httpCode__', AgentsController.prototype.remove);
      expect(httpCode).toBe(204);
    });
  });

  describe('role authorization', () => {
    it('should have ADMIN and SUPER_ADMIN roles on create', () => {
      const roles = Reflect.getMetadata('roles', AgentsController.prototype.create);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });

    it('should have ADMIN, SUPER_ADMIN, and CLIENT roles on findAll', () => {
      const roles = Reflect.getMetadata('roles', AgentsController.prototype.findAll);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'CLIENT']);
    });

    it('should have ADMIN, SUPER_ADMIN, and CLIENT roles on findById', () => {
      const roles = Reflect.getMetadata('roles', AgentsController.prototype.findById);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'CLIENT']);
    });

    it('should have ADMIN, SUPER_ADMIN, and CLIENT roles on update', () => {
      const roles = Reflect.getMetadata('roles', AgentsController.prototype.update);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'CLIENT']);
    });

    it('should have ADMIN and SUPER_ADMIN roles on remove', () => {
      const roles = Reflect.getMetadata('roles', AgentsController.prototype.remove);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN']);
    });
  });

  describe('validation', () => {
    const createPipe = new ZodValidationPipe(createAgentSchema);
    const updatePipe = new ZodValidationPipe(updateAgentSchema);
    const listQueryPipe = new ZodValidationPipe(agentListQuerySchema);

    it('should reject create with missing name', () => {
      expect(() => createPipe.transform({ organizationId: orgId })).toThrow(BadRequestException);
    });

    it('should reject create with missing organizationId', () => {
      expect(() => createPipe.transform({ name: 'Test' })).toThrow(BadRequestException);
    });

    it('should reject create with invalid organizationId', () => {
      expect(() => createPipe.transform({ name: 'Test', organizationId: 'not-uuid' })).toThrow(BadRequestException);
    });

    it('should reject create with name too short', () => {
      expect(() => createPipe.transform({ name: 'A', organizationId: orgId })).toThrow(BadRequestException);
    });

    it('should reject create with name too long', () => {
      expect(() => createPipe.transform({ name: 'A'.repeat(101), organizationId: orgId })).toThrow(BadRequestException);
    });

    it('should accept valid create input', () => {
      const result = createPipe.transform({ name: 'Test Agent', organizationId: orgId });
      expect(result.name).toBe('Test Agent');
      expect(result.organizationId).toBe(orgId);
    });

    it('should reject update with empty body', () => {
      expect(() => updatePipe.transform({})).toThrow(BadRequestException);
    });

    it('should accept update with name', () => {
      const result = updatePipe.transform({ name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('should apply defaults for list query', () => {
      const result = listQueryPipe.transform({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('createdAt');
      expect(result.sortOrder).toBe('desc');
    });

    it('should accept list query with status filter', () => {
      const result = listQueryPipe.transform({ status: 'ACTIVE' });
      expect(result.status).toBe('ACTIVE');
    });

    it('should reject invalid status value', () => {
      expect(() => listQueryPipe.transform({ status: 'INVALID' })).toThrow(BadRequestException);
    });

    it('should accept list query with organizationId filter', () => {
      const result = listQueryPipe.transform({ organizationId: orgId });
      expect(result.organizationId).toBe(orgId);
    });

    it('should reject invalid sortBy value', () => {
      expect(() => listQueryPipe.transform({ sortBy: 'invalid' })).toThrow(BadRequestException);
    });

    it('should coerce page and limit to numbers', () => {
      const result = listQueryPipe.transform({ page: '2', limit: '10' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    // --- Status validation (Story 3-7) ---
    it('should accept update with status ACTIVE', () => {
      const result = updatePipe.transform({ status: 'ACTIVE' });
      expect(result.status).toBe('ACTIVE');
    });

    it('should accept update with status INACTIVE', () => {
      const result = updatePipe.transform({ status: 'INACTIVE' });
      expect(result.status).toBe('INACTIVE');
    });

    it('should reject update with invalid status value', () => {
      expect(() => updatePipe.transform({ status: 'PAUSED' })).toThrow(BadRequestException);
    });

    // --- Domain allowlist validation (Story 3-4) ---
    it('should accept update with allowedDomains array', () => {
      const result = updatePipe.transform({ allowedDomains: ['example.com', 'test.org'] });
      expect(result.allowedDomains).toEqual(['example.com', 'test.org']);
    });

    it('should accept update with empty allowedDomains (no restriction)', () => {
      const result = updatePipe.transform({ allowedDomains: [] });
      expect(result.allowedDomains).toEqual([]);
    });

    it('should normalize domains in allowedDomains (lowercase, strip protocol)', () => {
      const result = updatePipe.transform({ allowedDomains: ['https://Example.COM/path'] });
      expect(result.allowedDomains).toEqual(['example.com']);
    });

    it('should reject allowedDomains exceeding 50 entries', () => {
      const domains = Array.from({ length: 51 }, (_, i) => `domain${i}.com`);
      expect(() => updatePipe.transform({ allowedDomains: domains })).toThrow(BadRequestException);
    });

    it('should accept allowedDomains at the 50 entry limit', () => {
      const domains = Array.from({ length: 50 }, (_, i) => `domain${i}.com`);
      const result = updatePipe.transform({ allowedDomains: domains });
      expect(result.allowedDomains).toHaveLength(50);
    });

    it('should accept update with both name and status', () => {
      const result = updatePipe.transform({ name: 'Updated', status: 'INACTIVE' });
      expect(result.name).toBe('Updated');
      expect(result.status).toBe('INACTIVE');
    });

    it('should accept update with name, status, and allowedDomains together', () => {
      const result = updatePipe.transform({
        name: 'Updated',
        status: 'ACTIVE',
        allowedDomains: ['example.com'],
      });
      expect(result.name).toBe('Updated');
      expect(result.status).toBe('ACTIVE');
      expect(result.allowedDomains).toEqual(['example.com']);
    });
  });
});
