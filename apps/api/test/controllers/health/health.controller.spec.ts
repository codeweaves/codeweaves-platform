import { HealthController } from '../../../src/modules/health/health.controller';
import { IS_PUBLIC_KEY } from '../../../src/decorators/public.decorator';
import { SKIP_RATE_LIMIT_KEY } from '../../../src/decorators/rate-limit.decorator';

describe('HealthController (liveness)', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return 200 with status ok, timestamp, version, and uptime', () => {
      const result = controller.getHealth();

      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('uptime');
    });

    it('should return a valid ISO timestamp', () => {
      const result = controller.getHealth();

      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should return version as a string', () => {
      const result = controller.getHealth();

      expect(typeof result.version).toBe('string');
    });

    it('should return uptime as a positive number', () => {
      const result = controller.getHealth();

      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThan(0);
    });

    it('should have no injected dependencies (pure liveness)', () => {
      // HealthController constructor takes no arguments — no DB, no Redis
      const freshController = new HealthController();
      const result = freshController.getHealth();

      expect(result.status).toBe('ok');
    });

    it('should be decorated with @Public()', () => {
      const metadata = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        HealthController.prototype.getHealth,
      );
      expect(metadata).toBe(true);
    });

    it('should be decorated with @SkipRateLimit() at class level', () => {
      const metadata = Reflect.getMetadata(
        SKIP_RATE_LIMIT_KEY,
        HealthController,
      );
      expect(metadata).toBe(true);
    });

    it('should respond in under 10ms (AC#4 liveness performance)', () => {
      const start = performance.now();
      controller.getHealth();
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
    });
  });
});
