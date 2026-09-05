import { HealthController } from '../../../src/modules/health/health.controller';
import { IS_PUBLIC_KEY } from '../../../src/decorators/public.decorator';
import { SKIP_RATE_LIMIT_KEY } from '../../../src/decorators/rate-limit.decorator';
import type { PrismaService } from '../../../src/services/prisma.service';
import type { RedisService } from '../../../src/common/redis/redis.service';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let config: { get: jest.Mock };
  let res: { status: jest.Mock };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ one: 1 }]) };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    config = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
    res = { status: jest.fn() };
    controller = new HealthController(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
    );
  });

  describe('getHealth (liveness)', () => {
    it('returns status ok, timestamp, version, uptime without touching any dependency', () => {
      const result = controller.getHealth();

      expect(result.status).toBe('ok');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
      expect(typeof result.version).toBe('string');
      expect(result.uptime).toBeGreaterThan(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(redis.ping).not.toHaveBeenCalled();
    });

    it('is @Public() and the controller skips rate limiting', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.getHealth)).toBe(true);
      expect(Reflect.getMetadata(SKIP_RATE_LIMIT_KEY, HealthController)).toBe(true);
    });

    it('responds in under 10ms', () => {
      const start = performance.now();
      controller.getHealth();
      expect(performance.now() - start).toBeLessThan(10);
    });
  });

  describe('getReadiness', () => {
    it('is @Public()', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.getReadiness)).toBe(true);
    });

    it('reports ok with 200 when both probes pass', async () => {
      const report = await controller.getReadiness(res as unknown as Response);

      expect(report.status).toBe('ok');
      expect(report.checks.db.state).toBe('ok');
      expect(report.checks.redis.state).toBe('ok');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('reports fail with 503 when the database probe throws', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

      const report = await controller.getReadiness(res as unknown as Response);

      expect(report.status).toBe('fail');
      expect(report.checks.db).toEqual(expect.objectContaining({ state: 'fail', error: 'error' }));
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('reports degraded with 200 when Redis fails (fail-open dependency)', async () => {
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const report = await controller.getReadiness(res as unknown as Response);

      expect(report.status).toBe('degraded');
      expect(report.checks.redis.state).toBe('degraded');
      expect(report.checks.db.state).toBe('ok');
      expect(res.status).not.toHaveBeenCalled();
    });

    it('reports redis as disabled when REDIS_URL is not set, without pinging', async () => {
      config.get.mockReturnValue(undefined);

      const report = await controller.getReadiness(res as unknown as Response);

      expect(report.status).toBe('ok');
      expect(report.checks.redis.state).toBe('disabled');
      expect(redis.ping).not.toHaveBeenCalled();
    });

    it('never leaks dependency error text, only a coarse reason', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('password authentication failed for user postgres'));

      const report = await controller.getReadiness(res as unknown as Response);

      expect(JSON.stringify(report)).not.toContain('password');
      expect(report.checks.db.error).toBe('error');
    });

    it('times out a hung probe instead of hanging the health check', async () => {
      jest.useFakeTimers();
      try {
        prisma.$queryRaw.mockReturnValue(new Promise(() => undefined));

        const pending = controller.getReadiness(res as unknown as Response);
        await jest.advanceTimersByTimeAsync(2_100);
        const report = await pending;

        expect(report.status).toBe('fail');
        expect(report.checks.db.error).toBe('timeout');
        expect(res.status).toHaveBeenCalledWith(503);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
