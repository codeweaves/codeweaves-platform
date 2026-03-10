import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from '../../../src/common/redis/rate-limiter.service';
import { RedisService } from '../../../src/common/redis/redis.service';

const createMockPipeline = (execFn: jest.Mock) => ({
  zremrangebyscore: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  zrange: jest.fn().mockReturnThis(),
  exec: execFn,
});

type MockPipeline = ReturnType<typeof createMockPipeline>;

/** Helper: standard 5-result pipeline (zremrangebyscore, zadd, zcard, expire, zrange) */
const pipelineResults = (
  count: number,
  oldestScore?: number,
): [unknown, unknown][] => [
  [null, 0], // zremrangebyscore
  [null, 1], // zadd
  [null, count], // zcard
  [null, 1], // expire
  [
    null,
    oldestScore !== undefined
      ? [`${oldestScore}:abc123`, String(oldestScore)]
      : [],
  ], // zrange WITHSCORES
];

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockPipelineExec: jest.Mock;
  let mockPipeline: MockPipeline;

  const mockRedisService = {
    pipeline: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPipelineExec = jest.fn();
    mockPipeline = createMockPipeline(mockPipelineExec);
    mockRedisService.pipeline.mockReturnValue(mockPipeline);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  });

  describe('checkRateLimit', () => {
    it('should allow request when within limit', async () => {
      mockPipelineExec.mockResolvedValue(pipelineResults(3));

      const result = await service.checkRateLimit(
        'user:123:/api/test',
        10,
        60_000,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7); // 10 - 3
      expect(result.retryAfterMs).toBe(0);
      expect(result.resetMs).toBe(60_000);
    });

    it('should block request when exceeding limit', async () => {
      const now = Date.now();
      const oldestScore = now - 30_000; // 30s ago
      mockPipelineExec.mockResolvedValue(pipelineResults(11, oldestScore));

      const result = await service.checkRateLimit(
        'user:123:/api/test',
        10,
        60_000,
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      // Precise retryAfterMs: oldestScore + windowMs - now ≈ 30000ms
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it('should return remaining=0 when at exact limit', async () => {
      mockPipelineExec.mockResolvedValue(pipelineResults(10));

      const result = await service.checkRateLimit(
        'user:123:/api/test',
        10,
        60_000,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should use correct Redis key pattern', async () => {
      mockPipelineExec.mockResolvedValue(pipelineResults(1));

      await service.checkRateLimit('user:456:/api/orgs', 100, 60_000);

      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        'rate_limit:user:456:/api/orgs',
        0,
        expect.any(Number),
      );
    });

    it('should set correct TTL based on window (rounded up)', async () => {
      mockPipelineExec.mockResolvedValue(pipelineResults(1));

      await service.checkRateLimit('key', 10, 90_000); // 90s window

      expect(mockPipeline.expire).toHaveBeenCalledWith(
        'rate_limit:key',
        90, // ceil(90000/1000) = 90
      );
    });

    describe('retryAfterMs precision', () => {
      it('should calculate precise retryAfterMs from oldest entry', async () => {
        const now = Date.now();
        const oldestScore = now - 20_000; // oldest entry is 20s ago
        mockPipelineExec.mockResolvedValue(pipelineResults(11, oldestScore));

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(false);
        // oldestScore + 60000 - now ≈ 40000ms
        expect(result.retryAfterMs).toBeGreaterThanOrEqual(39_900);
        expect(result.retryAfterMs).toBeLessThanOrEqual(40_100);
      });

      it('should fall back to windowMs when zrange result is empty', async () => {
        mockPipelineExec.mockResolvedValue([
          [null, 0],
          [null, 1],
          [null, 11],
          [null, 1],
          [null, []], // empty zrange
        ]);

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBe(60_000);
      });

      it('should fall back to windowMs when zrange errors', async () => {
        mockPipelineExec.mockResolvedValue([
          [null, 0],
          [null, 1],
          [null, 11],
          [null, 1],
          [new Error('ZRANGE failed'), null], // zrange error
        ]);

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBe(60_000);
      });
    });

    describe('fail-open behavior', () => {
      it('should allow request when pipeline exec throws', async () => {
        mockPipelineExec.mockRejectedValue(
          new Error('Redis connection refused'),
        );

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
        expect(result.retryAfterMs).toBe(0);
      });

      it('should allow request when pipeline returns null', async () => {
        mockPipelineExec.mockResolvedValue(null);

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
      });

      it('should allow request when ZCARD result has an error', async () => {
        mockPipelineExec.mockResolvedValue([
          [null, 0],
          [null, 1],
          [new Error('ZCARD failed'), null],
          [null, 1],
          [null, []],
        ]);

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10);
      });

      it('should allow request when pipeline throws non-Error', async () => {
        mockPipelineExec.mockRejectedValue('string error');

        const result = await service.checkRateLimit('key', 10, 60_000);

        expect(result.allowed).toBe(true);
      });
    });

    describe('sliding window correctness', () => {
      it('should remove expired entries before counting', async () => {
        const now = Date.now();
        const windowMs = 60_000;

        mockPipelineExec.mockResolvedValue([
          [null, 5], // 5 expired entries removed
          [null, 1],
          [null, 2], // only 2 remain in window
          [null, 1],
          [null, []],
        ]);

        const result = await service.checkRateLimit('key', 10, windowMs);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(8); // 10 - 2

        expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
          'rate_limit:key',
          0,
          expect.any(Number),
        );

        const windowStart =
          mockPipeline.zremrangebyscore.mock.calls[0][2] as number;
        expect(windowStart).toBeGreaterThanOrEqual(now - windowMs - 100);
        expect(windowStart).toBeLessThanOrEqual(now - windowMs + 100);
      });

      it('should add current request with timestamp as score', async () => {
        mockPipelineExec.mockResolvedValue(pipelineResults(1));

        const before = Date.now();
        await service.checkRateLimit('key', 10, 60_000);
        const after = Date.now();

        const score = mockPipeline.zadd.mock.calls[0][1] as number;
        expect(score).toBeGreaterThanOrEqual(before);
        expect(score).toBeLessThanOrEqual(after);
      });
    });
  });
});
