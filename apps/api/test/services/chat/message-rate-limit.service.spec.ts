import { Test, TestingModule } from '@nestjs/testing';
import { MessageRateLimitService } from '../../../src/services/message-rate-limit.service';
import { RateLimiterService } from '../../../src/common/redis/rate-limiter.service';
import type { Request } from 'express';

describe('MessageRateLimitService', () => {
  let service: MessageRateLimitService;

  const mockRateLimiterService = {
    checkRateLimit: jest.fn(),
  };

  const deviceId = 'device-abc-123';
  const agentPublicId = 'agent-xyz-456';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageRateLimitService,
        { provide: RateLimiterService, useValue: mockRateLimiterService },
      ],
    }).compile();

    service = module.get<MessageRateLimitService>(MessageRateLimitService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkMessageRateLimit', () => {
    it('should allow messages within both limits', async () => {
      mockRateLimiterService.checkRateLimit
        .mockResolvedValueOnce({ allowed: true, remaining: 50, retryAfterMs: 0, resetMs: 3600000 })
        .mockResolvedValueOnce({ allowed: true, remaining: 5, retryAfterMs: 0, resetMs: 60000 });

      const result = await service.checkMessageRateLimit(deviceId, agentPublicId);

      expect(result).toEqual({ allowed: true });
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledTimes(2);
      // Hour checked first to protect minute counter from phantom ZADD
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenNthCalledWith(
        1,
        `msg_rate:${deviceId}:${agentPublicId}:hour`,
        100,
        3600000,
      );
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenNthCalledWith(
        2,
        `msg_rate:${deviceId}:${agentPublicId}:minute`,
        10,
        60000,
      );
    });

    it('should reject with per-hour message when hour limit exceeded (minute not touched)', async () => {
      mockRateLimiterService.checkRateLimit
        .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 1800000, resetMs: 3600000 });

      const result = await service.checkMessageRateLimit(deviceId, agentPublicId);

      expect(result.allowed).toBe(false);
      expect(result.message).toBe("You've sent too many messages. Please try again later.");
      expect(result.retryAfterSeconds).toBe(1800);
      // Should NOT check minute limit when hour limit fails — protects minute counter
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledTimes(1);
    });

    it('should reject with per-minute message when minute limit exceeded', async () => {
      mockRateLimiterService.checkRateLimit
        .mockResolvedValueOnce({ allowed: true, remaining: 50, retryAfterMs: 0, resetMs: 3600000 })
        .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 45000, resetMs: 60000 });

      const result = await service.checkMessageRateLimit(deviceId, agentPublicId);

      expect(result.allowed).toBe(false);
      expect(result.message).toBe("You're sending messages too quickly. Please wait a moment.");
      expect(result.retryAfterSeconds).toBe(45);
    });

    it('should use compound key with deviceId and agentPublicId', async () => {
      mockRateLimiterService.checkRateLimit
        .mockResolvedValue({ allowed: true, remaining: 5, retryAfterMs: 0, resetMs: 60000 });

      await service.checkMessageRateLimit('device-A', 'agent-1');
      await service.checkMessageRateLimit('device-B', 'agent-1');
      await service.checkMessageRateLimit('device-A', 'agent-2');

      // Verify compound keys for both hour and minute windows
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'msg_rate:device-A:agent-1:hour', 100, 3600000,
      );
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'msg_rate:device-A:agent-1:minute', 10, 60000,
      );
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'msg_rate:device-B:agent-1:hour', 100, 3600000,
      );
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'msg_rate:device-A:agent-2:hour', 100, 3600000,
      );
    });
  });

  describe('getDeviceIdentifier', () => {
    function createMockRequest(overrides: Partial<Request> = {}): Request {
      return {
        headers: {},
        ip: undefined,
        ...overrides,
      } as unknown as Request;
    }

    it('should return X-Device-ID header when present', () => {
      const req = createMockRequest({
        headers: { 'x-device-id': 'device-from-header' },
      });

      expect(service.getDeviceIdentifier(req)).toBe('device-from-header');
    });

    it('should return first value when X-Device-ID is an array', () => {
      const req = createMockRequest({
        headers: { 'x-device-id': ['device-1', 'device-2'] as unknown as string },
      });

      expect(service.getDeviceIdentifier(req)).toBe('device-1');
    });

    it('should fall back to request.ip when X-Device-ID is absent', () => {
      const req = createMockRequest({
        headers: {},
        ip: '192.168.1.100',
      });

      expect(service.getDeviceIdentifier(req)).toBe('192.168.1.100');
    });

    it('should fall back to x-forwarded-for when no X-Device-ID and no ip', () => {
      const req = createMockRequest({
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
        ip: undefined,
      });

      expect(service.getDeviceIdentifier(req)).toBe('10.0.0.1');
    });

    it('should fall back to x-forwarded-for when request.ip is empty string', () => {
      const req = createMockRequest({
        headers: { 'x-forwarded-for': '10.0.0.5' },
        ip: '' as unknown as undefined,
      });

      expect(service.getDeviceIdentifier(req)).toBe('10.0.0.5');
    });

    it('should return unknown when no identifiers available', () => {
      const req = createMockRequest({
        headers: {},
        ip: undefined,
      });

      expect(service.getDeviceIdentifier(req)).toBe('unknown');
    });
  });
});
