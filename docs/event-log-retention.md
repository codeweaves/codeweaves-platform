# Event-Log Retention — runbook & future enhancement

**Status:** Built, shipped **DISABLED** (keep-forever). This doc is the "how to turn it
on later" guide — nothing to do today.

Related: [`plans/observability-everywhere-plan.md`](./plans/observability-everywhere-plan.md) (§9, §11 phase 8).

---

## What it is / why

`event_logs` (the unified observability table added by the observability-everywhere
work) is **append-only** — every channel event and third-party call inserts a row and
nothing removes them. At scale (10K orgs) that table grows without bound, which
eventually costs storage and slows queries.

**Retention** = a policy for how long to keep rows before deleting old ones.
**The "cron"** = a scheduled job that runs the cleanup on a timer (e.g. daily).

## Current state (default)

- Env `EVENT_LOG_RETENTION_DAYS=0` → **keep forever**. The cleanup endpoint is a pure
  **no-op** (returns `{ deleted: 0, skipped: true }`) and never issues a DELETE.
- **Recommended to leave OFF for now** — keep full history while the feature is new and
  we're still learning what's useful. Storage is cheap at current volume.

## How to enable it later (2 steps)

1. **Set the window.** In the API env, set `EVENT_LOG_RETENTION_DAYS` to a positive
   integer, e.g. `90` (delete rows older than 90 days). Any value `<= 0` / unset /
   non-numeric stays a no-op.

2. **Schedule the trigger.** Point an external scheduler at the cleanup endpoint,
   **exactly like the classifier / data-extraction crons already do** (Supabase pg_cron,
   Render Cron, cron-job.org, GitHub Actions schedule — whatever we use for those):

   ```
   POST https://<api-host>/api/klivo/v1/internal/event-logs/cleanup
   Header: x-internal-secret: $INTERNAL_API_SECRET
   ```

   Once a day is plenty. The response reports what happened:
   ```json
   { "deleted": 12345, "skipped": false, "retentionDays": 90, "cutoff": "2026-04-19T…" }
   ```

That's it. No app redeploy needed to change the window — it's read from env per run.

## Implementation reference

- Endpoint/controller: `apps/api/src/controllers/internal/event-log-retention.controller.ts`
  (`@Public()` + `InternalSecretGuard`, i.e. the shared-secret header — no JWT).
- Service: `apps/api/src/services/event-log-retention.service.ts`
  - Reads `EVENT_LOG_RETENTION_DAYS`; `<= 0` → no-op.
  - Deletes in **bounded batches** (5k rows via an id-subselect + `LIMIT`, looping until a
    partial batch) so a first sweep over a large backlog never holds one long lock on the
    hot-write table.
- Index: `event_logs(createdAt)` (migration `20260718010000_event_logs_created_at_index`)
  so the `WHERE createdAt < cutoff` delete uses an index scan, not a seq scan.
- Module: `apps/api/src/modules/event-log-retention.module.ts` (wired into `app.module.ts`).
- Tests: `test/services/event-log-retention.service.spec.ts`,
  `test/controllers/internal/event-log-retention.controller.spec.ts`.

## Picking a window (when we get there)

- **Not a compliance-driven purge.** Prefer keeping data over deleting it — an old record
  can matter for a dispute or security review. The lever is bounding *hot* storage, not
  erasing evidence.
- 90 days is a sensible default for hot/queryable history; 30 if volume is heavy.
- Confirm any regulatory minimum retention that applies before choosing a window.

## Further enhancements (not built)

- **Tiering instead of deletion:** move rows older than the hot window to cheap storage
  (a detached Postgres partition or compressed JSON in object storage) rather than
  deleting — keeps everything retrievable while shrinking the hot table. The metadata
  columns (channel/agentId/orgId/correlationId/createdAt) stay in Postgres for filtering;
  only the large JSON payloads move.
- **Monthly partitioning** of `event_logs` so old months can be detached/archived without
  slow `DELETE`s.
- **Per-subject erasure** (e.g. GDPR right-to-erasure): scrub a specific visitor/user's
  rows on request — a targeted redaction, separate from time-based retention.
