# ADR-0007: Tenant key on message rows

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Dhruv (founder), Claude (implementation)

## Context

Every dashboard and analytics query is scoped to a set of agents (`agentId = ANY(...)`, one org's agents, or every agent for a platform user), and optionally to channels (`source`). The agent and the channel are stored only on `chat_sessions`. So every query over `chat_messages` or `chat_message_metrics` filters those tables by time, across **all tenants**, and then joins up through the session to reach the agent and the channel.

We loaded production-sized data into the local database (`apps/api/prisma/seed-scale.ts`): 4 orgs, 200,000 sessions over 90 days, 2,000,000 messages, 1,000,000 metrics rows. That is 50,000 sessions per org, about 550 a day, a plausible busy client. One org owner then opened the dashboard. Measured in Postgres, one query at a time, 30-day window:

| Query                                     | Joining up to the session | Keys on the row |
| ----------------------------------------- | ------------------------- | --------------- |
| couldn't-answer rate                      | 615 ms                    | 64 ms           |
| response-time percentiles                 | ~600 ms                   | 86 ms           |
| messages sent and received                | 311 ms                    | 163 ms          |
| metrics with a channel filter (all match) | 6,244 ms                  | see below       |

The join plans are sequential scans of all 2M messages and all 1M metrics rows. The dashboard fires about ten of these at once, and under that contention each one took 2 to 4.4 seconds, and `/analytics/agents` failed outright. The cost grows with the **whole platform's** traffic: a small client's dashboard gets slower every time a big client gets busier. That is a tenancy problem as well as a speed problem.

`chat_message_metrics` already copies the message's `createdAt` "so analytics can time-scope without a second join". It stopped short. It has the time but not the tenant or the channel.

## The four questions

- **Blast radius:** every message write path (widget, voice, WhatsApp, human replies, system lines) and every analytics query. A wrong `agentId` on a message would count one tenant's data in another tenant's dashboard. The composite foreign key below makes that impossible, not just unlikely.
- **One-way or two-way door:** mostly two-way. The columns can be dropped and the old joins restored. The backfill is cheap now, while the tables are small (develop: 65,000 messages, 15 seconds). It gets slower every month we wait.
- **Couples us to:** a data shape only. Plain portable Postgres: columns, a composite foreign key and b-tree indexes. No triggers, no extensions, no RLS.
- **Cost of waiting:** the backfill grows with the data, and the per-query cost grows with every tenant's traffic. The first large client makes every other client's dashboard slow.

## Decision

The session's agent and channel are copied onto each message row, and onto its metrics row. Both are set when the session is created and never change. The copied channel is named `sessionSource`, not `source`, so SQL that joins a session to its messages can keep using an unqualified `"source"`. The analytics code running during the deploy does exactly that.

| Table                  | Change                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat_sessions`        | `UNIQUE (id, agentId, source)`, so messages can reference the triple. Index `(agentId, createdAt)` replaces `(agentId)`.                                                       |
| `chat_messages`        | `agentId` and `sessionSource`. The session foreign key becomes `(chatSessionId, agentId, sessionSource) -> chat_sessions (id, agentId, source)`. Index `(agentId, createdAt)`. |
| `chat_message_metrics` | `agentId`, `sessionSource` and `role`, copied from the message. Index `(agentId, createdAt)`.                                                                                  |

Rules that follow:

1. **The database proves the copies are right** (from release 2, see Rollout). A message's `(chatSessionId, agentId, sessionSource)` must match a real session. A writer that passes the wrong agent gets a foreign-key error, not a silent cross-tenant row. `ON UPDATE CASCADE` keeps them equal if a session ever changes.
2. **The compiler finds every writer** (from release 2). The columns are required fields, so any `chatMessage.create` that omits one fails type-checking. In release 1 the fields are optional. The writer list was checked by compiling once against the required version: 13 message writers, all of which now take the session (`MessageSession`) and copy from it.
3. **Metrics copy from the message, never from the caller.** `MessageMetricsService.record` takes the created message row and copies `id`, `agentId`, `sessionSource`, `role` and `createdAt` from it. It is the only writer of that table.
4. **Analytics filters each table by its own columns.** Message and metrics queries never join `chat_sessions`. The channel filter is a column check on the same row. A unit test fails if a message or metrics query joins `chat_sessions` again.
5. **Messages are counted by the time they were sent.** The per-agent table (`/analytics/agents`) now counts messages, questions and latency by message time, the same time rule as the summary cards. Before, it counted every message of the sessions that started in the window, including messages sent after the window ended. Two differences from the summary stay as they were: an agent is listed only when a conversation started in the window, and its message count includes every role (system lines and human replies too), where the summary counts visitor and assistant messages only.

### Rollout: two releases

The deploy applies migrations first and then starts the new code, and migrations must stay compatible with the code already running (`docs/runbooks/deploys-and-shutdown.md`). The old code inserts messages without the new columns. So `NOT NULL` in the same release would make every message insert fail for the few minutes until the new code is live.

| Release         | Migration                                                                                                                                        | Code                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1. Expand (now) | Add the columns as nullable. Backfill every row. Add `UNIQUE (id, agentId, source)` on sessions and the new indexes. Drop the unused indexes.    | Every writer sets the new columns. Analytics reads them.                                        |
| 2. Contract     | Backfill the rows the old code wrote during the release 1 deploy window. Set `NOT NULL`. Replace the session foreign key with the composite one. | The columns become required fields in Prisma, so the compiler checks every writer from then on. |

Between the two releases, a message written by the old code during the deploy window has no keys. Analytics misses it until release 2 backfills it. That is a few minutes of rows, and they come back.

Release 2 ships as soon as release 1 is live on develop. It is tracked in `.claude/skills/verify/features/performance.md`.

Indexes that no query uses after this change are dropped in the same migration, to keep the cost of each insert on the hottest table flat:

- `chat_messages (createdAt)`: every time filter now leads with the agent.
- `chat_messages (chatSessionId)`: `(chatSessionId, role)` serves the same lookups.
- `chat_message_metrics (createdAt)`: same reason as the first.

## Options rejected

### Composite indexes only, no new columns

**Good:** no schema shape change and no writer changes. `chat_sessions (agentId, createdAt)` alone does help the session-level queries, and we add it anyway.

**Rejected because:** the message and metrics queries filter by message time, and the agent is not on those rows. No index on `chat_sessions` changes the fact that the plan starts from every tenant's messages. Measured: still a full scan.

### Copy the agent only, reach the channel through the session

**Good:** one column fewer on each table, and the session foreign key stays a pair.

**Rejected because:** the channel filter still has to reach the session for every row. Measured with a filter that keeps every row: 13.8 s as an `EXISTS` through the message and the session, 6.2 s as plain joins, 0.75 s for messages alone. The channel filter is a normal analytics control, not an edge case.

### Drive every query from the org's sessions

**Good:** no schema change. Find the org's sessions by agent, then their messages through the `chatSessionId` index.

**Rejected because:** the cost is then proportional to the org's whole history (all 50,000 sessions and 500,000 messages), not to the selected window. It trades "grows with the platform" for "grows with the org forever".

### Pre-aggregated rollups (daily per-agent tables or materialized views)

**Good:** reads become O(days), which is the right end state at much larger scale.

**Rejected because:** exact percentiles and the IQR-trimmed averages cannot be summed from daily rows. They need sketches (t-digest) or raw rows. Materialized views need a refresh job and are stale between runs. Plain Postgres has no incremental refresh. It is a lot of machinery for 3 or 4 clients.

**Revisit if:** a single org's 30-day window passes a few million metrics rows, or the analytics endpoints pass about 300 ms again at p50.

### A trigger that fills the copies on insert

**Good:** no writer has to change, and raw SQL inserts are covered too.

**Rejected because:** it hides a data rule in the database where nobody reading the service code will see it. The required fields plus the composite foreign key give the same guarantee in plain view, and the compiler lists every writer.

### A read replica or a response cache

**Good:** it takes load off the primary and is on the roadmap anyway.

**Rejected because:** it does not change the cost of one query. A cached 4-second query is still 4 seconds on every cache miss, and a replica runs the same plan.

## Consequences

- Analytics and dashboard queries scale with one org's window, not with the whole platform.
- Every message insert writes a few more bytes and maintains an `(agentId, createdAt)` index. Three unused indexes are dropped, so the insert cost goes down overall.
- `chat_sessions` gets one more unique index, on `(id, agentId, source)`. It is small next to `chat_messages`.
- Every message writer passes the session. New writers must do the same. The compiler and the foreign key enforce it.
- A session's `agentId` and `source` must stay immutable. Changing either would need the cascade and a new decision.
- The per-agent analytics table can show slightly different message counts than before, near the window edges.
- The release-1 migration runs as one transaction, so `chat_messages` and `chat_message_metrics` are locked while the backfill runs. At today's size (develop: 65,000 messages) that is a few seconds. A table with millions of rows would need a batched backfill and `CREATE INDEX CONCURRENTLY` instead.
- Seeds and fixtures that insert messages must set the new columns.

## Open questions

None.
