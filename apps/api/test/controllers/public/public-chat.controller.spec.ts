import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicChatController } from '../../../src/controllers/public/public-chat.controller';
import { ChatService } from '../../../src/services/chat.service';
import { AgentsService } from '../../../src/services/agents.service';
import { N8nStreamingService } from '../../../src/services/n8n-streaming.service';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';

describe('PublicChatController', () => {
  let controller: PublicChatController;

  const mockChatService = {
    sendMessage: jest.fn(),
    resolveAgent: jest.fn(),
    resolveOrCreateSession: jest.fn(),
    saveUserMessage: jest.fn(),
    saveAssistantMessage: jest.fn(),
    updateSessionTimestamp: jest.fn(),
    deleteMessage: jest.fn(),
  };

  const mockAgentsService = {
    getEffectiveWebhookUrl: jest.fn(),
  };

  const mockN8nStreamingService = {
    streamFromWebhookUrl: jest.fn(),
  };

  const mockMessageRateLimitService = {
    checkMessageRateLimit: jest.fn(),
    getDeviceIdentifier: jest.fn(),
  };

  function createMockRequest(): Request {
    return {
      headers: { 'x-device-id': 'test-device' },
      ip: '127.0.0.1',
    } as unknown as Request;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicChatController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: N8nStreamingService, useValue: mockN8nStreamingService },
        { provide: MessageRateLimitService, useValue: mockMessageRateLimitService },
      ],
    }).compile();

    controller = module.get<PublicChatController>(PublicChatController);
    jest.clearAllMocks();
    mockMessageRateLimitService.getDeviceIdentifier.mockReturnValue('test-device');
    mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({ allowed: true });
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
      const req = createMockRequest();

      const result = await controller.sendMessage(dto, req);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResponse);
    });

    it('should pass through the dto with sessionId', async () => {
      const dtoWithSession = { ...dto, sessionId: 'existing-session' };
      mockChatService.sendMessage.mockResolvedValue(mockResponse);
      const req = createMockRequest();

      await controller.sendMessage(dtoWithSession, req);

      expect(mockChatService.sendMessage).toHaveBeenCalledWith(dtoWithSession);
    });

    it('should return friendly error JSON (not 429) when rate limited', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      const req = createMockRequest();

      const result = await controller.sendMessage(dto, req);

      expect(result).toEqual({
        error: true,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('should extract deviceId and agentId for rate limit check', async () => {
      mockChatService.sendMessage.mockResolvedValue(mockResponse);
      const req = createMockRequest();

      await controller.sendMessage(dto, req);

      expect(mockMessageRateLimitService.getDeviceIdentifier).toHaveBeenCalledWith(req);
      expect(mockMessageRateLimitService.checkMessageRateLimit).toHaveBeenCalledWith(
        'test-device',
        dto.agentId,
      );
    });
  });

  describe('stream', () => {
    const dto = {
      chatInput: 'Hello!',
      agentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    };

    const mockAgent = { id: 'agent-db-id', hmacEnabled: false };
    const mockSession = { id: 'session-db-id', sessionId: 'session-uuid' };

    function createMockResponse() {
      const written: string[] = [];
      const headers: Record<string, string> = {};
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mock = {
        setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
        write: jest.fn((data: string) => { written.push(data); }),
        end: jest.fn(),
        on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
      } as unknown as jest.Mocked<Response>;
      return Object.assign(mock, { _written: written, _headers: headers, _listeners: listeners });
    }

    async function* createMockGenerator(chunks: Array<{ type: string; content?: string; metadata?: { timestamp: number } }>) {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    function setupStreamingMocks(options?: {
      chunks?: Array<{ type: string; content?: string; metadata?: { timestamp: number } }>;
      hmacEnabled?: boolean;
    }) {
      const agent = options?.hmacEnabled ? { ...mockAgent, hmacEnabled: true } : mockAgent;
      mockChatService.resolveAgent.mockResolvedValue(agent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/chat');
      mockChatService.saveUserMessage.mockResolvedValue({ id: 'user-msg-id' });
      mockChatService.saveAssistantMessage.mockResolvedValue({ id: 'assistant-msg-id' });
      mockChatService.updateSessionTimestamp.mockResolvedValue({});
      mockChatService.deleteMessage.mockResolvedValue({});

      const chunks = options?.chunks ?? [
        { type: 'begin', metadata: { timestamp: 1711000000000 } },
        { type: 'item', content: 'Hello' },
        { type: 'item', content: ' world' },
        { type: 'item', content: '!' },
        { type: 'end', metadata: { timestamp: 1711000002000 } },
      ];
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue(createMockGenerator(chunks));
    }

    it('should set SSE response headers', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('should stream real token chunks as SSE events', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const chunkEvents = res._written.filter(d => d.includes('"type":"chunk"'));
      expect(chunkEvents).toHaveLength(3);

      const parsed = chunkEvents.map(e => JSON.parse(e.replace('data: ', '').trim()));
      expect(parsed).toEqual([
        { type: 'chunk', content: 'Hello' },
        { type: 'chunk', content: ' world' },
        { type: 'chunk', content: '!' },
      ]);
    });

    it('should send done event with assistant messageId and metadata (P1)', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const doneEvents = res._written.filter(d => d.includes('"type":"done"'));
      expect(doneEvents).toHaveLength(1);

      const parsed = JSON.parse(doneEvents[0]!.replace('data: ', '').trim());
      expect(parsed.type).toBe('done');
      expect(parsed.sessionId).toBe('session-uuid');
      // P1: messageId is the ASSISTANT message ID, not user message ID
      expect(parsed.messageId).toBe('assistant-msg-id');
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.totalChunks).toBe(3);
      expect(parsed.metadata.n8nReceivedAt).toBeDefined();
      expect(parsed.metadata.agentRepliedAt).toBeDefined();
      expect(parsed.metadata.timeToFirstToken).toEqual(expect.any(Number));
      expect(parsed.metadata.streamDurationMs).toBe(2000);
    });

    it('should send done event even when stream has no item chunks (P2)', async () => {
      setupStreamingMocks({
        chunks: [
          { type: 'begin', metadata: { timestamp: 1711000000000 } },
          { type: 'end', metadata: { timestamp: 1711000001000 } },
        ],
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      // Should still send done event with empty response
      const doneEvents = res._written.filter(d => d.includes('"type":"done"'));
      expect(doneEvents).toHaveLength(1);

      const parsed = JSON.parse(doneEvents[0]!.replace('data: ', '').trim());
      expect(parsed.metadata.totalChunks).toBe(0);
      expect(parsed.metadata.timeToFirstToken).toBeNull();

      // Should still save assistant message (empty)
      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        mockSession.id,
        '',
        expect.objectContaining({ totalChunks: 0 }),
      );
    });

    it('should format SSE events with data: prefix and double newline', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      for (const event of res._written) {
        expect(event).toMatch(/^data: .+\n\n$/);
      }
    });

    it('should call res.end() after streaming completes', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('should resolve agent, session, and webhookUrl before streaming', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.resolveAgent).toHaveBeenCalledWith(dto.agentId);
      expect(mockChatService.resolveOrCreateSession).toHaveBeenCalledWith(mockAgent.id, undefined);
      expect(mockAgentsService.getEffectiveWebhookUrl).toHaveBeenCalledWith(mockAgent.id);
    });

    it('should pass abortSignal to streamFromWebhookUrl', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockN8nStreamingService.streamFromWebhookUrl).toHaveBeenCalledWith(
        'https://n8n.example.com/webhook/chat',
        dto.chatInput,
        mockSession.sessionId,
        expect.any(AbortSignal),
      );
    });

    it('should use ChatService for DB operations (P3) — save user before, assistant after', async () => {
      setupStreamingMocks();
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      // User message saved before streaming
      expect(mockChatService.saveUserMessage).toHaveBeenCalledWith(mockSession.id, dto.chatInput);

      // Assistant message saved after streaming with full response and metadata
      expect(mockChatService.saveAssistantMessage).toHaveBeenCalledWith(
        mockSession.id,
        'Hello world!',
        expect.objectContaining({
          totalChunks: 3,
          streamDurationMs: 2000,
        }),
      );

      // Session timestamp updated
      expect(mockChatService.updateSessionTimestamp).toHaveBeenCalledWith(mockSession.id);
    });

    it('should clean up orphaned user message on stream failure (D1)', async () => {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/chat');
      mockChatService.saveUserMessage.mockResolvedValue({ id: 'orphan-msg-id' });
      mockChatService.deleteMessage.mockResolvedValue({});

      async function* errorGenerator() {
        yield { type: 'begin' as const, metadata: { timestamp: 1711000000000 } };
        throw new Error('Stream broke');
      }
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue(errorGenerator());

      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.deleteMessage).toHaveBeenCalledWith('orphan-msg-id');
    });

    it('should not fail if orphan cleanup itself fails (D1 graceful)', async () => {
      mockChatService.resolveAgent.mockRejectedValue(new Error('DB down'));
      // No user message saved, so deleteMessage should not be called
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.deleteMessage).not.toHaveBeenCalled();
      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);
    });

    it('should send error event when resolveAgent throws NotFoundException', async () => {
      mockChatService.resolveAgent.mockRejectedValue(
        new NotFoundException('Agent not found or inactive'),
      );
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({
        type: 'error',
        message: 'Agent not found or inactive',
      });
      expect(res.end).toHaveBeenCalled();
    });

    it('should send generic error event for unexpected errors', async () => {
      mockChatService.resolveAgent.mockRejectedValue(new Error('Something broke'));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({
        type: 'error',
        message: 'An unexpected error occurred',
      });
    });

    it('should map service timeout error to friendly message (IG2)', async () => {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/chat');
      mockChatService.saveUserMessage.mockResolvedValue({ id: 'user-msg-id' });
      mockChatService.deleteMessage.mockResolvedValue({});

      async function* timeoutGenerator() {
        yield { type: 'begin' as const, metadata: { timestamp: 1711000000000 } };
        throw new Error('Streaming request timed out');
      }
      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue(timeoutGenerator());

      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed.message).toBe('Stream timeout - response took too long');
    });

    it('should still call res.end() even when error occurs', async () => {
      mockChatService.resolveAgent.mockRejectedValue(new Error('fail'));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalled();
    });

    it('should stop streaming on client disconnect', async () => {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/chat');
      mockChatService.saveUserMessage.mockResolvedValue({ id: 'user-msg-id' });

      let yieldCount = 0;
      const mockGenerator = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          yieldCount++;
          if (yieldCount === 1) return { value: { type: 'begin', metadata: { timestamp: 1711000000000 } }, done: false };
          if (yieldCount === 2) return { value: { type: 'item', content: 'Hello' }, done: false };
          return { value: undefined, done: true };
        },
        async return() { return { value: undefined, done: true }; },
      };

      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue(mockGenerator);

      const req = createMockRequest();
      const res = createMockResponse();

      const originalWrite = res.write as jest.Mock;
      originalWrite.mockImplementation((data: string) => {
        res._written.push(data);
        if (data.includes('"type":"chunk"')) {
          const closeListeners = res._listeners['close'] || [];
          closeListeners.forEach(cb => cb());
        }
      });

      await controller.stream(dto, req, res);

      const chunkEvents = res._written.filter(d => d.includes('"type":"chunk"'));
      expect(chunkEvents).toHaveLength(1);

      const doneEvents = res._written.filter(d => d.includes('"type":"done"'));
      expect(doneEvents).toHaveLength(0);
    });

    it('should send timeout error event after 30s', async () => {
      jest.useFakeTimers();

      mockChatService.resolveAgent.mockReturnValue(new Promise(() => {}));
      const req = createMockRequest();
      const res = createMockResponse();

      void controller.stream(dto, req, res);

      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(30_000);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({
        type: 'error',
        message: 'Stream timeout - response took too long',
      });
      expect(res.end).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should send SSE error event when rate limited (not HTTP 429)', async () => {
      mockMessageRateLimitService.checkMessageRateLimit.mockResolvedValue({
        allowed: false,
        message: "You're sending messages too quickly. Please wait a moment.",
        retryAfterSeconds: 45,
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({
        type: 'error',
        message: "You're sending messages too quickly. Please wait a moment.",
      });
      expect(res.end).toHaveBeenCalled();
      expect(mockChatService.resolveAgent).not.toHaveBeenCalled();
    });

    it('should handle streaming error from n8nStreamingService', async () => {
      mockChatService.resolveAgent.mockResolvedValue(mockAgent);
      mockChatService.resolveOrCreateSession.mockResolvedValue(mockSession);
      mockAgentsService.getEffectiveWebhookUrl.mockResolvedValue('https://n8n.example.com/webhook/chat');
      mockChatService.saveUserMessage.mockResolvedValue({ id: 'user-msg-id' });
      mockChatService.deleteMessage.mockResolvedValue({});

      async function* errorGenerator() {
        yield { type: 'begin' as const, metadata: { timestamp: 1711000000000 } };
        yield { type: 'item' as const, content: 'Hello' };
        throw new Error('Connection reset');
      }

      mockN8nStreamingService.streamFromWebhookUrl.mockReturnValue(errorGenerator());

      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const chunkEvents = res._written.filter(d => d.includes('"type":"chunk"'));
      expect(chunkEvents).toHaveLength(1);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({ type: 'error', message: 'An unexpected error occurred' });
      expect(res.end).toHaveBeenCalled();
    });

    it('should include metadata with n8nReceivedAt and agentRepliedAt from begin/end chunks', async () => {
      setupStreamingMocks({
        chunks: [
          { type: 'begin', metadata: { timestamp: 1711000000000 } },
          { type: 'item', content: 'Test' },
          { type: 'end', metadata: { timestamp: 1711000003000 } },
        ],
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const doneEvents = res._written.filter(d => d.includes('"type":"done"'));
      const parsed = JSON.parse(doneEvents[0]!.replace('data: ', '').trim());

      expect(parsed.metadata.n8nReceivedAt).toBe(new Date(1711000000000).toISOString());
      expect(parsed.metadata.agentRepliedAt).toBe(new Date(1711000003000).toISOString());
      expect(parsed.metadata.streamDurationMs).toBe(3000);
      expect(parsed.metadata.totalChunks).toBe(1);
    });
  });
});
