import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../../src/guards/rate-limit.guard';
import { RateLimiterService } from '../../src/common/redis/rate-limiter.service';
import {
  SKIP_RATE_LIMIT_KEY,
  RATE_LIMIT_KEY,
} from '../../src/decorators/rate-limit.decorator';
import { IS_PUBLIC_KEY } from '../../src/decorators/public.decorator';
import type { RateLimitConfig } from '../../src/common/redis/rate-limiter.types';

/** Configs a route would declare via @RateLimit(...). */
const AUTH_CFG: RateLimitConfig = { limit: 100, windowMs: 60000 };
const PUBLIC_CFG: RateLimitConfig = { limit: 30, windowMs: 60000 };

describe('RateLimitGuard (opt-in)', () => {
  let guard: RateLimitGuard;

  const mockRateLimiterService = {
    checkRateLimit: jest.fn(),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockSetHeader = jest.fn();

  /** Wire the reflector for a given (skip / @RateLimit config / @Public) combo. */
  function setMeta(opts: {
    skip?: boolean;
    config?: RateLimitConfig;
    isPublic?: boolean;
  }) {
    const { skip = false, config = undefined, isPublic = false } = opts;
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === SKIP_RATE_LIMIT_KEY) return skip;
      if (key === RATE_LIMIT_KEY) return config;
      if (key === IS_PUBLIC_KEY) return isPublic;
      return undefined;
    });
  }

  function createMockContext(
    options: {
      user?: { id?: string } | null;
      ip?: string;
      method?: string;
      routePath?: string;
      actualPath?: string;
      noRoute?: boolean;
      headers?: Record<string, string | string[]>;
    } = {},
  ): ExecutionContext {
    const {
      user = { id: 'user-123' },
      ip = '127.0.0.1',
      method = 'GET',
      routePath = '/api/agents',
      actualPath,
      noRoute = false,
      headers = {},
    } = options;

    const mockRequest = {
      user,
      ip,
      method,
      route: noRoute ? undefined : { path: routePath },
      path: actualPath ?? routePath,
      headers,
    };

    const mockResponse = {
      setHeader: mockSetHeader,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as unknown,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({} as never),
      switchToWs: () => ({} as never),
      getType: () => 'http' as const,
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: RateLimiterService, useValue: mockRateLimiterService },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('opt-in behaviour', () => {
    it('returns true WITHOUT touching Redis when no @RateLimit() is declared', async () => {
      setMeta({ config: undefined });

      const context = createMockContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRateLimiterService.checkRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('authenticated request keying', () => {
    it('uses rate_limit:user:{userId}:{endpoint} when @RateLimit() is set', async () => {
      setMeta({ config: AUTH_CFG, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({ user: { id: 'user-456' } });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'user:user-456:GET:/api/agents',
        100,
        60000,
      );
    });
  });

  describe('public/unauthenticated request keying', () => {
    it('uses rate_limit:ip:{ip}:{endpoint} for @Public() routes', async () => {
      setMeta({ config: PUBLIC_CFG, isPublic: true });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 29,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({ ip: '192.168.1.1' });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'ip:192.168.1.1:GET:/api/agents',
        30,
        60000,
      );
    });
  });

  describe('request within limit', () => {
    it('returns true and sets response headers when allowed', async () => {
      setMeta({ config: AUTH_CFG, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 95,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 95);
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 60);
    });
  });

  describe('request exceeds limit', () => {
    it('throws 429 and sets Retry-After when over the limit', async () => {
      setMeta({ config: AUTH_CFG, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfterMs: 30000,
        resetMs: 60000,
      });

      const context = createMockContext();
      let thrownError: HttpException | undefined;

      try {
        await guard.canActivate(context);
      } catch (error) {
        thrownError = error as HttpException;
      }

      expect(thrownError).toBeInstanceOf(HttpException);
      expect(thrownError!.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = thrownError!.getResponse() as Record<string, unknown>;
      expect(response.statusCode).toBe(429);
      expect(response.message).toBe('Too Many Requests');
      expect(response.retryAfter).toBe(30);
      expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', 30);
      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledTimes(1);
    });
  });

  describe('@SkipRateLimit() bypass', () => {
    it('returns true without calling RateLimiterService even when @RateLimit() is set', async () => {
      setMeta({ skip: true, config: AUTH_CFG });

      const context = createMockContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRateLimiterService.checkRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('@RateLimit() custom config', () => {
    it('uses the declared limit/window', async () => {
      setMeta({ config: { limit: 5, windowMs: 10000 }, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        retryAfterMs: 0,
        resetMs: 10000,
      });

      const context = createMockContext();
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'user:user-123:GET:/api/agents',
        5,
        10000,
      );
    });
  });

  describe('endpoint identifier', () => {
    it('uses route.path pattern instead of the actual URL to avoid per-ID key explosion', async () => {
      setMeta({ config: AUTH_CFG, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({
        routePath: '/api/agents/:id',
        actualPath: '/api/agents/abc-123-def',
      });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'user:user-123:GET:/api/agents/:id',
        100,
        60000,
      );
    });

    it('falls back to request.path when route is undefined', async () => {
      setMeta({ config: AUTH_CFG, isPublic: false });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({
        noRoute: true,
        actualPath: '/api/agents',
      });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'user:user-123:GET:/api/agents',
        100,
        60000,
      );
    });
  });

  describe('IP extraction', () => {
    it('uses x-forwarded-for when request.ip is not available', async () => {
      setMeta({ config: PUBLIC_CFG, isPublic: true });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 29,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({
        ip: undefined as unknown as string,
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'ip:10.0.0.1:GET:/api/agents',
        30,
        60000,
      );
    });

    it('uses the first IP from x-forwarded-for when it contains multiple IPs', async () => {
      setMeta({ config: PUBLIC_CFG, isPublic: true });
      mockRateLimiterService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 29,
        retryAfterMs: 0,
        resetMs: 60000,
      });

      const context = createMockContext({
        headers: {
          'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178',
        },
      });
      await guard.canActivate(context);

      expect(mockRateLimiterService.checkRateLimit).toHaveBeenCalledWith(
        'ip:203.0.113.50:GET:/api/agents',
        30,
        60000,
      );
    });
  });
});
