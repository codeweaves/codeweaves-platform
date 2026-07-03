import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { HandoverController } from '../../../src/controllers/handover/handover.controller';
import { HandoverService } from '../../../src/services/handover.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('HandoverController', () => {
  let controller: HandoverController;

  const mockService = {
    listInbox: jest.fn(),
    getThread: jest.fn(),
    takeover: jest.fn(),
    postMessage: jest.fn(),
    resolve: jest.fn(),
  };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const clientUser: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@test.com',
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HandoverController],
      providers: [{ provide: HandoverService, useValue: mockService }, Reflector],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HandoverController>(HandoverController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('inbox() delegates to listInbox with the query + user', async () => {
    mockService.listInbox.mockResolvedValue([]);
    await controller.inbox({ filter: 'needs' }, clientUser);
    expect(mockService.listInbox).toHaveBeenCalledWith({ filter: 'needs' }, clientUser);
  });

  it('thread() delegates to getThread with the sessionId', async () => {
    mockService.getThread.mockResolvedValue({});
    await controller.thread({ sessionId: 'sess-pub' }, clientUser);
    expect(mockService.getThread).toHaveBeenCalledWith('sess-pub', clientUser);
  });

  it('takeover() delegates', async () => {
    mockService.takeover.mockResolvedValue({});
    await controller.takeover({ sessionId: 'sess-pub' }, clientUser);
    expect(mockService.takeover).toHaveBeenCalledWith('sess-pub', clientUser);
  });

  it('message() passes the body content through', async () => {
    mockService.postMessage.mockResolvedValue({});
    await controller.message({ sessionId: 'sess-pub' }, { content: 'hi there' }, clientUser);
    expect(mockService.postMessage).toHaveBeenCalledWith('sess-pub', clientUser, 'hi there');
  });

  it('resolve() delegates', async () => {
    mockService.resolve.mockResolvedValue({});
    await controller.resolve({ sessionId: 'sess-pub' }, clientUser);
    expect(mockService.resolve).toHaveBeenCalledWith('sess-pub', clientUser);
  });
});
