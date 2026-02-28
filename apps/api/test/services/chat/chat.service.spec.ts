import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../../../src/services/chat.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentsService } from '../../../src/services/agents.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

describe('ChatService', () => {
  let service: ChatService;

  const mockPrismaService = {
    chatSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAgentsService = {
    findOne: jest.fn(),
    getDemoInfo: jest.fn(),
  };

  const mockCryptoService = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: CryptoService, useValue: mockCryptoService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
