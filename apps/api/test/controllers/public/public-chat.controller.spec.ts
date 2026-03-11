import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadGatewayException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicChatController } from '../../../src/controllers/public/public-chat.controller';
import { ChatService } from '../../../src/services/chat.service';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';

describe('PublicChatController', () => {
  let controller: PublicChatController;

  const mockChatService = {
    sendMessage: jest.fn(),
    streamMessage: jest.fn(),
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

    const mockStreamResult = {
      sessionId: 'session-uuid',
      messageId: 'msg-uuid',
      assistantMessageId: 'assistant-msg-uuid',
      chunks: ['Hello! How', 'can I', 'help you?'],
      metadata: {
        backendReceivedAt: '2026-03-01T10:00:00.000Z',
        n8nReceivedAt: '2026-03-01T10:00:00.500Z',
        agentRepliedAt: '2026-03-01T10:00:01.200Z',
        backendRespondedAt: '2026-03-01T10:00:01.300Z',
        responseLatencyMs: 1300,
      },
    };

    function createMockResponse() {
      const written: string[] = [];
      const headers: Record<string, string> = {};
      const listeners: Record<string, (() => void)[]> = {};
      const mock = {
        setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
        write: jest.fn((data: string) => { written.push(data); }),
        end: jest.fn(),
        on: jest.fn((event: string, cb: () => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
      } as unknown as jest.Mocked<Response>;
      return Object.assign(mock, { _written: written, _headers: headers, _listeners: listeners });
    }

    it('should set SSE response headers', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('should write chunk events for each text chunk', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const chunkEvents = res._written.filter(d => d.includes('"type":"chunk"'));
      expect(chunkEvents).toHaveLength(3);

      const parsed = chunkEvents.map(e => JSON.parse(e.replace('data: ', '').trim()));
      expect(parsed).toEqual([
        { type: 'chunk', content: 'Hello! How' },
        { type: 'chunk', content: 'can I' },
        { type: 'chunk', content: 'help you?' },
      ]);
    });

    it('should write done event with sessionId and messageId after all chunks', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const doneEvents = res._written.filter(d => d.includes('"type":"done"'));
      expect(doneEvents).toHaveLength(1);

      const parsed = JSON.parse(doneEvents[0]!.replace('data: ', '').trim());
      expect(parsed).toEqual({
        type: 'done',
        sessionId: 'session-uuid',
        messageId: 'msg-uuid',
      });
    });

    it('should format SSE events with data: prefix and double newline', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      for (const event of res._written) {
        expect(event).toMatch(/^data: .+\n\n$/);
      }
    });

    it('should call res.end() after streaming completes', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('should send error event when chatService.streamMessage throws NotFoundException', async () => {
      mockChatService.streamMessage.mockRejectedValue(
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

    it('should send error event when chatService.streamMessage throws BadGatewayException', async () => {
      mockChatService.streamMessage.mockRejectedValue(
        new BadGatewayException('Response is taking too long, please try again'),
      );
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      const errorEvents = res._written.filter(d => d.includes('"type":"error"'));
      expect(errorEvents).toHaveLength(1);

      const parsed = JSON.parse(errorEvents[0]!.replace('data: ', '').trim());
      expect(parsed.type).toBe('error');
      expect(parsed.message).toBe('Response is taking too long, please try again');
    });

    it('should send generic error event for unexpected errors', async () => {
      mockChatService.streamMessage.mockRejectedValue(new Error('Something broke'));
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

    it('should call chatService.streamMessage with the dto', async () => {
      mockChatService.streamMessage.mockResolvedValue(mockStreamResult);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(mockChatService.streamMessage).toHaveBeenCalledWith(dto);
    });

    it('should still call res.end() even when error occurs', async () => {
      mockChatService.streamMessage.mockRejectedValue(new Error('fail'));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.stream(dto, req, res);

      expect(res.end).toHaveBeenCalled();
    });

    it('should send timeout error event after 30s if streamMessage hangs', async () => {
      jest.useFakeTimers();

      mockChatService.streamMessage.mockReturnValue(new Promise(() => {}));
      const req = createMockRequest();
      const res = createMockResponse();

      void controller.stream(dto, req, res);

      // Let the rate limit promise resolve first
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
      expect(mockChatService.streamMessage).not.toHaveBeenCalled();
    });
  });
});
