# Performance baselines

Repeatable performance measurements for the widget and the dashboard, with the baseline numbers they must be compared against. Each command runs several samples on the production build, reports median, p90, min and max, and saves the raw samples. A change that touches a measured path re-runs the matching command and compares against this file.

## Sub-features

- `perf-widget-load`: time until the launcher is visible on a host page, time to open the chat, bundle and config fetch.
- `perf-widget-reply`: time to first word and full reply time in the widget (includes the real LLM call).
- `perf-widget-leak`: JS heap, DOM nodes and event listeners after GC, before and after repeated open and close.
- `perf-page-load`: time until data-driven content is on screen (`contentReadyMs`), page vitals (TTFB, FCP, LCP, CLS, long tasks, transfer), and the latency and count of every API call the page makes.
- `perf-trace`: a Chrome performance trace of one page load, for finding the cause of a slow number.
- `perf-bundle`: the widget's gzipped bundle size against its 150 KB budget.

## How to get to it (user POV)

- These are the moments a visitor or teammate waits: the widget appearing and opening on a customer site, a reply starting, and a dashboard page becoming usable.

## Driving it with cw-verify

Preconditions:

- `cw-verify stack up --prod`. It builds the API (`nest build`, run as `node dist/main`), the dashboard (`next start`) and the widget bundle, which the host page serves. Dev-mode numbers are not the product's: each command prints a `note` when the stack is in dev mode.
- `cw-verify seed` has run, and `cw-verify doctor` reports `healthy: true` and `mode: prod`. `doctor` warns when the build is older than the code under test: run `stack down`, then `stack up --prod` again to rebuild.
- Results go to `.verify/artifacts/perf/<metric>-<timestamp>.json`, each with the commit it was built from (`builtFrom`).
- p90 is interpolated between samples. With 5 to 9 samples it sits between the two slowest, so read `max` too.

- **Widget load.** `cw-verify perf widget-load --runs 5`.
- **Reply latency.** `cw-verify perf widget-reply --runs 7`. It starts as a new visitor device so earlier runs cannot use up the rate limit. Wait a minute after other widget commands, because the per-IP limit still counts them.
- **Leak check.** `cw-verify perf widget-leak --cycles 20`, then `--cycles 60`. A leak grows in proportion to cycles; a fixed delta is one-time setup.
- **Dashboard.** `cw-verify perf page-load --url /dashboard --as owner --runs 5 --wait-text "Verify Chat Bot"`, and `--url /dashboard/inbox --wait-text "All clear"`. The wait text must need data (an agent name, the inbox empty state), not a static heading: `contentReadyMs` is the time until it appears.
- **Bundle.** `cd apps/widget && bun run check-size`.
- **Trace.** `cw-verify dashboard login --as owner --page perf`, then `cw-verify browser trace --page perf --url http://localhost:3000/dashboard --path .verify/artifacts/perf/dashboard-owner.trace.json`. Open it in Chrome DevTools > Performance.

### Baseline, 2026-09-28 (build eec2c77)

Local machine (Windows). Production builds of the API, the dashboard and the widget. Local Docker Postgres and Redis. The real `openai:gpt-4.1-mini`. Times are in ms. The raw samples are in `.verify/artifacts/perf/` on the machine that measured them.

