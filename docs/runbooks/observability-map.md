# Observability map

Where each signal lives, what it answers, and how long it is kept.

| Signal | Answers | Where | Retention |
|---|---|---|---|
| `GET /health` | Is the process up | Public, no I/O | n/a |
| `GET /health/ready` | Can it serve: Postgres (required) + Redis (degraded if down), each probed with a 2 s timeout | Public. 200 `ok` / `degraded`, 503 `fail` | n/a |
| Render logs | Console output, format `[Service] [fn] - message {meta}` (`AppLogger`). Boot errors land here. | Render dashboard | Render window |
| Sentry | Every 5xx (with correlation id, method, URL), voice STT/TTS failures, unhandled errors. Bodies and headers scrubbed. Performance traces when `SENTRY_TRACES_SAMPLE_RATE` > 0. | Sentry project | Sentry plan |
| `event_logs` | **What the system did.** Inbound channel traffic and every outbound third-party call, with latency, success, error, correlation id. | Postgres | `EVENT_LOG_RETENTION_DAYS` (0 = forever) |
| `chat_traces` | **What the AI did on one turn.** Steps knowledge.load, context.load, pii.redact, llm.call_start, llm.complete with timings, model, tokens, cost. | Postgres | `CHAT_TRACE_RETENTION_DAYS` (default 90) |
| `audit_logs` | **Who did what.** Every user mutation: agents, org, members, roles, invitations, knowledge, files, handover actions, privacy erasures, email templates. | Postgres | `AUDIT_LOG_RETENTION_DAYS` (0 = forever) |
| `llm_usage` | Cost and tokens per call by org, agent, model, feature. Buffered in memory, flushed every 5 s or 50 rows, and on shutdown. | Postgres | forever |
| `chat_message_metrics` | Typed per-message latency columns the analytics page aggregates. | Postgres | with messages |
| `handover_events` | Append-only handover timeline (requested, taken over, resolved, by whom). | Postgres | with sessions |

## event_logs: channels and names

`channel` is `DASHBOARD`, `WIDGET`, `VOICE`, `WHATSAPP` or `INTERNAL` (cron). Provider calls carry `provider`.

- Widget: `WIDGET_SESSION_STARTED`, `WIDGET_MESSAGE_RECEIVED`, `WIDGET_REPLY_SENT`, `WIDGET_MESSAGE_RATE_LIMITED`, `WIDGET_MESSAGE_EXCEPTION`
- Voice: `VOICE_CONVERSATION_RECEIVED`, `VOICE_REPLY_SENT`, `VOICE_STT_FAILED`, `VOICE_TTS_SENTENCE_FAILED`, `VOICE_STREAM_FAILED`, `VOICE_CONVERSATION_EXCEPTION`, `TTS_ALL_PROVIDERS_FAILED`
- WhatsApp: `WHATSAPP_WEBHOOK_VERIFIED`, `WHATSAPP_WEBHOOK_REJECTED`, `WHATSAPP_MESSAGE_RECEIVED`, `WHATSAPP_REPLY_SENT`, `WHATSAPP_INBOUND_EXCEPTION`, `META_WHATSAPP_SEND_TEXT`
- Providers: `LLM_COMPLETION_COMPLETED`, `LLM_COMPLETION_FAILED`, `RESEND_EMAIL_COMPLETED/FAILED`, `CLERK_INVITATION_COMPLETED/FAILED`, `SUPABASE_STORAGE_UPLOAD/REMOVE_COMPLETED/FAILED`
- Cron: `CLASSIFIER_RUN_STARTED/COMPLETED/FAILED`, `DATA_EXTRACTION_RUN_STARTED/COMPLETED`, `HANDOVER_SWEEP_COMPLETED`
- Dashboard HTTP: `DASHBOARD_HTTP_<METHOD>` for every mutating request, `DASHBOARD_HTTP_ERROR` for failures (incl. 401/403/429 from guards)

Headers are redacted before insert (`authorization`, `cookie`, `x-internal-secret`, anything matching secret/apikey/password). Widget, voice and WhatsApp request bodies are never stored in HTTP envelopes.

## Queries to keep handy

Failures in the last hour, by channel and name:

```sql
SELECT channel, "eventName", count(*) AS n, max("createdAt") AS last_seen
FROM event_logs
WHERE success = false AND "createdAt" > now() - interval '1 hour'
GROUP BY 1, 2 ORDER BY n DESC;
```

LLM cost today, by org and model:

```sql
SELECT "organizationId", model, count(*) AS calls,
       round(sum(cost)::numeric, 4) AS usd, sum("totalTokens") AS tokens
FROM llm_usage
WHERE "createdAt" > date_trunc('day', now())
GROUP BY 1, 2 ORDER BY usd DESC;
```

Provider latency p50/p95 over the last 24 h:

```sql
SELECT provider, "eventName",
       percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95,
       count(*) AS n
FROM event_logs
WHERE provider IS NOT NULL AND "createdAt" > now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY p95 DESC;
```

One request end to end:

```sql
SELECT "createdAt", channel, "eventName", provider, "latencyMs", success, "errorMessage"
FROM event_logs WHERE "correlationId" = '<id>' ORDER BY "createdAt";

SELECT "traceId", model, "totalDurationMs", success, steps
FROM chat_traces WHERE "correlationId" = '<id>';
```

Failed AI turns in the last hour, by agent:

```sql
SELECT "agentId", count(*) AS failed, max("startedAt") AS last
FROM chat_traces
WHERE success = false AND "startedAt" > now() - interval '1 hour'
GROUP BY 1 ORDER BY failed DESC;
```

## Known gaps

- **No alerting.** Put an uptime monitor on `/health/ready` (Better Stack, UptimeRobot or Cloudflare health checks), 30 s interval, alert on 503 or timeout, and on the `degraded` string if the monitor can match body text. Add a Sentry alert rule on the 502 count from `/public/chat/stream`.
- **No metrics dashboard.** The SQL above is the dashboard. When that gets old, the cheapest next step is Grafana Cloud free tier reading these Postgres tables.
- **`SENTRY_TRACES_SAMPLE_RATE` is 0 by default.** Set 0.1 in prod for p95 per route.
- **Retention is off for event_logs by default.** Set `EVENT_LOG_RETENTION_DAYS=365` in prod and make sure the retention cron runs (cron-jobs.md).
