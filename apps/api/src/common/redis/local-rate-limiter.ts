import type { RateLimitResult } from './rate-limiter.types';

/**
 * In-process sliding-window limiter. The FALLBACK for RateLimiterService when
 * Redis is unreachable, not a replacement for it.
 *
 * Why it exists: every consumer of the rate limiter is fail-open, which is the
 * right default for a cache. It is the wrong default for the public chat and
 * voice routes, where each accepted request spends LLM money. Without this, a
 * Redis outage (Upstash quota, rotated password, network) silently removed
 * every per-device and per-IP cap at once.
 *
 * Limits of the fallback, on purpose:
 *   - Per instance. Two API instances each allow `limit` requests, so the
 *     effective cap is N x limit. Still bounded, which is the point.
 *   - Bounded memory. Keys are pruned as their windows expire, and the map is
 *     capped; past the cap the OLDEST key is evicted (a busy key is re-created
 *     on its next request, so eviction only ever loosens, never blocks).
 *   - Same semantics as the Redis path: the current request is counted before
 *     the comparison, `remaining` excludes it, `retryAfterMs` is derived from
 *     the oldest timestamp still in the window.
 */
export class LocalRateLimiter {
  /** Per key: hit timestamps (insertion order) + that key's own window. */
  private readonly windows = new Map<string, { hits: number[]; windowMs: number }>();
  private checksSinceSweep = 0;

  constructor(
    private readonly maxKeys = 20_000,
    private readonly sweepEvery = 1_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.now();
    const windowStart = now - windowMs;

    const existing = this.windows.get(key)?.hits;
    // Drop timestamps that fell out of the window. Arrays are in insertion
    // order, so the first still-valid index bounds the slice.
    let hits: number[];
    if (existing) {
      let firstValid = 0;
      while (firstValid < existing.length && existing[firstValid]! <= windowStart) firstValid++;
      hits = firstValid === 0 ? existing : existing.slice(firstValid);
    } else {
      hits = [];
    }
    hits.push(now);
    // Re-set so the key moves to the end of insertion order (cheap LRU-ish).
    this.windows.delete(key);
    this.windows.set(key, { hits, windowMs });

    this.maybeSweep(now);
    this.enforceCap();

    const count = hits.length;
    if (count > limit) {
      const oldest = hits[0]!;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, oldest + windowMs - now),
        resetMs: windowMs,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterMs: 0,
      resetMs: windowMs,
    };
  }

  /** Number of keys currently tracked. Exposed for tests and diagnostics. */
  get size(): number {
    return this.windows.size;
  }

  /** Every `sweepEvery` checks, drop keys whose every hit is outside THEIR window. */
  private maybeSweep(now: number): void {
    if (++this.checksSinceSweep < this.sweepEvery) return;
    this.checksSinceSweep = 0;
    for (const [key, entry] of this.windows) {
      const last = entry.hits[entry.hits.length - 1];
      if (last === undefined || last <= now - entry.windowMs) this.windows.delete(key);
    }
  }

  private enforceCap(): void {
    while (this.windows.size > this.maxKeys) {
      const oldestKey = this.windows.keys().next().value;
      if (oldestKey === undefined) break;
      this.windows.delete(oldestKey);
    }
  }
}
