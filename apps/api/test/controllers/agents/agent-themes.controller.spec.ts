import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentThemesController } from '../../../src/controllers/agents/agent-themes.controller';
import { AgentThemesService } from '../../../src/services/agent-themes.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { defaultWidgetTheme } from '../../../src/models/agent-theme.dto';
import type { WidgetTheme } from '../../../src/models/agent-theme.dto';

describe('AgentThemesController', () => {
  let controller: AgentThemesController;

  const mockThemesService = {
    getTheme: jest.fn(),
    updateTheme: jest.fn(),
    patchTheme: jest.fn(),
    resetTheme: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  const adminUser: CurrentUserData = {
    clerkId: 'user_admin',
    email: 'admin@test.com',
    id: 'admin-user-id',
    role: Role.ADMIN,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const customTheme: WidgetTheme = {
    ...defaultWidgetTheme,
    header: { ...defaultWidgetTheme.header, title: 'Custom Title' },
  };

  const mockResponse = {
    setHeader: jest.fn(),
  } as unknown as import('express').Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentThemesController],
      providers: [
        { provide: AgentThemesService, useValue: mockThemesService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentThemesController>(AgentThemesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /agents/:id/theme', () => {
    it('should return default theme when no record exists (AC1, AC9)', () => {
      const themeResult = { config: defaultWidgetTheme, version: 0 };
      mockThemesService.getTheme.mockResolvedValue(themeResult);

      return controller.getTheme(agentId, adminUser, mockResponse).then((result) => {
        expect(result).toEqual(themeResult);
        expect(mockThemesService.getTheme).toHaveBeenCalledWith(agentId, adminUser);
      });
    });

    it('should set ETag header with version number (AC6)', () => {
      mockThemesService.getTheme.mockResolvedValue({ config: customTheme, version: 5 });

      return controller.getTheme(agentId, adminUser, mockResponse).then(() => {
        expect(mockResponse.setHeader).toHaveBeenCalledWith('ETag', '"5"');
      });
    });

    it('should set ETag "0" for default theme (AC6, AC9)', () => {
      mockThemesService.getTheme.mockResolvedValue({ config: defaultWidgetTheme, version: 0 });

      return controller.getTheme(agentId, adminUser, mockResponse).then(() => {
        expect(mockResponse.setHeader).toHaveBeenCalledWith('ETag', '"0"');
      });
    });

    it('should propagate NotFoundException from service', () => {
      mockThemesService.getTheme.mockRejectedValue(new NotFoundException('Agent not found'));

      return expect(controller.getTheme(agentId, adminUser, mockResponse)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('PUT /agents/:id/theme', () => {
    it('should call updateTheme with full config (AC2)', () => {
      const themeResult = { config: customTheme, version: 1 };
      mockThemesService.updateTheme.mockResolvedValue(themeResult);

      return controller.updateTheme(agentId, customTheme, adminUser).then((result) => {
        expect(result).toEqual(themeResult);
        expect(mockThemesService.updateTheme).toHaveBeenCalledWith(agentId, customTheme, adminUser);
      });
    });

    it('should propagate NotFoundException from service', () => {
      mockThemesService.updateTheme.mockRejectedValue(new NotFoundException('Agent not found'));

      return expect(
        controller.updateTheme(agentId, customTheme, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PATCH /agents/:id/theme', () => {
    it('should call patchTheme with partial config (AC3)', () => {
      const partial = { header: { title: 'Patched' } };
      const themeResult = { config: { ...defaultWidgetTheme, header: { ...defaultWidgetTheme.header, title: 'Patched' } }, version: 2 };
      mockThemesService.patchTheme.mockResolvedValue(themeResult);

      return controller.patchTheme(agentId, partial, adminUser).then((result) => {
        expect(result).toEqual(themeResult);
        expect(mockThemesService.patchTheme).toHaveBeenCalledWith(agentId, partial, adminUser);
      });
    });
  });

  describe('POST /agents/:id/theme/reset', () => {
    it('should call resetTheme and return defaults (AC4)', () => {
      const themeResult = { config: defaultWidgetTheme, version: 3 };
      mockThemesService.resetTheme.mockResolvedValue(themeResult);

      return controller.resetTheme(agentId, adminUser).then((result) => {
        expect(result).toEqual(themeResult);
        expect(mockThemesService.resetTheme).toHaveBeenCalledWith(agentId, adminUser);
      });
    });
  });
});
