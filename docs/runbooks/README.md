# Runbooks

What to do when something breaks in production. One page per failure mode. Each page has the same shape: **Symptom, Confirm, Cause, Fix, Prevent.**

Start with [observability-map.md](observability-map.md) if you do not know where a signal lives.

## Triage in five steps

1. **Everyone or one tenant?** `GET https://<api>/health/ready`. `fail` (503) = database down, everyone is affected. `degraded` = Redis down, rate limits and caches are off but chat works. `ok` and one customer is complaining = look at that agent or org.
2. **Get a correlation id.** Every response carries `X-Correlation-Id`. Ask the reporter for it, or find the request in Sentry (5xx are captured with the id).
3. **Pull the request trail.** `SELECT * FROM event_logs WHERE "correlationId" = '<id>' ORDER BY "createdAt";` shows the inbound request and every third-party call it made (LLM, STT, TTS, Meta, Resend, Clerk) with latency and error.
4. **For an AI turn, read the trace.** `SELECT * FROM chat_traces WHERE "correlationId" = '<id>';` shows knowledge load, context assembly, PII redaction and the LLM call, step by step.
5. **Pick the runbook** from the table below.

## Symptom index

| Symptom | Runbook |
|---|---|
| Bot replies fail or time out, `LLM_COMPLETION_FAILED` in event_logs | [llm-provider-outage.md](llm-provider-outage.md) |
| Everything slow, `/health/ready` db latency high or 503 | [database-connections.md](database-connections.md) |
| `/health/ready` says `degraded`, rate limits not applying | [redis-down.md](redis-down.md) |
| Dashboard users get 401, new invitees cannot sign in | [auth-failures.md](auth-failures.md) |
| Voice: speech recognition failed, no audio, `VOICE_STT_FAILED` / `VOICE_TTS_SENTENCE_FAILED` | [voice-failures.md](voice-failures.md) |
| Conversations never get a title, retention not running, leads not extracted, handovers never auto-resolve | [cron-jobs.md](cron-jobs.md) |
| WhatsApp messages not arriving or not answered | [whatsapp-webhook.md](whatsapp-webhook.md) |
| Suspected abuse, LLM bill spike, one agent flooding | [rate-limits-and-abuse.md](rate-limits-and-abuse.md) |
| Database size growing fast, event_logs or chat_traces huge | [log-growth-and-retention.md](log-growth-and-retention.md) |
| API will not boot after a deploy, or usage numbers dropped after one | [deploys-and-shutdown.md](deploys-and-shutdown.md) |

## Conventions

- `<api>` is the API host. App routes live under `/api/klivo/v1`; `/health` and `/health/ready` do not.
- SQL runs in the Supabase SQL editor. Read-only unless the page says otherwise.
- Console logs are `[ServiceName] [functionName] - message {json}`. Grep Render logs by service name.