| Metric                             | Median        | p90   | Max   | Notes                                                                          |
| ---------------------------------- | ------------- | ----- | ----- | ------------------------------------------------------------------------------ |
| Widget: launcher visible           | 218           | 272   | 278   | 5 page loads                                                                   |
| Widget: open to dialog             | 92            | 133   | 150   |                                                                                |
| Widget: config fetch               | 32            | 35    | 37    |                                                                                |
| Widget: bundle                     | 56.75 KB gzip |       |       | budget 150 KB; 196 KB uncompressed                                             |
| Widget: time to first word         | 1494          | 1828  | 1866  | 7 runs; dominated by the LLM                                                   |
| Widget: full reply                 | 2257          | 2429  | 2520  | short one-sentence replies                                                     |
| Widget: heap growth per open/close | 8 to 11 KB    |       |       | after GC; see Gotchas                                                          |
| Dashboard overview: TTFB           | 39            | 47    | 53    | owner                                                                          |
| Dashboard overview: FCP            | 252           | 292   | 300   |                                                                                |
| Dashboard overview: content ready  | 1186          | 2654  | 2908  | "Verify Chat Bot" on screen; build d2cefb9; the 2 slow runs were the first two |
| Dashboard overview: CLS            | 0.05          | 0.05  | 0.05  | largest session window                                                         |
| Dashboard overview: long tasks     | 139           | 190   | 215   | total per load                                                                 |
| Dashboard overview: transfer       | 36 KB         | 37 KB | 38 KB | warm cache                                                                     |
| Inbox: content ready               | 1065          | 1113  | 1118  | "All clear" on screen; build d2cefb9                                           |
| Inbox: CLS                         | 0             | 0     | 0     |                                                                                |

Dashboard overview API latency (median / p90 ms, local database, production API build):

| Endpoint                        | Median | p90 |
| ------------------------------- | ------ | --- |
| GET /conversations              | 318    | 488 |
| GET /analytics/agents           | 300    | 540 |
| GET /agents                     | 266    | 360 |
| GET /analytics/leads            | 235    | 302 |
| GET /analytics/handover         | 193    | 446 |
| GET /analytics/summary          | 188    | 479 |
| GET /notifications              | 121    | 215 |
| GET /notifications/unread-count | 103    | 177 |
| GET /handover/inbox             | 94     | 188 |
| GET /auth/users/me              | 36     | 39  |

Correction, 2026-09-28. The LCP figures first recorded here (1816 ms and 1528 ms) were not reliable: in later runs LCP settled on an empty 1330 px² element, most likely the sidebar logo, at about 130 ms, while the data-driven content painted after 1 s. `perf page-load` now reports `lcpElement` and `contentReadyMs`, and the content-ready rows above replace the LCP rows.

### Scale test, 2026-09-28

The baseline above runs on a few thousand rows, where every query is fast. The scale test loads production-sized data and measures the same pages.

- **Load:** `cd apps/api && bun run prisma/seed-scale.ts` (about 6 minutes). It adds 4 orgs (verify-sandbox and scale-org-1..3), 16 "Scale Agent" agents, 200,000 sessions over 90 days (50,000 per org, 3 in 4 widget, 1 in 4 WhatsApp), 2,000,000 messages and 1,000,000 metrics rows. Rows are inserted in time order, like production. Remove with `--remove`.
- **Measure:** `cw-verify perf page-load --url /dashboard --as owner --runs 5 --wait-text "Scale conversation"`. At scale, "Verify Chat Bot" is not in the top-5 lists, so it never appears.
- **Find slow SQL:** `ALTER SYSTEM SET log_min_duration_statement = 0; SELECT pg_reload_conf();` in the local container, load the page, then read `docker logs codeweaves-postgres`. Reset with `ALTER SYSTEM RESET log_min_duration_statement; SELECT pg_reload_conf();`.

Result, owner of verify-sandbox (50,000 sessions), 30-day window, production builds:

| Measure                                    | Before (message rows had no tenant key)                 | After ADR-0007                   |
| ------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| `/analytics/agents`                        | 1.9 s, or HTTP 500 (the query ran out of shared memory) | 862 ms                           |
| `/analytics/summary` slowest query         | 4.4 s under load, 615 ms alone                          | 636 ms endpoint                  |
| Message and metrics queries, one at a time | 311 to 615 ms, a full scan of every tenant's rows       | 64 to 163 ms                     |
| Channel-filtered metrics query             | 6.2 s                                                   | one column check on the same row |
| Dashboard content ready                    | not measurable (the agents card failed)                 | 1563 ms median                   |

Fixed on this branch:

