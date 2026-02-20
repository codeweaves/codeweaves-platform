import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentThemesService } from '../../../src/services/agent-themes.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentLoggerService } from '../../../src/common/logger/agent.logger';
import { Role } from '@prisma/client';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { defaultWidgetTheme, widgetThemeSchema } from '../../../src/models/agent-theme.dto';
import { ZodValidationPipe } from '../../../src/pipes/zod-validation.pipe';
import type { WidgetTheme } from '../../../src/models/agent-theme.dto';

describe('AgentThemesService', () => {
  let service: AgentThemesService;

  const mockPrismaService = {
    agent: {
      findFirst: jest.fn(),
    },
    agentTheme: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAgentLogger = {
    logThemeUpdated: jest.fn(),
    logThemeReset: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const otherOrgId = '223e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  const mockAgent = {
    id: agentId,
    organizationId: orgId,
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
    email: 'superadmin@test.com',
    roles: ['SUPER_ADMIN'],
    id: 'super-admin-user-id',
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

  const otherOrgClient: CurrentUserData = {
    auth0Id: 'auth0|other',
    email: 'other@test.com',
    roles: ['CLIENT'],
    id: 'other-user-id',
    role: Role.CLIENT,
    organizationId: otherOrgId,
    organization: { id: otherOrgId, name: 'Other Org', slug: 'other-org' },
  };

  const customTheme: WidgetTheme = {
    ...defaultWidgetTheme,
    header: { ...defaultWidgetTheme.header, title: 'Custom Title' },
  };

  beforeEach(async () => {
    // Default: $transaction executes the callback with the mock prisma service itself
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentThemesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentLoggerService, useValue: mockAgentLogger },
      ],
    }).compile();

    service = module.get<AgentThemesService>(AgentThemesService);
    jest.clearAllMocks();

    // Re-apply $transaction default after clearAllMocks
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTheme', () => {
    it('should return default theme with version 0 when no theme record exists (AC9)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, adminUser).then((result) => {
        expect(result).toEqual({ config: defaultWidgetTheme, version: 0 });
      });
    });

    it('should return existing theme when record exists (AC1)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: customTheme,
        version: 3,
      });

      return service.getTheme(agentId, adminUser).then((result) => {
        expect(result).toEqual({ config: customTheme, version: 3 });
      });
    });

    it('should throw NotFoundException when agent does not exist', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.getTheme(agentId, adminUser)).rejects.toThrow(NotFoundException);
    });

    it('should scope CLIENT users to their own org (AC7)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return service.getTheme(agentId, otherOrgClient).catch(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
            organizationId: otherOrgId,
          },
        });
      });
    });

    it('should not scope ADMIN users by org', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, adminUser).then(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
          },
        });
      });
    });

    it('should not scope SUPER_ADMIN users by org (AC7)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, superAdminUser).then(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
          },
        });
      });
    });
  });

  describe('updateTheme', () => {
    it('should create theme record if none exists via upsert (AC2, AC5)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: customTheme,
        version: 1,
      });

      return service.updateTheme(agentId, customTheme, adminUser).then((result) => {
        expect(result).toEqual({ config: customTheme, version: 1 });
        expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { agentId },
            create: expect.objectContaining({ agentId, version: 1 }),
            update: expect.objectContaining({ version: { increment: 1 } }),
          }),
        );
        expect(mockAgentLogger.logThemeUpdated).toHaveBeenCalledWith(agentId, adminUser.id);
      });
    });

    it('should replace full config and increment version (AC2, AC5)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: customTheme,
        version: 4,
      });

      return service.updateTheme(agentId, customTheme, adminUser).then((result) => {
        expect(result.version).toBe(4);
        expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ version: { increment: 1 } }),
          }),
        );
      });
    });

    it('should throw NotFoundException for non-existent agent', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.updateTheme(agentId, customTheme, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('patchTheme', () => {
    it('should deep merge partial config into existing theme within a transaction (AC3)', () => {
      const existingConfig = { ...defaultWidgetTheme };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: existingConfig,
        version: 2,
      });

      const mergedConfig = {
        ...existingConfig,
        header: { ...existingConfig.header, title: 'Patched Title' },
      };

      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: mergedConfig,
        version: 3,
      });

      return service
        .patchTheme(agentId, { header: { title: 'Patched Title' } }, adminUser)
        .then((result) => {
          expect(result.version).toBe(3);
          expect(mockPrismaService.$transaction).toHaveBeenCalled();
          const upsertCall = mockPrismaService.agentTheme.upsert.mock.calls[0][0];
          const savedConfig = upsertCall.update.config as WidgetTheme;
          expect(savedConfig.header.title).toBe('Patched Title');
          expect(savedConfig.header.backgroundColor).toBe(
            defaultWidgetTheme.header.backgroundColor,
          );
        });
    });

    it('should merge into default theme when no record exists (AC3, AC9)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: { ...defaultWidgetTheme, header: { ...defaultWidgetTheme.header, title: 'New' } },
        version: 1,
      });

      return service
        .patchTheme(agentId, { header: { title: 'New' } }, adminUser)
        .then(() => {
          const upsertCall = mockPrismaService.agentTheme.upsert.mock.calls[0][0];
          const savedConfig = upsertCall.create.config as WidgetTheme;
          expect(savedConfig.header.title).toBe('New');
          expect(savedConfig.icon).toEqual(defaultWidgetTheme.icon);
        });
    });

    it('should increment version on patch (AC5)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: defaultWidgetTheme,
        version: 5,
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: defaultWidgetTheme,
        version: 6,
      });

      return service
        .patchTheme(agentId, { body: { backgroundColor: '#000' } }, adminUser)
        .then(() => {
          expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              update: expect.objectContaining({ version: { increment: 1 } }),
            }),
          );
        });
    });
  });

  describe('resetTheme', () => {
    it('should set config to defaults and increment version (AC4, AC5)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: 'theme-id',
        agentId,
        config: defaultWidgetTheme,
        version: 4,
      });

      return service.resetTheme(agentId, adminUser).then((result) => {
        expect(result.config).toEqual(defaultWidgetTheme);
        expect(result.version).toBe(4);
        expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { agentId },
            create: expect.objectContaining({ agentId, version: 1 }),
            update: expect.objectContaining({ version: { increment: 1 } }),
          }),
        );
        expect(mockAgentLogger.logThemeReset).toHaveBeenCalledWith(agentId, adminUser.id);
      });
    });

    it('should throw NotFoundException for non-existent agent', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.resetTheme(agentId, adminUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('ensureAgentAccess (via CLIENT scoping)', () => {
    it('should allow CLIENT to access own org agent (AC7)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, clientUser).then((result) => {
        expect(result).toBeDefined();
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
            organizationId: orgId,
          },
        });
      });
    });

    it('should reject CLIENT accessing another org agent (AC7)', () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.getTheme(agentId, otherOrgClient)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('validation (AC8)', () => {
    it('should reject invalid config via ZodValidationPipe on PUT', () => {
      const pipe = new ZodValidationPipe(widgetThemeSchema);
      const invalidConfig = { header: { title: 'only header' } };

      expect(() => pipe.transform(invalidConfig)).toThrow(BadRequestException);
    });
  });
});
