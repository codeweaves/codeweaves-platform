import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { WhatsappChannelController } from '../../../src/modules/whatsapp/whatsapp-channel.controller';
import type { ConnectWhatsappChannelDto } from '../../../src/modules/whatsapp/whatsapp-channel.dto';
import type { WhatsappChannelService } from '../../../src/modules/whatsapp/whatsapp-channel.service';

describe('WhatsappChannelController', () => {
  let svc: {
    getByAgent: jest.Mock;
    connect: jest.Mock;
    setVoiceReply: jest.Mock;
    disconnect: jest.Mock;
  };
  let controller: WhatsappChannelController;

  const user = { id: 'u', organizationId: 'org' } as unknown as CurrentUserData;
  const agentId = '333e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    svc = {
      getByAgent: jest.fn(),
      connect: jest.fn(),
      setVoiceReply: jest.fn(),
      disconnect: jest.fn(),
    };
    controller = new WhatsappChannelController(
      svc as unknown as WhatsappChannelService,
    );
  });

  it('get delegates to the service', async () => {
    svc.getByAgent.mockResolvedValue(null);
    await controller.get(agentId, user);
    expect(svc.getByAgent).toHaveBeenCalledWith(agentId, user);
  });

  it('connect delegates to the service', async () => {
    const dto: ConnectWhatsappChannelDto = {
      wabaId: 'w',
      phoneNumberId: 'p',
      displayPhone: 'd',
      accessToken: 't',
    };
    svc.connect.mockResolvedValue({ id: 'c' });
    await controller.connect(agentId, dto, user);
    expect(svc.connect).toHaveBeenCalledWith(agentId, dto, user);
  });

  it('update delegates to the service', async () => {
    const dto = { voiceReplyEnabled: true };
    svc.setVoiceReply.mockResolvedValue({ id: 'c', voiceReplyEnabled: true });
    await controller.update(agentId, dto, user);
    expect(svc.setVoiceReply).toHaveBeenCalledWith(agentId, dto, user);
  });

  it('disconnect delegates to the service', async () => {
    svc.disconnect.mockResolvedValue(undefined);
    await controller.disconnect(agentId, user);
    expect(svc.disconnect).toHaveBeenCalledWith(agentId, user);
  });
});
