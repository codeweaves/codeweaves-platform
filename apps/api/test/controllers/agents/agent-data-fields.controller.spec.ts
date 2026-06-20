import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { UpdateDataFieldsDto } from '@repo/validation';
import { AgentDataFieldsController } from '../../../src/controllers/agents/agent-data-fields.controller';
import { AgentDataFieldsService } from '../../../src/services/agent-data-fields.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentDataFieldsController', () => {
  let controller: AgentDataFieldsController;

  const mockService = {
    list: jest.fn(),
    replaceAll: jest.fn(),
    listCollectedData: jest.fn(),
  };

  const user = {
    id: 'u1',
    role: Role.ADMIN,
    organizationId: 'org1',
  } as CurrentUserData;
  const agentId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AgentDataFieldsController],
      providers: [
        { provide: AgentDataFieldsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AgentDataFieldsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('list() delegates to the service with the current user', async () => {
    mockService.list.mockResolvedValue([{ key: 'email' }]);
    const res = await controller.list(agentId, user);
    expect(res).toEqual([{ key: 'email' }]);
    expect(mockService.list).toHaveBeenCalledWith(agentId, user);
  });

  it('replace() forwards the dto and user to the service', async () => {
    const dto: UpdateDataFieldsDto = {
      fields: [
        { key: 'email', label: 'Email', type: 'EMAIL', required: true },
      ],
    };
    mockService.replaceAll.mockResolvedValue([]);
    await controller.replace(agentId, dto, user);
    expect(mockService.replaceAll).toHaveBeenCalledWith(agentId, dto, user);
  });

  it('collected() delegates to the service with the current user', async () => {
    mockService.listCollectedData.mockResolvedValue([]);
    await controller.collected(agentId, user);
    expect(mockService.listCollectedData).toHaveBeenCalledWith(agentId, user);
  });
});
