import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RateLimitResult } from './rate-limiter.types';

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Check rate limit using sliding window algorithm with Redis sorted sets.
   *
   * Key pattern: rate_limit:{key}
   * Algorithm:
   *   1. ZREMRANGEBYSCORE — remove expired entries outside the window
   *   2. ZADD — add current request with timestamp as score
   *   3. ZCARD — count requests in the current window
   *   4. EXPIRE — set TTL for automatic cleanup
   *
   * Fail-open: if Redis is unavailable, requests are allowed.
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `rate_limit:${key}`;

    try {
      const pipeline = this.redisService.pipeline();

      // 1. Remove expired entries
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      // 2. Add current request (use timestamp + random suffix for uniqueness)
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
      pipeline.zadd(redisKey, now, member);
      // 3. Count requests in window
      pipeline.zcard(redisKey);
      // 4. Set TTL for cleanup (window in seconds, rounded up)
      pipeline.expire(redisKey, Math.ceil(windowMs / 1000));
      // 5. Get oldest entry score (for precise retryAfterMs)
      pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');

      const results = await pipeline.exec();

      if (!results) {
        this.logger.warn(
          `Rate limit pipeline returned null for key: ${redisKey} — fail-open`,
        );
        return this.failOpen(limit, windowMs);
      }

      // results[2] is the ZCARD result: [error, count]
      const zcardResult = results[2];
      if (!zcardResult || zcardResult[0]) {
        this.logger.warn(
          `Rate limit ZCARD error for key: ${redisKey} — fail-open`,
        );
        return this.failOpen(limit, windowMs);
      }

      const currentCount = zcardResult[1] as number;
      const remaining = Math.max(0, limit - currentCount);
      const resetMs = windowMs;

      if (currentCount > limit) {
        // Calculate precise retryAfterMs from oldest entry in window
        let retryAfterMs = windowMs;
        const zrangeResult = results[4];
        if (zrangeResult && !zrangeResult[0]) {
          const scores = zrangeResult[1] as string[];
          if (scores && scores.length >= 2) {
            const oldestScore = parseInt(scores[1]!, 10);
            if (!isNaN(oldestScore)) {
              retryAfterMs = Math.max(0, oldestScore + windowMs - now);
            }
          }
        }

        return {
          allowed: false,
          remaining: 0,
          retryAfterMs,
          resetMs,
        };
      }

      return {
        allowed: true,
        remaining,
        retryAfterMs: 0,
        resetMs,
      };
    } catch (error) {
      this.logger.warn(
        `Rate limit check failed for key: ${redisKey} — fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.failOpen(limit, windowMs);
    }
  }

  private failOpen(limit: number, windowMs: number): RateLimitResult {
    return {
      allowed: true,
      remaining: limit,
      retryAfterMs: 0,
      resetMs: windowMs,
    };
  }
}
