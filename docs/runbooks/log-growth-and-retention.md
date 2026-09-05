# Database growth and retention

## Symptom
Supabase storage climbing; `event_logs` or `chat_traces` are the largest tables.

## Confirm
```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

## What grows, what trims it
| Table | Written by | Trimmed by | Setting |
|---|---|---|---|
| `event_logs` | every channel message, provider call, mutating dashboard request | `/internal/retention/run` | `EVENT_LOG_RETENTION_DAYS` (0 = forever, the default). Set 365 in prod |
| `chat_traces` | every AI turn | same | `CHAT_TRACE_RETENTION_DAYS` (default 90) |
| `audit_logs` | every user mutation | same | `AUDIT_LOG_RETENTION_DAYS` (0 = forever; if armed keep >= 365) |
| `llm_usage` | every LLM call | nothing | fine at 10K users/month |
| `chat_messages`, `collected_data`, `chat_sessions` | product data | only the erasure engine (`/privacy/*`) on request | never by retention, by design |

`event_logs` payloads are capped at `EVENT_LOG_MAX_PAYLOAD_BYTES` (32 KB). `EVENT_LOG_HTTP_CAPTURE=false` switches off the per-mutation dashboard envelopes if they dominate.

## Fix
1. Set `EVENT_LOG_RETENTION_DAYS=365` in Render env, redeploy, and make sure the retention cron runs (cron-jobs.md).
2. The first sweep over months of data runs in 5k-row batches and commits each. Safe on a live database, can take minutes. Run it off-peak the first time.
3. After a big delete Postgres reclaims space lazily. `VACUUM (VERBOSE) event_logs;` if the size has not dropped after a day.

## Prevent
- Retention env set from day one in prod. Keep audit logs forever unless a policy says otherwise.
- Watch the `WIDGET_MESSAGE_RATE_LIMITED` count: a flood writes one row per rejected request (review item E-4 proposes capping that).
