# Redis unavailable

## Symptom
`GET /health/ready` returns 200 with `status: degraded`, `checks.redis.state: degraded`. Render logs: `Redis unavailable after 3 retries — cache/rate-limiting disabled until it recovers`. Chat still works.

## Confirm
- Upstash console: daily command quota, connection errors, region.
- `REDIS_URL` present and correct in Render env.

## Cause
Redis is **optional by design**: the agent/knowledge cache and widget CORS cache fall back to Postgres, and the rate limiter falls back to an in-process limiter (`LocalRateLimiter`) with the same limits, counted per API instance.

## What is actually at risk while it is down
1. **Rate limits are approximate.** Each API instance counts on its own, so with N instances the effective cap is N x the configured limit. Still bounded. Render logs show `Redis unavailable — rate limiting on the in-process fallback` once a minute while this lasts.
2. **Slower turns.** Knowledge/data-field loads hit Postgres every time instead of the cache.
3. If `SOCKET_IO_REDIS=true` (multi-instance only): live handover events stop crossing instances. Single instance: no effect.

## Fix
1. Upstash quota exhausted: upgrade the plan or wait for the daily reset. The app reconnects on its own (`retryStrategy` gives up after 3 tries per outage; a restart forces a fresh attempt).
2. Wrong URL or rotated password: fix `REDIS_URL`, redeploy.
3. Abuse is visible despite the fallback: set the affected agent to inactive from the dashboard, or tighten `allowedDomains`. Both are enforced without Redis.

## Prevent
- Alert on `degraded` from `/health/ready`, not only on 503.
