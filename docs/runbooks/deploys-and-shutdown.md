# Deploys, boot failures, and shutdown

## Boot fails after a deploy
Render shows the instance restarting. Read the first error in Render logs. These checks fail fast on purpose:

| Log line | Meaning | Fix |
|---|---|---|
| `CLERK_ISSUER must be configured` | env missing | set it |
| `AGENT_SECRET_KEY environment variable is required` / `must be a 64-character hex string` | encryption key missing or wrong length | set the 32-byte hex key. Never rotate it casually: every encrypted secret, lead field and PII vault value is under it |
| `DATABASE_URL environment variable is not configured` | env missing | set it (pooler URL, port 6543, `pgbouncer=true`) |
| `Authorization declaration check failed. N route(s) declare no authorization` | a controller method shipped without `@Public`, `@SelfOnly` or `@RequirePermission` | add the decorator. This is the RBAC safety net, never disable it |
| `route(s) require a permission with no row in the permissions table` | decorator names a permission no migration seeded | add the `permissions` row in a migration |
| `permission catalog refresh failed` and boot stops | database unreachable at boot | database-connections.md |

Missing provider keys (LLM, STT, TTS, Resend) do **not** fail boot; the first call to that provider fails instead. So after every deploy: `/health/ready`, then one test message.

## What happens on SIGTERM (deploy, scale-down, restart)
Since 2026-09-05 the API enables Nest shutdown hooks. On SIGTERM it:
1. Flushes the buffered `llm_usage` batch. Before this, every deploy lost up to 5 s or 50 rows of cost data.
2. Stops the Prisma heartbeat, the AI keepalive timer and the extraction poller.
3. Closes Redis and disconnects Prisma.
4. Exits. Render sends SIGKILL if this takes longer than its grace period.

In-flight SSE and voice streams are cut at step 3. The widget shows its generic error and the visitor retries. There is no connection draining. If that becomes a complaint, add a `beforeApplicationShutdown` hook that stops accepting new streams and waits up to N seconds for open ones.

## Post-deploy checklist (2 minutes)
1. `GET /health/ready` returns `ok`. `degraded` means Redis; chat still works.
2. Send one widget message on a test agent. Confirm a `WIDGET_REPLY_SENT` row and a `chat_traces` row with `success = true`.
3. Open the dashboard once. A 401 storm means Clerk env drift (auth-failures.md).
4. If usage or analytics look flat after a deploy, check `llm_usage` has rows newer than the deploy time.

## Rollback
Render: redeploy the previous commit. Migrations are forward-only; a schema revert needs a new migration, not a redeploy.
