import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IntegrationsController } from '../../../src/modules/integrations/integrations.controller';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;

  const mockService = {
    list: jest.fn(),
    upsert: jest.fn(),
    test: jest.fn(),
    setEnabled: jest.fn(),
    remove: jest.fn(),
  };

  const user = {
    id: 'u1',
    role: Role.CLIENT,
    organizationId: 'org1',
  } as CurrentUserData;
  const agentId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: IntegrationsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(IntegrationsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('list() delegates with the current user', async () => {
    mockService.list.mockResolvedValue([{ provider: 'hubspot' }]);
    const res = await controller.list(agentId, user);
    expect(res).toEqual([{ provider: 'hubspot' }]);
    expect(mockService.list).toHaveBeenCalledWith(agentId, user);
  });

  it('upsert() forwards provider, dto and user', async () => {
    const dto = {
      credentials: { accessToken: 'pat-na1-token' },
      enabled: true,
    };
    mockService.upsert.mockResolvedValue({ provider: 'hubspot' });
    await controller.upsert(agentId, 'hubspot', dto, user);
    expect(mockService.upsert).toHaveBeenCalledWith(
      agentId,
      'hubspot',
      dto,
      user,
    );
  });

  it('test() forwards provider and user and returns the result', async () => {
    mockService.test.mockResolvedValue({ ok: true, message: 'Connected' });
    const res = await controller.test(agentId, 'slack', user);
    expect(res).toEqual({ ok: true, message: 'Connected' });
    expect(mockService.test).toHaveBeenCalledWith(agentId, 'slack', user);
  });

  it('setEnabled() forwards the enabled flag', async () => {
    mockService.setEnabled.mockResolvedValue({ enabled: false });
    await controller.setEnabled(agentId, 'hubspot', { enabled: false }, user);
    expect(mockService.setEnabled).toHaveBeenCalledWith(
      agentId,
      'hubspot',
      false,
      user,
    );
  });

  it('remove() forwards provider and user and resolves void', async () => {
    mockService.remove.mockResolvedValue(undefined);
    await expect(
      controller.remove(agentId, 'slack', user),
    ).resolves.toBeUndefined();
    expect(mockService.remove).toHaveBeenCalledWith(agentId, 'slack', user);
  });

  it('propagates service errors (failed live test → 400) unchanged', async () => {
    const err = new Error('Connection test failed: HTTP 401');
    mockService.upsert.mockRejectedValue(err);
    await expect(
      controller.upsert(
        agentId,
        'hubspot',
        { credentials: { accessToken: 'pat-bad' }, enabled: true },
        user,
      ),
    ).rejects.toBe(err);
  });
});
