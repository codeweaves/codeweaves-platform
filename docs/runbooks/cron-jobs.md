# Cron jobs not running

The API runs **no in-process scheduler**. An external cron (Supabase `pg_cron`, GitHub Actions, cron-job.org, Render Cron) must POST these endpoints with header `x-internal-secret: <INTERNAL_API_SECRET>`.

| Endpoint | Does | If it stops |
|---|---|---|
| `/api/klivo/v1/internal/classifier/run` | Titles, categories, language for finished conversations | Untitled sessions; analytics categories empty |
| `/api/klivo/v1/internal/data-extraction/run` | Extracts lead fields from due conversations (`DATA_EXTRACT_POLL_ENABLED=false` in prod) | Leads stop appearing in Collected Data |
| `/api/klivo/v1/internal/handover/sweep` | Auto-resolves idle handovers (`HANDOVER_IDLE_MINUTES`) | Inbox fills with stale ACTIVE_HUMAN sessions; AI stays paused on them |
| `/api/klivo/v1/internal/retention/run` | Deletes aged `chat_traces` (90 d), `audit_logs` and `event_logs` (if armed) | Database grows (log-growth-and-retention.md) |
| `/api/klivo/v1/internal/event-logs/cleanup` | event_logs only; older entry point, `retention/run` covers it | same |

## Symptom
One of the effects above. No recent run rows:
```sql
SELECT "eventName", max("createdAt") AS last_run
FROM event_logs
WHERE channel = 'INTERNAL'
  AND ("eventName" LIKE '%_RUN_%' OR "eventName" LIKE '%SWEEP%')
GROUP BY 1;
```

## Confirm
- Call by hand: `curl -X POST -H "x-internal-secret: $INTERNAL_API_SECRET" https://<api>/api/klivo/v1/internal/classifier/run`. 401 = wrong or missing secret. 200 with counts = the job works, the scheduler is the problem.
- `INTERNAL_API_SECRET` unset on the API rejects every internal call (fail-closed). Render logs: `INTERNAL_API_SECRET is not set — rejecting internal request`.

## Fix
1. Scheduler side: check its last run and logs. pg_cron: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`
2. Secret rotated on one side only: set the same value on the API and in the scheduler.
3. A run that failed midway is safe to re-run. Every job is idempotent and batched.

## Prevent
- One scheduler, documented next to the env vars. Never two schedulers on the same endpoint.
- Alert when `last_run` is older than twice the schedule. The SQL above is the check.
