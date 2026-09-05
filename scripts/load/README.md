# Load testing

Two k6 scripts cover the paths that matter at launch. Run them against **staging + a Supabase branch**, never production.

| Script | Path under test | Why |
|---|---|---|
| `k6/widget-chat.js` | widget config, `POST /public/chat/stream` (SSE), handover poll | The money path. Holds open SSE streams, which is what exhausts sockets and the DB pool first. |
| `k6/dashboard.js` | analytics summary/charts/handover/agents, conversations list | Heaviest SQL in the app. 30 staff refreshing dashboards. |

Voice is not scripted. It needs an audio fixture and burns STT + TTS + LLM money per turn. Smoke it by hand with the widget after the chat test passes; the same rate limiter and DB pool are in play.

## Install

- Windows: `winget install k6 --source winget`
- macOS: `brew install k6`
- Docker: `docker run --rm -i grafana/k6 run - <scripts/load/k6/widget-chat.js`

## Before you run

1. **Use a test agent on a cheap model.** Every stream turn is a real LLM call. `widget-chat.js` at the default profile makes roughly 600 to 900 turns. On `gpt-4.1-mini` with a short prompt that is cents, on a large model it is not.
2. **Raise the per-IP ceiling on the target.** k6 runs from one IP. `MessageRateLimitService` caps one IP at 30 msg/min and 300 msg/hr per agent (`MSG_IP_MINUTE_LIMIT`, `MSG_IP_HOUR_LIMIT`). Set both to `1000000` on the staging API for the run, then put them back. The per-device limit (10/min) stays: each VU is its own device and sleeps 8 to 12 s between turns, which is under it.
3. **Allow the origin.** Either put the `ORIGIN` you pass into the test agent's `allowedDomains`, or leave `allowedDomains` empty.
4. **Watch these while it runs:**
   - Supabase: Database, Connection pooling: active client connections. Each API instance holds a `pg` pool of 10.
   - Render: CPU and memory on the API instance. Memory is the one to watch: multer buffers every voice upload in RAM.
   - `GET /health/ready` from another terminal every 10 s: `checks.db.latencyMs` rising is the first sign the pool is saturated.
   - Sentry: new 5xx during the run.

## Run

```bash
k6 run -e BASE_URL=https://api-staging.example.com \
       -e AGENT_PUBLIC_ID=abcd1234 \
       -e ORIGIN=https://customer.example \
       -e RUN_ID=$(date +%s) \
       scripts/load/k6/widget-chat.js

# Only the polling load (no LLM spend):
k6 run -e BASE_URL=... -e AGENT_PUBLIC_ID=... -e MODE=poll-only scripts/load/k6/widget-chat.js

# Dashboard reads. CLERK_TOKEN is a Clerk session JWT for a TEST user.
# Default session tokens expire in 60 s, so mint one from a Clerk JWT template
# with a longer lifetime for the run.
k6 run -e BASE_URL=... -e DASHBOARD_ORIGIN=https://app-staging.example.com \
       -e CLERK_TOKEN=eyJ... scripts/load/k6/dashboard.js
```

## Pass criteria (thresholds in the scripts)

| Metric | Target | Reason |
|---|---|---|
| `config_ms` p95 | < 800 ms | Widget first paint depends on it. Cached per agent after the first hit. |
| `stream_turn_ms` p95 | < 15 s | Whole turn incl. LLM. Controller times the SSE out at 30 s, LLM at 60 s. |
| `stream_failed` | < 2% | Anything above means the API, not the model, is failing. |
| `poll_ms` p95 | < 500 ms | Two indexed queries. |
| `analytics_ms` p95 | < 2.5 s | 30-day SQL aggregates. |
| `http_req_failed` | < 2% (widget), < 1% (dashboard) | |

## Capacity maths

10K customers/month at ~10 messages each is ~100K messages/month, ~2.3/min average, ~2/s at a 50x peak. The widget script's 100 concurrent VUs at one turn per ~10 s is ~10 turns/s, about 5x that peak. If it passes, request volume is not your risk. Concurrency is: 100 open SSE streams per instance with a 10-connection pg pool works only because the DB is touched briefly at the start and end of a turn, not during the stream. If `checks.db.latencyMs` climbs under load, that assumption is breaking.

## If it fails

| Symptom | First move |
|---|---|
| `stream_failed` climbs, Sentry shows `LLM_COMPLETION_FAILED` | Provider rate limit. Lower VUs or add `fallbackModels` to the test agent. See `docs/runbooks/llm-provider-outage.md`. |
| `checks.db.latencyMs` rises, then 503 on `/health/ready` | Pool saturation. See `docs/runbooks/database-connections.md`. |
| `stream_rate_limited` > 0 | You did not raise `MSG_IP_*_LIMIT` on the target. |
| Render memory climbs and does not fall | Open streams not closing on client abort. Check `res.on('close')` paths; capture a heap snapshot. |
| `poll_ms` p95 > 500 ms | Missing index or the DB is already saturated by the chat scenario. Run `MODE=poll-only` to separate them. |
