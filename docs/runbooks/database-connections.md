# Database slow, pool exhausted, or unreachable

## Symptom
Everything slow. `GET /health/ready` shows `checks.db.latencyMs` in the hundreds or returns 503 with `db.state = fail`. Prisma errors in Render logs: `Timed out fetching a new connection from the connection pool`, `too many clients`, `ECONNREFUSED`.

## Confirm
- Supabase dashboard, Database, Connection pooling: active connections vs the plan's limit.
- `SELECT count(*), state FROM pg_stat_activity GROUP BY state;` in the SQL editor.
- Slow statements: `SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;` (enable the extension once if missing).
- Supabase Advisors tab lists missing indexes and unused ones.

## Cause
- Each API instance holds a `pg` pool of 10 (driver default; `PrismaPg` in `prisma.service.ts`). Two instances = 20 client connections on the pooler.
- `DATABASE_URL` must point at the **pooler on port 6543 with `?pgbouncer=true`** in prod. Pointing at 5432 (direct) with several instances exhausts Postgres itself.
- A long analytics query or a retention sweep holding locks. Retention deletes are batched 5k rows at a time to avoid this.
- Supabase project paused (free tier) or hit compute limits.

## Fix
1. Confirm the URL is the transaction pooler (6543, `pgbouncer=true`). `DIRECT_URL` (5432) is for migrations only.
2. If connections are pinned at the limit: restart the API instance (drops its pool), then find the caller. `pg_stat_activity` shows `query` per connection.
3. If a single query is slow: look for it in `pg_stat_statements`, add the index, redeploy nothing (indexes are migrations; ship one).
4. If Supabase is paused or over quota: unpause / upgrade. Nothing in the app recovers until it does; `/health/ready` will flip back to `ok` on its own.
5. Prisma heartbeat (`SELECT 1` every 20 s per instance) is expected background noise, not a leak.

## Prevent
- Keep `/health/ready` on an uptime monitor; its db latency is the earliest signal.
- Run `scripts/load/k6/widget-chat.js` against staging after any change to session or message writes.
- Do not raise the pool size to fix latency. Fix the query. If you truly need more than 10 per instance, pass `max` to `PrismaPg` and re-check the pooler ceiling.
