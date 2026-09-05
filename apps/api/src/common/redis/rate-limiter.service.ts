import { Injectable } from '@nestjs/common';
import { AppLogger } from '../logger/app-logger';
import { RedisService } from './redis.service';
import { RateLimitResult } from './rate-limiter.types';
import { LocalRateLimiter } from './local-rate-limiter';

/** Throttle the "Redis down, using local limiter" warning to one per minute. */
const FALLBACK_LOG_INTERVAL_MS = 60_000;

@Injectable()
export class RateLimiterService {
  private readonly log = new AppLogger(RateLimiterService.name);
  /**
   * Engaged only when Redis fails. Per-instance and approximate, but it keeps
   * every cap bounded during an outage instead of removing them all.
   */
  private readonly local = new LocalRateLimiter();
  private lastFallbackLogAt = 0;

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
   * Redis unavailable: falls back to the in-process LocalRateLimiter with the
   * same key/limit/window, so an outage degrades to per-instance limits rather
   * than to no limits (the public chat/voice routes spend LLM money per call).
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
        this.log.warn(
          'checkRateLimit',
          `Rate limit pipeline returned null for key: ${redisKey} — fail-open`,
        );
        return this.fallback(key, limit, windowMs);
      }

      // results[2] is the ZCARD result: [error, count]
      const zcardResult = results[2];
      if (!zcardResult || zcardResult[0]) {
        this.log.warn(
          'checkRateLimit',
          `Rate limit ZCARD error for key: ${redisKey} — fail-open`,
        );
        return this.fallback(key, limit, windowMs);
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
      this.log.warn(
        'checkRateLimit',
        `Rate limit check failed for key: ${redisKey} — fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallback(key, limit, windowMs);
    }
  }

  private fallback(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    if (now - this.lastFallbackLogAt > FALLBACK_LOG_INTERVAL_MS) {
      this.lastFallbackLogAt = now;
      this.log.warn(
        'fallback',
        `Redis unavailable — rate limiting on the in-process fallback (per-instance, ${this.local.size} keys tracked)`,
      );
    }
    return this.local.check(key, limit, windowMs);
  }
}
