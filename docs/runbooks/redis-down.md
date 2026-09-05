# Redis unavailable

## Symptom
`GET /health/ready` returns 200 with `status: degraded`, `checks.redis.state: degraded`. Render logs: `Redis unavailable after 3 retries — cache/rate-limiting disabled until it recovers`. Chat still works.

## Confirm
- Upstash console: daily command quota, connection errors, region.
- `REDIS_URL` present and correct in Render env.

## Cause
Redis is **optional and fail-open by design**: agent/knowledge cache, widget CORS cache and the message rate limiter all fall back to Postgres or to "allow" when Redis errors (`RateLimiterService.checkRateLimit` returns `allowed: true` on any error).

## What is actually at risk while it is down
1. **No rate limits on public endpoints.** Every widget/voice message goes through. An abuser can run up the LLM bill. Watch `llm_usage` by agent (query in observability-map.md) until Redis is back.
2. **Slower turns.** Knowledge/data-field loads hit Postgres every time instead of the cache.
3. If `SOCKET_IO_REDIS=true` (multi-instance only): live handover events stop crossing instances. Single instance: no effect.

## Fix
1. Upstash quota exhausted: upgrade the plan or wait for the daily reset. The app reconnects on its own (`retryStrategy` gives up after 3 tries per outage; a restart forces a fresh attempt).
2. Wrong URL or rotated password: fix `REDIS_URL`, redeploy.
3. Redis is gone for a long time and abuse is visible: set the affected agent to inactive from the dashboard, or tighten `allowedDomains`. Both are enforced without Redis.

## Prevent
- The rate limiter has no in-memory fallback today. That is proposed item B-1 in `docs/review/develop-review-2026-09-05.md`. Until it lands, a Redis outage is a cost-exposure event, not just a performance one.
- Alert on `degraded` from `/health/ready`, not only on 503.
