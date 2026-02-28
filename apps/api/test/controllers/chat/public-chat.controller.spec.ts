import { Test, TestingModule } from '@nestjs/testing';
import { PublicChatController } from '../../../src/controllers/public/public-chat.controller';
import { ChatService } from '../../../src/services/chat.service';

describe('PublicChatController', () => {
  let controller: PublicChatController;

  const mockChatService = {
    sendMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicChatController],
      providers: [{ provide: ChatService, useValue: mockChatService }],
    }).compile();

    controller = module.get<PublicChatController>(PublicChatController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendMessage', () => {
    const dto = {
      chatInput: 'Hello!',
      agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    };

    const mockResponse = {
      sessionId: 'session-uuid',
      messageId: 'msg-uuid',
      reply: 'AI response',
      assistantMessageId: 'assistant-msg-uuid',
      metadata: {
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.500Z',
        agentRepliedAt: '2026-03-01T10:00:01.200Z',
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
      },
    };

    it('should call chatService.sendMessage and return result', async () => {
      mockChatService.sendMessage.mockResolvedValue(mockResponse);

      const result = await controller.sendMessage(dto);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResponse);
    });

    it('should pass through the dto with sessionId', async () => {
      const dtoWithSession = { ...dto, sessionId: 'existing-session' };
      mockChatService.sendMessage.mockResolvedValue(mockResponse);

      await controller.sendMessage(dtoWithSession);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dtoWithSession);
    });
  });
});
