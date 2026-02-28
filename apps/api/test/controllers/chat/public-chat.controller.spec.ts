import { Test, TestingModule } from '@nestjs/testing';
import { PublicChatController } from '../../../src/controllers/public/public-chat.controller';
import { ChatService } from '../../../src/services/chat.service';

describe('PublicChatController', () => {
  let controller: PublicChatController;

  const mockChatService = {};

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
});
