import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ConversationsController } from '../../../src/controllers/conversations/conversations.controller';
import { ConversationsService } from '../../../src/services/conversations.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import { ZodValidationPipe } from '../../../src/pipes/zod-validation.pipe';
import {
  conversationsListQuerySchema,
  conversationDetailParamsSchema,
} from '../../../src/models/conversations.dto';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('ConversationsController', () => {
  let controller: ConversationsController;

  const mockService = {
    list: jest.fn(),
    getBySessionId: jest.fn(),
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

  const clientUser: CurrentUserData = {
    auth0Id: 'auth0|client',
    email: 'client@test.com',
    roles: ['CLIENT'],
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConversationsController>(ConversationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('role authorization', () => {
    it('declares ADMIN, SUPER_ADMIN, CLIENT roles on the controller', () => {
      const roles = Reflect.getMetadata('roles', ConversationsController);
      expect(roles).toEqual(['ADMIN', 'SUPER_ADMIN', 'CLIENT']);
    });
  });

  describe('list', () => {
    const defaultQuery = {
      page: 1,
      limit: 20,
      sortBy: 'lastMessageAt' as const,
      sortOrder: 'desc' as const,
    };

    const mockPage = {
      data: [
        {
          id: 's1',
          sessionId: 'sess_1',
          agent: { id: agentId, name: 'Agent A' },
          organizationId: orgId,
          source: 'WIDGET' as const,
          status: 'ACTIVE' as const,
          visitorId: '1.2.3.4',
          title: 'Pricing question',
          messageCount: 6,
          createdAt: '2026-05-10T10:00:00.000Z',
          lastMessageAt: '2026-05-10T10:05:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };

    it('returns paginated sessions and forwards the query', async () => {
      mockService.list.mockResolvedValue(mockPage);
      const result = await controller.list(defaultQuery, adminUser);
      expect(result).toEqual(mockPage);
      expect(mockService.list).toHaveBeenCalledWith(defaultQuery, adminUser);
    });

    it('passes agent and source filters through to the service', async () => {
      const query = { ...defaultQuery, agentId, source: 'WIDGET' as const };
      mockService.list.mockResolvedValue(mockPage);
      await controller.list(query, clientUser);
      expect(mockService.list).toHaveBeenCalledWith(query, clientUser);
    });
  });

  describe('getOne', () => {
    it('returns conversation detail by sessionId', async () => {
      const detail = {
        id: 's1',
        sessionId: 'sess_1',
        source: 'WIDGET',
        status: 'ACTIVE',
        visitorId: '1.2.3.4',
        title: 'Pricing',
        summary: null,
        createdAt: '2026-05-10T10:00:00.000Z',
        updatedAt: '2026-05-10T10:05:00.000Z',
        lastMessageAt: '2026-05-10T10:05:00.000Z',
        agent: { id: agentId, name: 'Agent A', organization: null },
        messages: [],
        traces: [],
      };
      mockService.getBySessionId.mockResolvedValue(detail);

      const result = await controller.getOne({ sessionId: 'sess_1' }, adminUser);
      expect(result).toEqual(detail);
      expect(mockService.getBySessionId).toHaveBeenCalledWith('sess_1', adminUser);
    });
  });

  describe('validation', () => {
    const listPipe = new ZodValidationPipe(conversationsListQuerySchema);
    const paramPipe = new ZodValidationPipe(conversationDetailParamsSchema);

    it('applies defaults when no query is supplied', () => {
      const result = listPipe.transform({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe('lastMessageAt');
      expect(result.sortOrder).toBe('desc');
    });

    it('coerces page and limit from strings', () => {
      const result = listPipe.transform({ page: '3', limit: '50' });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
    });

    it('rejects limit greater than 100', () => {
      expect(() => listPipe.transform({ limit: '200' })).toThrow(BadRequestException);
    });

    it('rejects invalid agentId UUID', () => {
      expect(() => listPipe.transform({ agentId: 'not-a-uuid' })).toThrow(BadRequestException);
    });

    it('splits comma-separated agentIds and validates each as UUID', () => {
      const a = '111e4567-e89b-12d3-a456-426614174000';
      const b = '222e4567-e89b-12d3-a456-426614174000';
      const result = listPipe.transform({ agentIds: `${a},${b}` });
      expect(result.agentIds).toEqual([a, b]);
    });

    it('rejects invalid source', () => {
      expect(() => listPipe.transform({ source: 'TELEGRAM' })).toThrow(BadRequestException);
    });

    it('rejects from > to', () => {
      expect(() =>
        listPipe.transform({
          from: '2026-05-20T00:00:00Z',
          to: '2026-05-10T00:00:00Z',
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts from <= to', () => {
      const result = listPipe.transform({
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-31T23:59:59Z',
      });
      expect(result.from).toBe('2026-05-01T00:00:00Z');
      expect(result.to).toBe('2026-05-31T23:59:59Z');
    });

    it('rejects invalid sortBy', () => {
      expect(() => listPipe.transform({ sortBy: 'bogus' })).toThrow(BadRequestException);
    });

    it('requires sessionId on detail params', () => {
      expect(() => paramPipe.transform({})).toThrow(BadRequestException);
    });

    it('accepts a valid sessionId', () => {
      const result = paramPipe.transform({ sessionId: 'sess_abc' });
      expect(result.sessionId).toBe('sess_abc');
    });
  });
});
