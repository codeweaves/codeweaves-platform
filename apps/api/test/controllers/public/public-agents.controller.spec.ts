import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicAgentsController } from '../../../src/controllers/public/public-agents.controller';
import { AgentsService } from '../../../src/services/agents.service';

describe('PublicAgentsController', () => {
  let controller: PublicAgentsController;

  const mockAgentsService = {
    getDemoInfo: jest.fn(),
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
          starters: [{ text: 'Hi', message: 'Hello there' }],
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
});
