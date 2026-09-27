# Performance baselines

Repeatable performance measurements for the widget and the dashboard, with the baseline numbers they must be compared against. Each command runs several samples on the production build, reports median, p90, min and max, and saves the raw samples. A change that touches a measured path re-runs the matching command and compares against this file.

## Sub-features

- `perf-widget-load`: time until the launcher is visible on a host page, time to open the chat, bundle and config fetch.
- `perf-widget-reply`: time to first word and full reply time in the widget (includes the real LLM call).
- `perf-widget-leak`: JS heap, DOM nodes and event listeners after GC, before and after repeated open and close.
- `perf-page-load`: dashboard page vitals (TTFB, FCP, LCP, CLS, long tasks, transfer) and the latency of every API call the page makes.
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
- **Dashboard.** `cw-verify perf page-load --url /dashboard --as owner --runs 5 --wait-text "Your agents"`, and `--url /dashboard/inbox --wait-text "Needs you"`.
- **Bundle.** `cd apps/widget && bun run check-size`.
- **Trace.** `cw-verify dashboard login --as owner --page perf`, then `cw-verify browser trace --page perf --url http://localhost:3000/dashboard --path .verify/artifacts/perf/dashboard-owner.trace.json`. Open it in Chrome DevTools > Performance.

### Baseline, 2026-09-28 (build eec2c77)

Local machine (Windows). Production builds of the API, the dashboard and the widget. Local Docker Postgres and Redis. The real `openai:gpt-4.1-mini`. Times are in ms. The raw samples are in `.verify/artifacts/perf/` on the machine that measured them.

| Metric                             | Median        | p90   | Max   | Notes                              |
| ---------------------------------- | ------------- | ----- | ----- | ---------------------------------- |
| Widget: launcher visible           | 218           | 272   | 278   | 5 page loads                       |
| Widget: open to dialog             | 92            | 133   | 150   |                                    |
| Widget: config fetch               | 32            | 35    | 37    |                                    |
| Widget: bundle                     | 56.75 KB gzip |       |       | budget 150 KB; 196 KB uncompressed |
| Widget: time to first word         | 1494          | 1828  | 1866  | 7 runs; dominated by the LLM       |
| Widget: full reply                 | 2257          | 2429  | 2520  | short one-sentence replies         |
| Widget: heap growth per open/close | 8 to 11 KB    |       |       | after GC; see Gotchas              |
| Dashboard overview: TTFB           | 39            | 47    | 53    | owner                              |
| Dashboard overview: FCP            | 252           | 292   | 300   |                                    |
| Dashboard overview: LCP            | 1816          | 1942  | 2016  | waits on the data calls below      |
| Dashboard overview: CLS            | 0.05          | 0.05  | 0.05  | largest session window             |
| Dashboard overview: long tasks     | 139           | 190   | 215   | total per load                     |
| Dashboard overview: transfer       | 36 KB         | 37 KB | 38 KB | warm cache                         |
| Inbox: LCP                         | 1528          | 1557  | 1568  | owner                              |
| Inbox: CLS                         | 0             | 0     | 0     |                                    |

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

### Regression rule

Re-run the matching command after a change to a measured path. A median more than 20% worse than this table, in two runs in a row, is a regression. Investigate it with the pstack `perf-issue` playbook: take a trace, name the cause, fix, then measure again with the same command. Update this table only with the numbers from an accepted change, and date it.

## Gotchas

- **Measure prod, not dev.** Next.js dev compiles pages on request and the widget in Vite dev loads unbundled modules. Those numbers mislead.
- **Local is the best case.** The local database adds almost no network time. In production each query also pays the API-to-database distance (about 186 ms per round trip from the current Render region), so dashboard API latency and LCP will be higher there.
- **Widget memory: a small, probable leak (observation, 2026-09-28).** After GC, the heap grew with the number of open and close cycles in two separate runs: +0.22 MB after 20 cycles and +0.49 MB after 60. That is 8 to 11 KB per cycle. The starting heap differed by about 0.1 MB between runs, which is the noise. Listeners stayed at 0 change. DOM nodes rose by +5 in both runs, a fixed one-time amount, so they are not leaking. A visitor who opens the widget a few times loses tens of KB, which is harmless. Something is still retained per cycle. To find it, take `browser heap` before and after 20 cycles and diff what is retained.
- **Repeated requests (observation, 2026-09-28).** A dashboard overview load calls `GET /handover/inbox` twice and the notifications endpoints about twice. An inbox load calls `GET /handover/inbox` about four times. Several components fetch the same data. This is a batching or caching candidate, not yet investigated.
- **LLM latency varies by hour and provider load.** Compare reply latency only against runs made the same way, and prefer several runs over one.
- The host page serves the widget bundle uncompressed, so `bundleKB` in `perf widget-load` is the raw size. Use `bun run check-size` for the gzip size.
- `perf widget-reply` allows at most 9 runs a minute because of the per-device rate limit.
