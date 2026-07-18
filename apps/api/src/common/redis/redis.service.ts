import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppLogger } from '../logger/app-logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new AppLogger(RedisService.name);
  private client!: Redis;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      // Never crash the backend over Redis. It powers only optional, fail-open
      // features (agent cache, opt-in rate limiting) — the app runs fine without it.
      this.log.warn(
        'onModuleInit',
        'REDIS_URL not set — cache + rate limiting disabled. Backend continues.',
      );
      return;
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      // Fail commands FAST instead of queueing them forever when Redis is
      // unreachable or has hit its plan/daily limit. Every consumer is fail-open,
      // so a fast rejection just falls through to Postgres / allows the request —
      // the backend never hangs or boots-fails because of Redis.
      enableOfflineQueue: false,
      retryStrategy: (times: number) => {
        if (times > 3) {
          this.log.warn(
            'onModuleInit',
            'Redis unavailable after 3 retries — cache/rate-limiting disabled until it recovers.',
          );
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.log.info('onModuleInit', 'Redis connection established');
    });

    this.client.on('error', () => {
      // Silenced — retryStrategy handles logging; consumers fail open.
    });

    try {
      await this.client.connect();
      this.log.info('onModuleInit', 'RedisService initialized');
    } catch (err) {
      // Non-fatal: boot MUST NOT depend on Redis being reachable. Commands will
      // fail-fast and consumers fall back to Postgres / allow.
      this.log.warn(
        'onModuleInit',
        `Redis not available at startup — backend continues, features degraded. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.log.info('onModuleDestroy', 'Redis connection closed');
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    if (ttlSeconds !== undefined) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    return this.client.eval(script, numKeys, ...args);
  }

  async zadd(
    key: string,
    score: number,
    member: string,
  ): Promise<number | string> {
    return this.client.zadd(key, score, member);
  }

  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  pipeline() {
    return this.client.pipeline();
  }

  getClient(): Redis {
    return this.client;
  }
}
