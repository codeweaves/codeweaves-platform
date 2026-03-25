import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicAgentsController } from '../../../src/controllers/public/public-agents.controller';
import { AgentsService } from '../../../src/services/agents.service';

describe('PublicAgentsController', () => {
  let controller: PublicAgentsController;

  const mockAgentsService = {
    getDemoInfo: jest.fn(),
    getWidgetConfig: jest.fn(),
  };

  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicAgentsController],
      providers: [
        { provide: AgentsService, useValue: mockAgentsService },
      ],
    }).compile();

    controller = module.get<PublicAgentsController>(PublicAgentsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /public/agents/:id/demo', () => {
    it('should return demo info for an active agent', async () => {
      const demoInfo = {
        id: agentId,
        publicId: 'abc123',
        name: 'Test Agent',
        welcomeMessage: 'Hello!',
        theme: {
          header: { title: 'Test', backgroundColor: '#1e40af' },
          starters: [{ message: 'Hello there' }],
        },
      };
      mockAgentsService.getDemoInfo.mockResolvedValue(demoInfo);

      const result = await controller.getDemoInfo(agentId);

      expect(result).toEqual(demoInfo);
      expect(mockAgentsService.getDemoInfo).toHaveBeenCalledWith(agentId);
    });

    it('should return theme as null when no theme exists', async () => {
      const demoInfo = {
        id: agentId,
        publicId: 'abc123',
        name: 'Test Agent',
        welcomeMessage: null,
        theme: null,
      };
      mockAgentsService.getDemoInfo.mockResolvedValue(demoInfo);

      const result = await controller.getDemoInfo(agentId);

      expect(result.theme).toBeNull();
    });

    it('should throw NotFoundException for inactive agent', async () => {
      mockAgentsService.getDemoInfo.mockRejectedValue(
        new NotFoundException('Agent not found'),
      );

      await expect(controller.getDemoInfo(agentId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for deleted agent', async () => {
      mockAgentsService.getDemoInfo.mockRejectedValue(
        new NotFoundException('Agent not found'),
      );

      await expect(controller.getDemoInfo(agentId)).rejects.toThrow(
        'Agent not found',
      );
    });

    it('should throw NotFoundException for non-existent agent', async () => {
      const nonExistentId = '999e4567-e89b-12d3-a456-426614174999';
      mockAgentsService.getDemoInfo.mockRejectedValue(
        new NotFoundException('Agent not found'),
      );

      await expect(controller.getDemoInfo(nonExistentId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockAgentsService.getDemoInfo).toHaveBeenCalledWith(nonExistentId);
    });
  });

  describe('GET /public/agents/:publicId/config', () => {
    const publicId = 'AbCd1234';

    const mockRes = {
      setHeader: jest.fn(),
      status: jest.fn(),
    } as unknown as { setHeader: jest.Mock; status: jest.Mock };

    const widgetConfig = {
      config: {
        theme: { icon: { position: 'right' } },
        agent: { name: 'Test Agent', greeting: 'Hello!', starters: ['Hi'] },
        allowedDomains: ['example.com'],
      },
      version: 3,
    };

    it('should return config with ETag header on 200', async () => {
      mockAgentsService.getWidgetConfig.mockResolvedValue(widgetConfig);

      const result = await controller.getWidgetConfig(publicId, undefined, mockRes);

      expect(result).toEqual(widgetConfig.config);
      expect(mockRes.setHeader).toHaveBeenCalledWith('ETag', '"3"');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockAgentsService.getWidgetConfig).toHaveBeenCalledWith(publicId);
    });

    it('should return 304 when If-None-Match matches ETag', async () => {
      mockAgentsService.getWidgetConfig.mockResolvedValue(widgetConfig);

      const result = await controller.getWidgetConfig(publicId, '"3"', mockRes);

      expect(result).toBeUndefined();
      expect(mockRes.status).toHaveBeenCalledWith(304);
    });

    it('should return fresh config when If-None-Match does not match', async () => {
      mockAgentsService.getWidgetConfig.mockResolvedValue(widgetConfig);

      const result = await controller.getWidgetConfig(publicId, '"1"', mockRes);

      expect(result).toEqual(widgetConfig.config);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown publicId', async () => {
      mockAgentsService.getWidgetConfig.mockRejectedValue(
        new NotFoundException('Agent not found'),
      );

      await expect(
        controller.getWidgetConfig('unknown1', undefined, mockRes),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