- **Tenant key on message rows (ADR-0007).** `chat_messages` and `chat_message_metrics` carry the session's `agentId` and `source`. Analytics filters each table by its own `(agentId, createdAt)` index, never by joining up to the session. Before this, every dashboard query read all tenants' messages, so one client's traffic slowed every other client's dashboard.
- **Relation counts.** Prisma's `_count: { messages }` compiles to a `GROUP BY` over the whole `chat_messages` table before the join. The conversations list, the Inbox and the visitor data summary now use `countMessagesBySession` (`apps/api/src/utils/message-counts.ts`), which counts only the rows on the page. Do not use a relation `_count` on messages.
- The `messageCount` sort was removed from the conversations API. No client used it, and it cannot be served without counting every session in range.

**Open: ADR-0007 release 2.** Ship it as soon as the release-1 migration is live on develop: backfill any message and metrics rows with a null `agentId`/`source`/`role` (written by the old code during the deploy), set `NOT NULL`, replace the `chat_messages` session foreign key with `(chatSessionId, agentId, source) -> chat_sessions (id, agentId, source)`, and make the fields required in Prisma.

**Next targets at scale** (in order): `/analytics/agents` and `/analytics/summary` still aggregate 80,000 to 170,000 raw rows per window, twice (current and previous period). Under the dashboard's 10 parallel requests each query takes 200 to 540 ms. The ADR-0007 rollup option has the revisit condition for this.

### Regression rule

Re-run the matching command after a change to a measured path. A median more than 20% worse than this table (for pages, use `contentReadyMs`, not LCP), in two runs in a row, is a regression. Investigate it with the pstack `perf-issue` playbook: take a trace, name the cause, fix, then measure again with the same command. Update this table only with the numbers from an accepted change, and date it.

## Gotchas

- **Measure prod, not dev.** Next.js dev compiles pages on request and the widget in Vite dev loads unbundled modules. Those numbers mislead.
- **Local is the best case.** The local database adds almost no network time. In production each query also pays the API-to-database distance (about 186 ms per round trip from the current Render region), so dashboard API latency and LCP will be higher there.
- **Widget memory: a small, probable leak (observation, 2026-09-28).** After GC, the heap grew with the number of open and close cycles in two separate runs: +0.22 MB after 20 cycles and +0.49 MB after 60. That is 8 to 11 KB per cycle. The starting heap differed by about 0.1 MB between runs, which is the noise. Listeners stayed at 0 change. DOM nodes rose by +5 in both runs, a fixed one-time amount, so they are not leaking. A visitor who opens the widget a few times loses tens of KB, which is harmless. Something is still retained per cycle. To find it, take `browser heap` before and after 20 cycles and diff what is retained.
- **Repeated requests: investigated 2026-09-28, intentional. Do not remove.** A dashboard load fetches `/handover/inbox`, `/notifications` and `/notifications/unread-count` twice, and an inbox load fetches `/handover/inbox` about 4 times (2 filters x 2) and `/handover/enabled` twice. The second fetch is the socket catch-up on `connect` (`useHandoverRealtime`, `useNotificationRealtime`). It is a safety net: the first fetch runs before the socket joins its room, so a handover or notification pushed in that gap would otherwise be missed until the next event. A change that moved the catch-up to reconnects only removed the duplicates but opened that gap, and it did not change page speed (the duplicates run in parallel), so it was reverted. A real fix needs the server to tell a joining socket what changed since the client last fetched (for example a version counter), not a client-side skip.
- **Scale data must be in time order.** Production inserts arrive in time order, so a 30-day window is one contiguous part of the table. Data inserted in random time order spreads every window over the whole table, and Postgres then picks a full scan, which production would not. `seed-scale.ts` inserts in time order for this reason.
- **Docker's 64 MB `/dev/shm` breaks parallel queries.** Large analytics queries fail with "could not resize shared memory segment" on a default container. `docker-compose.yml` sets `shm_size: 1gb`. Recreate the container (`docker compose up -d postgres`) if you see that error.
- **LLM latency varies by hour and provider load.** Compare reply latency only against runs made the same way, and prefer several runs over one.
- The host page serves the widget bundle uncompressed, so `bundleKB` in `perf widget-load` is the raw size. Use `bun run check-size` for the gzip size.
- `perf widget-reply` allows at most 9 runs a minute because of the per-device rate limit.
