import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { SkipRateLimit } from '../../decorators/rate-limit.decorator';
import { PrismaService } from '../../services/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppLogger } from '../../common/logger/app-logger';

/**
 * A dependency probe never waits longer than this. The platform health check
 * itself times out after a few seconds, so a hung probe must report, not hang.
 */
const CHECK_TIMEOUT_MS = 2_000;

export type CheckState = 'ok' | 'fail' | 'degraded' | 'disabled';

export interface DependencyCheck {
  state: CheckState;
  latencyMs: number;
  /** Coarse reason only (timeout | error). Details stay in server logs. */
  error?: 'timeout' | 'error';
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'fail';
  timestamp: string;
  checks: {
    db: DependencyCheck;
    redis: DependencyCheck;
  };
}

@ApiTags('Health')
@SkipRateLimit()
@Controller('health')
export class HealthController {
  private readonly log = new AppLogger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness: is the process up. No I/O, so it never flaps on a dependency. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness health check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getHealth(): {
    status: string;
    timestamp: string;
    version: string;
    uptime: number;
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.0',
      uptime: process.uptime(),
    };
  }

  /**
   * Readiness: can this instance serve traffic. Postgres is required (503 when
   * unreachable). Redis is fail-open everywhere in the app (cache, opt-in rate
   * limits), so a Redis problem reports `degraded` with a 200: the instance
   * still works, but someone should look. Point uptime monitors and the
   * platform health check here, not at the liveness route.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: Postgres + Redis probes with 2s timeouts' })
  @ApiResponse({ status: 200, description: 'Ready (or degraded: Redis down, DB fine)' })
  @ApiResponse({ status: 503, description: 'Not ready: database unreachable' })
  async getReadiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const status: ReadinessReport['status'] =
      db.state === 'fail' ? 'fail' : redis.state === 'degraded' ? 'degraded' : 'ok';
    if (status === 'fail') res.status(503);
    return { status, timestamp: new Date().toISOString(), checks: { db, redis } };
  }

  private async checkDb(): Promise<DependencyCheck> {
    const start = performance.now();
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return { state: 'ok', latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      const error = err instanceof ProbeTimeoutError ? 'timeout' : 'error';
      this.log.error('checkDb', 'readiness: database probe failed', err, { error });
      return { state: 'fail', latencyMs: Math.round(performance.now() - start), error };
    }
  }

  private async checkRedis(): Promise<DependencyCheck> {
    if (!this.config.get<string>('REDIS_URL')) {
      return { state: 'disabled', latencyMs: 0 };
    }
    const start = performance.now();
    try {
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return { state: 'ok', latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      const error = err instanceof ProbeTimeoutError ? 'timeout' : 'error';
      this.log.warn('checkRedis', 'readiness: redis probe failed (fail-open features degraded)', {
        error,
        message: err instanceof Error ? err.message : String(err),
      });
      return { state: 'degraded', latencyMs: Math.round(performance.now() - start), error };
    }
  }
}

class ProbeTimeoutError extends Error {
  constructor() {
    super('probe timeout');
    this.name = 'ProbeTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
