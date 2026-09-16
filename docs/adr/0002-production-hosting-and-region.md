# ADR-0002: Production hosting and region

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** Dhruv

## Context

Production is not live yet. Today's `develop` deployment was measured on 2026-09-16 against `api.getklivo.com`.

**What the measurement shows.** `GET /health/ready` reports each dependency probe from inside the API process:

```
{"status":"ok","checks":{"db":{"state":"ok","latencyMs":186},
                         "redis":{"state":"ok","latencyMs":186}}}
```

Eight consecutive samples: 186, 186, 186, 186, 186, 186, 186, 187 ms. The first call after an idle period was 936 ms (cold connection).

Response headers: `Server: cloudflare`, `CF-RAY: ...-BOM`, `x-render-origin-server: Render`.

**How to read that.** Cloudflare terminates in Mumbai, which is why the browser-side connection feels fast. The origin is Render. From that origin, **both** Supabase (`ap-south-1`, Mumbai) and Upstash are 186 ms away. Two independent services showing the same figure is what a single long network hop looks like: the API is one fixed distance from an Indian region, not close to it. Render's free tier has no Indian region. The origin was later confirmed by the founder as Virginia, which matches the measured figure (US East to Mumbai is roughly 180 ms).

**Why 186 ms matters more than it looks.** One chat turn makes roughly three sequential rounds of database and Redis calls before the LLM request is even sent: resolve the agent, then the session and full agent record, then knowledge plus conversation context plus the PII token map. That is about **550 ms of pure geography per message**, before any AI work starts.

The codebase already shows the scars of this. Comments in the chat path cite "saves ~300-400 ms on cache miss", "saves one Supabase round-trip (~250-450 ms)" and "typically 150-400 ms depending on region". Several optimisations exist only to run these calls in parallel instead of in series. They are working around distance.

Users are in India. The API also depends on **Supabase Storage** for agent assets and knowledge uploads, so replacing Postgres alone would not remove the Supabase dependency.

## The four questions

- **Blast radius:** every request from every tenant. Latency is felt by every visitor on every message.
- **One-way or two-way door:** moving compute is a two-way door and cheap. Moving the database once it holds customer data is a one-way door in practice, because it needs a migration window.
- **Couples us to:** Google Cloud for compute, and whichever database vendor we pick for the life of the data.
- **Cost of waiting:** low today, because production is empty. High after launch, because the database becomes hard to move.

## Decision

| Component           | Choice                                                    | Region                 |
| ------------------- | --------------------------------------------------------- | ---------------------- |
| Production API      | Google Cloud Run                                          | `asia-south1` (Mumbai) |
| Production database | new Supabase project, **Pro** plan                        | `ap-south-1` (Mumbai)  |
| Production Redis    | Upstash                                                   | nearest Indian region  |
| Production storage  | Supabase Storage (same project)                           | with the database      |
| Develop             | unchanged: Render free plus the existing Supabase project | as-is                  |

The API sits next to its database. Expected effect: the ~550 ms of per-turn geography falls to roughly 10 to 15 ms.

The develop environment keeps a different latency profile from production on purpose, because it is free. Latency conclusions from develop are therefore treated as an upper bound, not a prediction.

## Options rejected

### Cloud SQL for PostgreSQL instead of Supabase

**Good:** same cloud and region as Cloud Run, so the database hop is sub-millisecond, better than any cross-vendor option. Google-managed backups, point-in-time recovery, and IAM that fits the rest of GCP. One vendor for compute and data, one bill, one support channel.

**Rejected because:** the application uses Supabase for **Storage** as well as Postgres, through the service-role client in `supabase-storage.service.ts` and four other files. Moving only Postgres keeps the Supabase dependency and adds a second vendor rather than replacing one. The migration work is real and buys latency we mostly get anyway by being in the same region.

**Revisit if:** file storage is moved to Google Cloud Storage. Then Supabase has no remaining job and Cloud SQL becomes the simpler answer.

### Keep production on Render

**Good:** free today, already works, one platform to learn, and deploys are already wired to branches. No Dockerfile needed.

**Rejected because:** Render's free tier offers no Indian region, so the 186 ms stays. The free tier also has no database backups, which is the single largest unmitigated risk before launch and is already flagged in the vendor assessment.

### Move the database to the API instead of the API to the database

**Good:** no change to hosting, and the 186 ms disappears just as effectively.

**Rejected because:** users are in India. Moving the database away from them adds latency to every request that reaches the origin, and puts Indian customer data outside India, which is a DPDP conversation we do not need to have.

## Consequences

- Infrastructure cost goes from zero to roughly **$25 per month** (Supabase Pro) plus Cloud Run usage, which at this traffic is small and scales to zero.
- Cloud Run needs a container, so a `Dockerfile` for `apps/api` becomes required work.
- Backups arrive with Supabase Pro. That closes the largest pre-launch risk and the vendor-assessment gap in one step. A **restore must be tested**, not assumed.
- Two hosting platforms to understand: Render for develop, Cloud Run for production. Accepted, because develop stays free and disposable.
- Load-test numbers from develop will not predict production for anything database-bound. Any capacity conclusion about the chat path has to be re-checked on production-like infrastructure.
- Several parallelism optimisations in the chat path become unnecessary once the database is close. They are not harmful and do not need removing, but future work should not add more of them for latency reasons alone.

## Open questions

- Upstash region for production Redis. Lower impact than the database, same reasoning.

## Decision log

- **2026-09-16:** Supabase Pro confirmed by the founder, to be provisioned at launch. Cloud SQL is not pursued, for the reason in "Options rejected": the application still needs Supabase Storage, so moving only Postgres would add a vendor rather than replace one.
