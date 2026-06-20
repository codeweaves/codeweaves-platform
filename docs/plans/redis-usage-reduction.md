# Redis (Upstash) usage reduction

## Problem

Upstash was billing ~130–145k commands/day **with ~5 users and no real load**, blowing
13× past the 10k/day free tier.

## Diagnosis (evidence-based)

We attributed the traffic with a read-only probe against the live Upstash
(`INFO` + keyspace scan + a live watcher) plus the console command graph:

| Source | Finding |
| --- | --- |
| **BullMQ workers** | ~100% of traffic. Keyspace was **44 keys, all `bull:*`** (classifier + whatsapp-inbound). Every command on the console graph (`EVALSHA`, `DEL`, `HMGET`, `BZPOPMIN`, `HGET`, `EXISTS`) is a BullMQ internal. Two in-process workers polled Redis 24/7 even with zero jobs — and this **multiplies per instance**. |
| **Rate limiter** | The global `RateLimitGuard` ran a **5-command pipeline on every HTTP request**, including authenticated dashboard browsing. Confirmed live: dashboard use created `rate_limit:*` keys. Upstash's per-command graph does **not** display sorted-set (`Z*`) commands, so this was invisible there but still billed. |

Key insight: on a **single instance**, all three Redis uses (queues, rate-limit,
cache) were solving multi-instance problems we don't have yet.

## Changes (this branch: `fix/redis-usage`)

### 1. BullMQ removed entirely
- **Classifier** → external cron. New internal endpoint `POST /internal/classifier/run`
  (guarded by `INTERNAL_API_SECRET`) runs `ConversationClassifierService.runBatch()`
  directly against Postgres. The in-process repeatable job + worker are gone.
- **WhatsApp** → inline. The webhook ACKs Meta with a fast `200` first, then runs the
  agent in the background (`WhatsappWebhookController` → `WhatsappInboundService.handleInbound`).
  A bounded in-memory set dedupes the rare duplicate delivery (fast ACK already prevents
  Meta retries). No queue, no Redis.
- Deleted: both processors, the classifier constants, `bullmq` + `@nestjs/bullmq` deps,
  and the Bull root config.

### 2. Rate limiting is now OPT-IN
- `RateLimitGuard` stays global but is a **no-op unless a route declares `@RateLimit(...)`**.
  No decorator → returns immediately, **zero Redis**. Authenticated dashboard browsing now
  costs nothing.
- The few public/abuse-prone routes that *should* be limited get `@RateLimit()` explicitly.
  Still Redis-backed, so it stays correct across multiple instances — no rework when we scale.
- The widget chat message limit (`MessageRateLimitService`) is **separate** and untouched —
  it still protects the public chat endpoint.

## Setup required to deploy

### 1. Set the internal secret (web service)
Add an env var to the API service (and local `.env`):
```
INTERNAL_API_SECRET=<a long random string>
```
Without it, `/internal/*` endpoints fail closed (reject everything).

### 2. Schedule the classifier cron
Point any external scheduler at the endpoint, daily, with the secret header.
Recommended schedule: `0 2 * * *` (02:00 UTC).

**Render Cron Job** (recommended — already on Render):
```
curl -fsS -X POST https://<api-host>/internal/classifier/run \
     -H "x-internal-secret: $INTERNAL_API_SECRET"
```

**GitHub Actions** (`.github/workflows/classifier-cron.yml`):
```yaml
on:
  schedule: [{ cron: "0 2 * * *" }]
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "${{ secrets.API_HOST }}/internal/classifier/run" \
               -H "x-internal-secret: ${{ secrets.INTERNAL_API_SECRET }}"
```

**cron-job.org / Upstash QStash**: POST the same URL + header on the same schedule.

> `runBatch()` is idempotent, so a missed or duplicated tick is harmless.

## Adding `@RateLimit()` where you want it

Rate limiting is opt-in. To guard a route, add the decorator (method or controller level):
```ts
import { RateLimit } from '../decorators/rate-limit.decorator';

@Post('login')
@RateLimit({ limit: 5, windowMs: 60_000 }) // 5 attempts / minute, keyed by IP
login() { ... }
```
Presets live in `rate-limiter.types.ts` (`DEFAULT_PUBLIC_RATE_LIMIT`, etc.).
Candidate routes: login/auth, demo voice, any unauthenticated public endpoint.
Authenticated dashboard routes deliberately get nothing.

## Future (when we go multi-instance)

- Keep `@RateLimit()` on the public routes — already Redis-backed, no change needed.
- Move from **per-command Upstash** to a **flat-rate self-hosted Valkey/Redis** box
  (~$7–15/mo, command count irrelevant) so scale doesn't reprice.
- If the in-process agent cache or rate limiter ever needs cross-instance sharing again,
  reintroduce Redis there behind the same interfaces.
