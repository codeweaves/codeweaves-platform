import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadGatewayException } from '@nestjs/common';
import { ChatService } from '../../../src/services/chat.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentsService } from '../../../src/services/agents.service';

describe('ChatService', () => {
  let service: ChatService;

  const mockPrismaService = {
    agent: {
      findFirst: jest.fn(),
    },
    chatSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAgentsService = {
    getEffectiveWebhookUrl: jest.fn(),
  };

  const MOCK_AGENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const MOCK_SESSION_ID = 'session-uuid-1234';
  const MOCK_SESSION_DB_ID = 'db-session-uuid-1234';
  const MOCK_USER_MSG_ID = 'user-msg-uuid-1234';
  const MOCK_ASSISTANT_MSG_ID = 'assistant-msg-uuid-1234';
  const MOCK_WEBHOOK_URL = 'https://n8n.example.com/webhook/test';

  const mockSession = {
    id: MOCK_SESSION_DB_ID,
    agentId: MOCK_AGENT_ID,
    sessionId: MOCK_SESSION_ID,
    source: 'DEMO',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: null,
  };

  const mockN8nResponse = {
    agentReply: 'Hello! How can I help you?',
    sessionId: MOCK_SESSION_ID,
    n8nReceivedAt: '2026-03-01T10:00:00.500Z',
    agentRepliedAt: '2026-03-01T10:00:01.200Z',
  };

  const originalFetch = global.fetch;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentsService, useValue: mockAgentsService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();

    // Default mocks for a successful flow
    mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID });
    mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue(MOCK_WEBHOOK_URL);
    mockPrismaService.chatSession.create.mockResolvedValue(mockSession);
    // $transaction returns an array of results: [userMessage, assistantMessage, updatedSession]
    mockPrismaService.$transaction.mockResolvedValue([
      { id: MOCK_USER_MSG_ID },
      { id: MOCK_ASSISTANT_MSG_ID },
      mockSession,
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockN8nResponse),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    const baseDto = {
      chatInput: 'Hello, AI!',
      agentId: MOCK_AGENT_ID,
    };

    describe('successful message send + n8n call + response storage', () => {
      it('should send a message, call n8n, and store the response', async () => {
        const result = await service.sendMessage(baseDto);

        expect(result).toEqual(expect.objectContaining({
          sessionId: MOCK_SESSION_ID,
          messageId: MOCK_USER_MSG_ID,
          reply: mockN8nResponse.agentReply,
          assistantMessageId: MOCK_ASSISTANT_MSG_ID,
        }));
        expect(result.metadata).toEqual(expect.objectContaining({
          backendReceivedAt: expect.any(String),
          n8nReceivedAt: mockN8nResponse.n8nReceivedAt,
          agentRepliedAt: mockN8nResponse.agentRepliedAt,
          backendRespondedAt: expect.any(String),
          responseLatencyMs: expect.any(Number),
        }));
      });

      it('should call n8n webhook with correct payload', async () => {
        await service.sendMessage(baseDto);

        expect(global.fetch).toHaveBeenCalledWith(
          MOCK_WEBHOOK_URL,
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatInput: 'Hello, AI!', sessionId: MOCK_SESSION_ID }),
          }),
        );
      });

      it('should call webhook BEFORE storing messages (no orphaned messages on failure)', async () => {
        await service.sendMessage(baseDto);

        // Verify fetch was called
        expect(global.fetch).toHaveBeenCalledTimes(1);
        // Verify $transaction was called (messages stored after webhook)
        expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      });

      it('should store user and assistant messages in a transaction', async () => {
        await service.sendMessage(baseDto);

        // $transaction receives an array of 3 Prisma promises
        const transactionArg = mockPrismaService.$transaction.mock.calls[0][0];
        expect(Array.isArray(transactionArg)).toBe(true);
        expect(transactionArg).toHaveLength(3);
      });

      it('should not store messages if webhook fails', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('should update session lastMessageAt', async () => {
        await service.sendMessage(baseDto);

        // Session update is part of the transaction
        expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('new session creation (no sessionId)', () => {
      it('should create a new ChatSession when no sessionId is provided', async () => {
        await service.sendMessage(baseDto);

        expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
          data: {
            agentId: MOCK_AGENT_ID,
            sessionId: expect.any(String),
            source: 'DEMO',
          },
        });
        expect(mockPrismaService.chatSession.findFirst).not.toHaveBeenCalled();
      });

      it('should return the sessionId from the created session', async () => {
        const result = await service.sendMessage(baseDto);
        expect(result.sessionId).toBe(MOCK_SESSION_ID);
      });
    });

    describe('existing session reuse (sessionId provided)', () => {
      const dtoWithSession = {
        ...baseDto,
        sessionId: MOCK_SESSION_ID,
      };

      it('should look up existing session and reuse it', async () => {
        mockPrismaService.chatSession.findFirst.mockResolvedValue(mockSession);

        const result = await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith({
          where: {
            sessionId: MOCK_SESSION_ID,
            agentId: MOCK_AGENT_ID,
            status: 'ACTIVE',
          },
        });
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
        expect(result.sessionId).toBe(MOCK_SESSION_ID);
      });

      it('should throw NotFoundException when session not found', async () => {
        mockPrismaService.chatSession.findFirst.mockResolvedValue(null);

        await expect(service.sendMessage(dtoWithSession)).rejects.toThrow(NotFoundException);
        await expect(service.sendMessage(dtoWithSession)).rejects.toThrow(
          'Session not found or does not belong to this agent',
        );
      });
    });

    describe('agent not found / inactive', () => {
      it('should throw NotFoundException when agent does not exist', async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue(null);

        await expect(service.sendMessage(baseDto)).rejects.toThrow(NotFoundException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Agent not found or inactive',
        );
      });

      it('should verify agent is ACTIVE and not deleted', async () => {
        await service.sendMessage(baseDto);

        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: { id: MOCK_AGENT_ID, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
      });
    });

    describe('n8n timeout handling', () => {
      it('should throw BadGatewayException on timeout', async () => {
        const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Response is taking too long, please try again',
        );
      });
    });

    describe('n8n network error handling', () => {
      it('should throw BadGatewayException on network error', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Unable to connect to AI service, please try again',
        );
      });

      it('should throw BadGatewayException when n8n returns non-ok status', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 500,
        });

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'AI service returned an error, please try again',
        );
      });
    });

    describe('webhook URL fallback', () => {
      it('should use AgentsService.getEffectiveWebhookUrl for URL resolution', async () => {
        await service.sendMessage(baseDto);

        expect(mockAgentsService.getEffectiveWebhookUrl).toHaveBeenCalledWith(MOCK_AGENT_ID);
      });

      it('should throw when no webhook URL is configured (getEffectiveWebhookUrl throws)', async () => {
        mockAgentsService.getEffectiveWebhookUrl.mockRejectedValue(
          new NotFoundException('No webhook URL configured for this agent'),
        );

        await expect(service.sendMessage(baseDto)).rejects.toThrow(NotFoundException);
      });
    });

    describe('response format parsing', () => {
      it('should parse object response with agentReply', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            agentReply: 'Object response',
            n8nReceivedAt: '2026-03-01T10:00:00Z',
            agentRepliedAt: '2026-03-01T10:00:01Z',
          }),
        });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Object response');
      });

      it('should parse array response with agentReply', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve([{
            agentReply: 'Array response',
            n8nReceivedAt: '2026-03-01T10:00:00Z',
            agentRepliedAt: '2026-03-01T10:00:01Z',
          }]),
        });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Array response');
      });

      it('should fallback to output field when agentReply is missing', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ output: 'Fallback output response' }),
        });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Fallback output response');
      });

      it('should fallback to output field in array format', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve([{ output: 'Array fallback output' }]),
        });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Array fallback output');
      });

      it('should throw BadGatewayException when response has no agentReply or output', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ someOtherField: 'unexpected' }),
        });

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Unexpected response format from AI service',
        );
      });

      it('should throw BadGatewayException when response JSON is invalid', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
        });

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Unexpected response format from AI service',
        );
      });

      it('should handle missing n8nReceivedAt and agentRepliedAt timestamps', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ agentReply: 'No timestamps' }),
        });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('No timestamps');
        expect(result.metadata.n8nReceivedAt).toBeNull();
        expect(result.metadata.agentRepliedAt).toBeNull();
      });
    });
  });

  describe('chunkText', () => {
    it('should split text into chunks at word boundaries', () => {
      const chunks = ChatService.chunkText('one two three four five six');
      expect(chunks).toEqual(['one two three ', 'four five six']);
    });

    it('should handle default 3 words per chunk', () => {
      const chunks = ChatService.chunkText('a b c d e f g');
      expect(chunks).toEqual(['a b c ', 'd e f ', 'g']);
    });

    it('should return empty array for empty string', () => {
      expect(ChatService.chunkText('')).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(ChatService.chunkText('   \t\n  ')).toEqual([]);
    });

    it('should return single chunk for short text', () => {
      const chunks = ChatService.chunkText('hello world');
      expect(chunks).toEqual(['hello world']);
    });

    it('should handle single word', () => {
      expect(ChatService.chunkText('hello')).toEqual(['hello']);
    });

    it('should respect custom chunkSize', () => {
      const chunks = ChatService.chunkText('a b c d e f', 2);
      expect(chunks).toEqual(['a b ', 'c d ', 'e f']);
    });

    it('should handle text with multiple whitespace characters', () => {
      const chunks = ChatService.chunkText('one   two\tthree\nfour  five   six');
      expect(chunks).toEqual(['one two three ', 'four five six']);
    });

    it('should never split mid-word', () => {
      const chunks = ChatService.chunkText('longword anotherlongword thirdword');
      for (const chunk of chunks) {
        const words = chunk.trim().split(' ');
        for (const word of words) {
          expect(word).not.toContain(' ');
          expect(word.length).toBeGreaterThan(0);
        }
      }
    });

    it('should produce chunks within expected size range for typical text', () => {
      const text = 'The quick brown fox jumps over the lazy dog and runs away fast into the forest';
      const chunks = ChatService.chunkText(text);
      for (const chunk of chunks) {
        const wordCount = chunk.trim().split(' ').length;
        expect(wordCount).toBeLessThanOrEqual(3);
        expect(wordCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('should concatenate chunks back to original text', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const chunks = ChatService.chunkText(text);
      expect(chunks.join('')).toBe(text);
    });
  });

  describe('streamMessage', () => {
    const baseDto = {
      chatInput: 'Hello, AI!',
      agentId: MOCK_AGENT_ID,
    };

    beforeEach(() => {
      // streamMessage uses direct chatMessage.create (not $transaction)
      mockPrismaService.chatMessage.create
        .mockResolvedValueOnce({ id: MOCK_USER_MSG_ID })
        .mockResolvedValueOnce({ id: MOCK_ASSISTANT_MSG_ID });
      mockPrismaService.chatSession.update.mockResolvedValue(mockSession);
    });

    it('should return sessionId, messageId, chunks, and metadata', async () => {
      const result = await service.streamMessage(baseDto);

      expect(result).toEqual(expect.objectContaining({
        sessionId: MOCK_SESSION_ID,
        messageId: MOCK_USER_MSG_ID,
        assistantMessageId: MOCK_ASSISTANT_MSG_ID,
      }));
      expect(result.chunks).toBeInstanceOf(Array);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.metadata).toEqual(expect.objectContaining({
        backendReceivedAt: expect.any(String),
        backendRespondedAt: expect.any(String),
        responseLatencyMs: expect.any(Number),
      }));
    });

    it('should store user message BEFORE calling n8n', async () => {
      const callOrder: string[] = [];

      mockPrismaService.chatMessage.create.mockReset();
      mockPrismaService.chatMessage.create.mockImplementation(() => {
        callOrder.push('chatMessage.create');
        return Promise.resolve({ id: callOrder.length === 1 ? MOCK_USER_MSG_ID : MOCK_ASSISTANT_MSG_ID });
      });

      (global.fetch as jest.Mock).mockImplementation(() => {
        callOrder.push('fetch');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockN8nResponse),
        });
      });

      await service.streamMessage(baseDto);

      expect(callOrder[0]).toBe('chatMessage.create'); // user message first
      expect(callOrder[1]).toBe('fetch'); // then n8n call
      expect(callOrder[2]).toBe('chatMessage.create'); // then assistant message
    });

    it('should store AI message AFTER n8n response (before streaming)', async () => {
      await service.streamMessage(baseDto);

      // chatMessage.create called twice: user message + assistant message
      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledTimes(2);

      // Second call should store assistant message with n8n reply
      const secondCall = mockPrismaService.chatMessage.create.mock.calls[1][0];
      expect(secondCall.data.role).toBe('ASSISTANT');
      expect(secondCall.data.content).toBe(mockN8nResponse.agentReply);
    });

    it('should chunk the n8n reply text', async () => {
      const result = await service.streamMessage(baseDto);

      // Chunks include trailing spaces — concatenation reconstructs original text
      expect(result.chunks.join('')).toBe(mockN8nResponse.agentReply);
    });

    it('should create a new session when no sessionId provided', async () => {
      await service.streamMessage(baseDto);

      expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
        data: {
          agentId: MOCK_AGENT_ID,
          sessionId: expect.any(String),
          source: 'DEMO',
        },
      });
    });

    it('should reuse existing session when sessionId provided', async () => {
      mockPrismaService.chatSession.findFirst.mockResolvedValue(mockSession);

      await service.streamMessage({ ...baseDto, sessionId: MOCK_SESSION_ID });

      expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith({
        where: { sessionId: MOCK_SESSION_ID, agentId: MOCK_AGENT_ID, status: 'ACTIVE' },
      });
      expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when agent not found', async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(service.streamMessage(baseDto)).rejects.toThrow(NotFoundException);
      await expect(service.streamMessage(baseDto)).rejects.toThrow('Agent not found or inactive');
    });

    it('should throw BadGatewayException on n8n timeout', async () => {
      const timeoutError = new DOMException('Timeout', 'TimeoutError');
      (global.fetch as jest.Mock).mockRejectedValue(timeoutError);

      await expect(service.streamMessage(baseDto)).rejects.toThrow(BadGatewayException);
      await expect(service.streamMessage(baseDto)).rejects.toThrow(
        'Response is taking too long, please try again',
      );
    });

    it('should throw BadGatewayException on n8n network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.streamMessage(baseDto)).rejects.toThrow(BadGatewayException);
    });

    it('should update session lastMessageAt', async () => {
      await service.streamMessage(baseDto);

      expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
        where: { id: MOCK_SESSION_DB_ID },
        data: { lastMessageAt: expect.any(Date) },
      });
    });

    it('should include metadata with timestamps', async () => {
      const result = await service.streamMessage(baseDto);

      expect(result.metadata.n8nReceivedAt).toBe(mockN8nResponse.n8nReceivedAt);
      expect(result.metadata.agentRepliedAt).toBe(mockN8nResponse.agentRepliedAt);
    });

    it('should not use $transaction (stores messages separately)', async () => {
      await service.streamMessage(baseDto);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should leave orphaned user message when n8n call fails (user msg stored before n8n)', async () => {
      mockPrismaService.chatMessage.create.mockReset();
      mockPrismaService.chatMessage.create.mockResolvedValueOnce({ id: MOCK_USER_MSG_ID });

      (global.fetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.streamMessage(baseDto)).rejects.toThrow(BadGatewayException);

      // User message was stored (before n8n call)
      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledWith({
        data: {
          chatSessionId: MOCK_SESSION_DB_ID,
          role: 'USER',
          content: baseDto.chatInput,
        },
      });

      // Assistant message was NOT stored (n8n failed before we got a reply)
      // Session was NOT updated
      expect(mockPrismaService.chatSession.update).not.toHaveBeenCalled();
    });
  });
});
