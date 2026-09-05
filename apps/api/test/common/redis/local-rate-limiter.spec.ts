import { LocalRateLimiter } from '../../../src/common/redis/local-rate-limiter';

describe('LocalRateLimiter', () => {
  let now: number;
  let limiter: LocalRateLimiter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new LocalRateLimiter(20_000, 1_000, () => now);
  });

  it('allows up to the limit and reports remaining excluding the current request', () => {
    const results = Array.from({ length: 3 }, () => limiter.check('k', 3, 60_000));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);
  });

  it('blocks the request that exceeds the limit with a retryAfter derived from the oldest hit', () => {
    limiter.check('k', 2, 60_000); // t=0
    now += 10_000;
    limiter.check('k', 2, 60_000); // t=10s
    now += 5_000;
    const blocked = limiter.check('k', 2, 60_000); // t=15s, third in window

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Oldest hit at t=0 leaves the 60 s window at t=60 s; we are at t=15 s.
    expect(blocked.retryAfterMs).toBe(45_000);
    expect(blocked.resetMs).toBe(60_000);
  });

  it('forgets hits once they leave the window', () => {
    limiter.check('k', 1, 60_000);
    expect(limiter.check('k', 1, 60_000).allowed).toBe(false);

    now += 60_001;
    const again = limiter.check('k', 1, 60_000);

    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(0);
  });

  it('keeps keys independent', () => {
    limiter.check('a', 1, 60_000);
    expect(limiter.check('a', 1, 60_000).allowed).toBe(false);
    expect(limiter.check('b', 1, 60_000).allowed).toBe(true);
  });

  it('sweeps fully-expired keys every N checks', () => {
    const sweeper = new LocalRateLimiter(20_000, 5, () => now);
    sweeper.check('old', 10, 1_000);
    now += 5_000; // 'old' is now outside its window
    for (let i = 0; i < 5; i++) sweeper.check(`k${i}`, 10, 60_000); // 5th check triggers the sweep

    expect(sweeper.size).toBe(5);
  });

  it('evicts the oldest key past the cap instead of growing without bound', () => {
    const small = new LocalRateLimiter(3, 1_000, () => now);
    small.check('a', 10, 60_000);
    small.check('b', 10, 60_000);
    small.check('c', 10, 60_000);
    small.check('d', 10, 60_000);

    expect(small.size).toBe(3);
    // 'a' was evicted; a fresh check on it starts a new window (loosens, never blocks).
    expect(small.check('a', 1, 60_000).allowed).toBe(true);
  });

  it('touching a key moves it to the back of the eviction order', () => {
    const small = new LocalRateLimiter(2, 1_000, () => now);
    small.check('a', 10, 60_000);
    small.check('b', 10, 60_000);
    small.check('a', 10, 60_000); // refresh 'a'
    small.check('c', 10, 60_000); // evicts 'b', not 'a'

    expect(small.check('a', 10, 60_000).remaining).toBe(7); // 3 prior hits kept
  });
});
