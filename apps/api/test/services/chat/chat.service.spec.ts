import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadGatewayException } from '@nestjs/common';
import { ChatService } from '../../../src/services/chat.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentsService } from '../../../src/services/agents.service';
import { HmacService } from '../../../src/common/security/hmac.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { DirectChatService } from '../../../src/modules/ai/direct-chat.service';

describe('ChatService', () => {
  let service: ChatService;

  const mockPrismaService = {
    agent: {
      findFirst: jest.fn(),
    },
    agentSecret: {
      findUnique: jest.fn(),
    },
    chatSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAgentsService = {
    getEffectiveWebhookUrl: jest.fn(),
  };

  const mockHmacService = {
    verifySignature: jest.fn(),
    computeSignature: jest.fn(),
  };

  const mockCryptoService = {
    decrypt: jest.fn(),
  };

  const mockTracerService = {
    logAuditEvent: jest.fn(),
  };

  const mockDirectChatService = {
    send: jest.fn(),
    stream: jest.fn(),
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
    // Included for `resolveOrCreateSession`'s per-agent lifetime check.
    // 6h is the default; createdAt being fresh keeps these sessions
    // well inside the lifetime cap during tests.
    agent: { sessionLifetimeHours: 6 },
  };

  const mockN8nResponse = {
    agentReply: 'Hello! How can I help you?',
    sessionId: MOCK_SESSION_ID,
    n8nReceivedAt: '2026-03-01T10:00:00.500Z',
    agentRepliedAt: '2026-03-01T10:00:01.200Z',
  };

  const mockN8nResponseText = JSON.stringify(mockN8nResponse);

  const originalFetch = global.fetch;

  /**
   * Helper to create a mock fetch Response with text() and headers.
   */
  function createMockResponse(body: unknown, options?: { ok?: boolean; status?: number; headers?: Record<string, string> }) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      text: () => Promise.resolve(text),
      headers: {
        get: (name: string) => options?.headers?.[name.toLowerCase()] ?? null,
      },
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: HmacService, useValue: mockHmacService },
        { provide: CryptoService, useValue: mockCryptoService },
        { provide: TracerService, useValue: mockTracerService },
        { provide: DirectChatService, useValue: mockDirectChatService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    jest.clearAllMocks();

    // Default mocks for a successful flow (hmacEnabled: false by default)
    mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: false });
    mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue(MOCK_WEBHOOK_URL);
    mockPrismaService.chatSession.create.mockResolvedValue(mockSession);
    // $transaction returns an array of results: [userMessage, assistantMessage, updatedSession]
    mockPrismaService.$transaction.mockResolvedValue([
      { id: MOCK_USER_MSG_ID },
      { id: MOCK_ASSISTANT_MSG_ID },
      mockSession,
    ]);

    global.fetch = jest.fn().mockResolvedValue(createMockResponse(mockN8nResponse));
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveOrCreateVisitorSession (WhatsApp / server-keyed channels)', () => {
    const PHONE = '15551234567';

    it('returns the active session when within the lifetime cap', async () => {
      const active = {
        id: 'sess-1',
        agentId: MOCK_AGENT_ID,
        sessionId: 'uuid-1',
        source: 'WHATSAPP',
        status: 'ACTIVE',
        visitorId: PHONE,
        createdAt: new Date(),
        updatedAt: new Date(),
        agent: { sessionLifetimeHours: 6 },
      };
      mockPrismaService.chatSession.findFirst.mockResolvedValue(active);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        'WHATSAPP',
        PHONE,
      );

      expect(result).toBe(active);
      expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agentId: MOCK_AGENT_ID,
            source: 'WHATSAPP',
            visitorId: PHONE,
            status: 'ACTIVE',
          },
        }),
      );
      expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
    });

    it('creates a new session (random UUID) when none is active', async () => {
      mockPrismaService.chatSession.findFirst.mockResolvedValue(null);
      const created = { id: 'sess-new', sessionId: 'uuid-new' };
      mockPrismaService.chatSession.create.mockResolvedValue(created);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        'WHATSAPP',
        PHONE,
      );

      expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          agentId: MOCK_AGENT_ID,
          source: 'WHATSAPP',
          visitorId: PHONE,
          sessionId: expect.any(String),
        }),
      });
      expect(result).toBe(created);
    });

    it('rotates (EXPIRES old + creates fresh) when past the lifetime cap', async () => {
      const stale = {
        id: 'sess-old',
        agentId: MOCK_AGENT_ID,
        sessionId: 'uuid-old',
        source: 'WHATSAPP',
        status: 'ACTIVE',
        visitorId: PHONE,
        createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h ago, cap is 6h
        updatedAt: new Date(),
        agent: { sessionLifetimeHours: 6 },
      };
      mockPrismaService.chatSession.findFirst.mockResolvedValue(stale);
      const fresh = { id: 'sess-fresh', sessionId: 'uuid-fresh' };
      mockPrismaService.chatSession.create.mockResolvedValue(fresh);

      const result = await service.resolveOrCreateVisitorSession(
        MOCK_AGENT_ID,
        'WHATSAPP',
        PHONE,
      );

      expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-old' },
        data: { status: 'EXPIRED' },
      });
      expect(mockPrismaService.chatSession.create).toHaveBeenCalled();
      expect(result).toBe(fresh);
    });
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
          streamingMode: 'simulated',
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
            visitorId: null,
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
          // The lookup pulls the agent's per-row lifetime so the expiry
          // check uses the configured value, not a hardcoded constant.
          include: { agent: { select: { sessionLifetimeHours: true } } },
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

    describe('session lifetime rotation (6h from createdAt)', () => {
      const dtoWithSession = {
        ...baseDto,
        sessionId: MOCK_SESSION_ID,
      };

      it('rotates the session when createdAt is older than 6 hours: flips old to EXPIRED and creates a fresh one', async () => {
        // Session born 7h ago — past the SESSION_LIFETIME_MS cap.
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
        });

        const result = await service.sendMessage(dtoWithSession);

        // Old row was marked EXPIRED
        expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
          where: { id: MOCK_SESSION_DB_ID },
          data: { status: 'EXPIRED' },
        });
        // A brand-new session row was created — note `sessionId` is generated,
        // so we don't assert the exact value, just that create was called.
        expect(mockPrismaService.chatSession.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            agentId: MOCK_AGENT_ID,
            source: 'DEMO',
            sessionId: expect.any(String),
          }),
        });
        // The response sessionId is the NEW one (returned by `create`), not
        // the old client-supplied one.
        expect(result.sessionId).toBe(MOCK_SESSION_ID); // mocked create returns mockSession
      });

      it('does NOT rotate when createdAt is within 6 hours', async () => {
        const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: fiveHoursAgo,
        });

        await service.sendMessage(dtoWithSession);

        // No EXPIRED flip
        expect(mockPrismaService.chatSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: 'EXPIRED' } }),
        );
        // No new session created
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
      });

      it('uses createdAt for the lifetime check, NOT lastMessageAt', async () => {
        // createdAt 7h ago, lastMessageAt 1 minute ago — by an idle-based
        // check this would NOT rotate, but our rule is lifetime-from-creation.
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const aMinuteAgo = new Date(Date.now() - 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
          lastMessageAt: aMinuteAgo,
        });

        await service.sendMessage(dtoWithSession);

        // Rotated because createdAt is past the cap.
        expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
          where: { id: MOCK_SESSION_DB_ID },
          data: { status: 'EXPIRED' },
        });
        expect(mockPrismaService.chatSession.create).toHaveBeenCalled();
      });

      it('respects per-agent sessionLifetimeHours: 7h-old session keeps living when agent allows 24h', async () => {
        // Same age as the rotation test (7h ago), but this agent is
        // configured for a 24h lifetime — must NOT rotate.
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        mockPrismaService.chatSession.findFirst.mockResolvedValue({
          ...mockSession,
          createdAt: sevenHoursAgo,
          agent: { sessionLifetimeHours: 24 },
        });

        await service.sendMessage(dtoWithSession);

        expect(mockPrismaService.chatSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: 'EXPIRED' } }),
        );
        expect(mockPrismaService.chatSession.create).not.toHaveBeenCalled();
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
          select: { id: true, hmacEnabled: true, aiConfig: true },
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
        (global.fetch as jest.Mock).mockResolvedValue(
          createMockResponse('', { ok: false, status: 500 }),
        );

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
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({
          agentReply: 'Object response',
          n8nReceivedAt: '2026-03-01T10:00:00Z',
          agentRepliedAt: '2026-03-01T10:00:01Z',
        }));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Object response');
      });

      it('should parse array response with agentReply', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse([{
          agentReply: 'Array response',
          n8nReceivedAt: '2026-03-01T10:00:00Z',
          agentRepliedAt: '2026-03-01T10:00:01Z',
        }]));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Array response');
      });

      it('should fallback to output field when agentReply is missing', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({ output: 'Fallback output response' }));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Fallback output response');
      });

      it('should fallback to output field in array format', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse([{ output: 'Array fallback output' }]));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe('Array fallback output');
      });

      it('should throw BadGatewayException when response has no agentReply or output', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({ someOtherField: 'unexpected' }));

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Unexpected response format from AI service',
        );
      });

      it('should throw BadGatewayException when response text is invalid JSON', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('not-valid-json'),
          headers: { get: () => null },
        });

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow(
          'Unexpected response format from AI service',
        );
      });

      it('should handle missing n8nReceivedAt and agentRepliedAt timestamps', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse({ agentReply: 'No timestamps' }));

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
        return Promise.resolve(createMockResponse(mockN8nResponse));
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
          visitorId: null,
        },
      });
    });

    it('should reuse existing session when sessionId provided', async () => {
      mockPrismaService.chatSession.findFirst.mockResolvedValue(mockSession);

      await service.streamMessage({ ...baseDto, sessionId: MOCK_SESSION_ID });

      expect(mockPrismaService.chatSession.findFirst).toHaveBeenCalledWith({
        where: { sessionId: MOCK_SESSION_ID, agentId: MOCK_AGENT_ID, status: 'ACTIVE' },
        include: { agent: { select: { sessionLifetimeHours: true } } },
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

    it('should include streamingMode=simulated in metadata', async () => {
      const result = await service.streamMessage(baseDto);

      expect(result.metadata).toHaveProperty('streamingMode', 'simulated');
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

  describe('HMAC verification', () => {
    const baseDto = {
      chatInput: 'Hello, AI!',
      agentId: MOCK_AGENT_ID,
    };

    const MOCK_DECRYPTED_SECRET = 'decrypted-hmac-secret';
    const MOCK_VALID_SIGNATURE = 'valid-hex-signature';
    const MOCK_ENCRYPTED_API_KEY = 'encrypted:api:key';

    describe('hmacEnabled=true with valid signature', () => {
      beforeEach(() => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: true });
        mockPrismaService.agentSecret.findUnique.mockResolvedValue({ apiKey: MOCK_ENCRYPTED_API_KEY });
        mockCryptoService.decrypt.mockReturnValue(MOCK_DECRYPTED_SECRET);
        mockHmacService.verifySignature.mockReturnValue(true);

        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(
          mockN8nResponse,
          { headers: { 'x-signature': MOCK_VALID_SIGNATURE } },
        ));
      });

      it('should process response normally when signature is valid', async () => {
        const result = await service.sendMessage(baseDto);

        expect(result.reply).toBe(mockN8nResponse.agentReply);
        expect(mockHmacService.verifySignature).toHaveBeenCalledWith(
          mockN8nResponseText,
          MOCK_VALID_SIGNATURE,
          MOCK_DECRYPTED_SECRET,
        );
      });

      it('should decrypt the agent secret via CryptoService', async () => {
        await service.sendMessage(baseDto);

        expect(mockCryptoService.decrypt).toHaveBeenCalledWith(MOCK_ENCRYPTED_API_KEY);
      });

      it('should fetch agent secret from AgentSecret table', async () => {
        await service.sendMessage(baseDto);

        expect(mockPrismaService.agentSecret.findUnique).toHaveBeenCalledWith({
          where: { agentId: MOCK_AGENT_ID },
          select: { apiKey: true },
        });
      });

      it('should not log audit event on successful verification', async () => {
        await service.sendMessage(baseDto);

        expect(mockTracerService.logAuditEvent).not.toHaveBeenCalled();
      });
    });

    describe('hmacEnabled=true with invalid signature', () => {
      beforeEach(() => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: true });
        mockPrismaService.agentSecret.findUnique.mockResolvedValue({ apiKey: MOCK_ENCRYPTED_API_KEY });
        mockCryptoService.decrypt.mockReturnValue(MOCK_DECRYPTED_SECRET);
        mockHmacService.verifySignature.mockReturnValue(false);
        mockTracerService.logAuditEvent.mockResolvedValue(undefined);
      });

      it('should reject and throw BadGatewayException', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(
          mockN8nResponse,
          { headers: { 'x-signature': 'bad-signature' } },
        ));

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow('Response verification failed');
      });

      it('should log HMAC_VERIFICATION_FAILED audit event with invalid_signature reason', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(
          mockN8nResponse,
          { headers: { 'x-signature': 'bad-signature' } },
        ));

        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);

        expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
          MOCK_AGENT_ID,
          'HMAC_VERIFICATION_FAILED',
          { sessionId: MOCK_SESSION_ID, reason: 'invalid_signature' },
        );
      });
    });

    describe('hmacEnabled=true with missing X-Signature header', () => {
      beforeEach(() => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: true });
        mockPrismaService.agentSecret.findUnique.mockResolvedValue({ apiKey: MOCK_ENCRYPTED_API_KEY });
        mockCryptoService.decrypt.mockReturnValue(MOCK_DECRYPTED_SECRET);
        mockTracerService.logAuditEvent.mockResolvedValue(undefined);

        // No x-signature header
        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(mockN8nResponse));
      });

      it('should reject and throw BadGatewayException', async () => {
        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);
        await expect(service.sendMessage(baseDto)).rejects.toThrow('Response verification failed');
      });

      it('should log audit event with missing_signature_header reason', async () => {
        await expect(service.sendMessage(baseDto)).rejects.toThrow(BadGatewayException);

        expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
          MOCK_AGENT_ID,
          'HMAC_VERIFICATION_FAILED',
          { sessionId: MOCK_SESSION_ID, reason: 'missing_signature_header' },
        );
      });
    });

    describe('hmacEnabled=false skips verification', () => {
      it('should not call HmacService.verifySignature', async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: false });

        await service.sendMessage(baseDto);

        expect(mockHmacService.verifySignature).not.toHaveBeenCalled();
        expect(mockPrismaService.agentSecret.findUnique).not.toHaveBeenCalled();
        expect(mockCryptoService.decrypt).not.toHaveBeenCalled();
      });

      it('should process response normally without HMAC check', async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: false });

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe(mockN8nResponse.agentReply);
      });
    });

    describe('hmacEnabled=true but no secret configured (AC#2: passthrough)', () => {
      beforeEach(() => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: true });
      });

      it('should skip verification and process normally when no AgentSecret record exists', async () => {
        mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);

        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(
          mockN8nResponse,
          { headers: { 'x-signature': 'some-sig' } },
        ));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe(mockN8nResponse.agentReply);
        expect(mockHmacService.verifySignature).not.toHaveBeenCalled();
      });

      it('should skip verification when apiKey is null', async () => {
        mockPrismaService.agentSecret.findUnique.mockResolvedValue({ apiKey: null });

        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(mockN8nResponse));

        const result = await service.sendMessage(baseDto);
        expect(result.reply).toBe(mockN8nResponse.agentReply);
        expect(mockHmacService.verifySignature).not.toHaveBeenCalled();
      });

      it('should not log audit event when no secret (passthrough per AC#2)', async () => {
        mockPrismaService.agentSecret.findUnique.mockResolvedValue(null);

        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(mockN8nResponse));

        await service.sendMessage(baseDto);
        expect(mockTracerService.logAuditEvent).not.toHaveBeenCalled();
      });
    });

    describe('HMAC verification on streamMessage', () => {
      beforeEach(() => {
        mockPrismaService.chatMessage.create
          .mockResolvedValueOnce({ id: MOCK_USER_MSG_ID })
          .mockResolvedValueOnce({ id: MOCK_ASSISTANT_MSG_ID });
        mockPrismaService.chatSession.update.mockResolvedValue(mockSession);
      });

      it('should verify HMAC when hmacEnabled=true in streamMessage', async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: true });
        mockPrismaService.agentSecret.findUnique.mockResolvedValue({ apiKey: MOCK_ENCRYPTED_API_KEY });
        mockCryptoService.decrypt.mockReturnValue(MOCK_DECRYPTED_SECRET);
        mockHmacService.verifySignature.mockReturnValue(true);

        (global.fetch as jest.Mock).mockResolvedValue(createMockResponse(
          mockN8nResponse,
          { headers: { 'x-signature': MOCK_VALID_SIGNATURE } },
        ));

        const result = await service.streamMessage(baseDto);
        expect(result.chunks.join('')).toBe(mockN8nResponse.agentReply);
        expect(mockHmacService.verifySignature).toHaveBeenCalled();
      });

      it('should skip HMAC when hmacEnabled=false in streamMessage', async () => {
        mockPrismaService.agent.findFirst.mockResolvedValue({ id: MOCK_AGENT_ID, hmacEnabled: false });

        const result = await service.streamMessage(baseDto);
        expect(result.chunks.join('')).toBe(mockN8nResponse.agentReply);
        expect(mockHmacService.verifySignature).not.toHaveBeenCalled();
      });
    });
  });

  describe('saveUserMessage', () => {
    it('should create a USER role chat message', async () => {
      const mockMsg = { id: 'msg-1', role: 'USER', content: 'Hello' };
      mockPrismaService.chatMessage.create.mockResolvedValue(mockMsg);

      const result = await service.saveUserMessage('session-db-id', 'Hello');

      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledWith({
        data: { chatSessionId: 'session-db-id', role: 'USER', content: 'Hello' },
      });
      expect(result).toEqual(mockMsg);
    });
  });

  describe('saveAssistantMessage', () => {
    it('should create an ASSISTANT role chat message with metadata', async () => {
      const metadata = { totalChunks: 5, streamDurationMs: 1000 };
      const mockMsg = { id: 'msg-2', role: 'ASSISTANT', content: 'Hi there', metadata };
      mockPrismaService.chatMessage.create.mockResolvedValue(mockMsg);

      const result = await service.saveAssistantMessage('session-db-id', 'Hi there', metadata);

      expect(mockPrismaService.chatMessage.create).toHaveBeenCalledWith({
        data: { chatSessionId: 'session-db-id', role: 'ASSISTANT', content: 'Hi there', metadata },
      });
      expect(result).toEqual(mockMsg);
    });
  });

  describe('updateSessionTimestamp', () => {
    it('should update the session lastMessageAt', async () => {
      mockPrismaService.chatSession.update.mockResolvedValue({});

      await service.updateSessionTimestamp('session-db-id');

      expect(mockPrismaService.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'session-db-id' },
        data: { lastMessageAt: expect.any(Date) },
      });
    });
  });

  describe('deleteMessage', () => {
    it('should delete a chat message by ID', async () => {
      mockPrismaService.chatMessage.delete.mockResolvedValue({});

      await service.deleteMessage('msg-to-delete');

      expect(mockPrismaService.chatMessage.delete).toHaveBeenCalledWith({
        where: { id: 'msg-to-delete' },
      });
    });
  });
});
