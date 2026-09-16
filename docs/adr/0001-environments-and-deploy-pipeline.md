# ADR-0001: Environments and deploy pipeline

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** Dhruv

> **Correction, 2026-09-16 (same day, before anyone acted on it).** This ADR
> originally called the Render environment "staging". It is **develop**, named
> after the branch that deploys to it. The names are now consistent throughout.
> The decision itself is unchanged.
>
> This matters because `docs/security/security-readiness-tracker.md` uses
> "staging" for something else: a prod-like environment for a paid penetration
> test, which **does not exist**. Three environments exist or are planned here:
> **local** (this laptop), **develop** (Render), and **production** (not built
> yet, see ADR-0002). A separate prod-like staging environment may follow later
> and would get its own ADR.

## Context

One Supabase project ("Klivo Dashboard", `ap-south-1`) served **both** local development and the `develop` deploy. Local `apps/api/.env` pointed straight at it. The Postgres service in `docker-compose.yml` was commented out.

Consequences already observed:

- Feature branches ran `prisma migrate dev` against the shared database. By 2026-09-06 it held six tables, two enum types and one extra enum value that `develop` did not know about, left by the RAG, integrations and workflow-engine branches. The next merge of any of those branches would have failed on `CREATE TABLE ... already exists`. Cleaned on 2026-09-06 after founder approval.
- Nothing runs `prisma migrate deploy`. Every schema change reached the remote database by a human running a command from a laptop.
- Render (API) and Vercel (web, widget) auto-deploy on merge to `develop`. So **code deploys automatically but the schema it depends on does not.** A merge could put code in front of a schema that was not there yet.

Production is not live. This is the cheapest moment this decision will ever be made.

## The four questions

- **Blast radius:** every tenant, once production exists. A bad migration against a shared database is not recoverable by redeploying.
- **One-way or two-way door:** mostly two-way. Environments and CI steps can be rearranged later. The habit it creates is the sticky part.
- **Couples us to:** GitHub Actions as the only path to a remote schema. Docker for local development.
- **Cost of waiting:** it grows. Every new feature branch adds drift, and once production exists the same mistake reaches customers instead of test data.

## Decision

Three environments. Each has its own database. Exactly one path exists for a schema change to reach a remote database.

| Environment | Database                                  | Redis            | Branch    | Who migrates it       |
| ----------- | ----------------------------------------- | ---------------- | --------- | --------------------- |
| Local       | Docker Postgres (`docker-compose.yml`)    | Docker Redis     | any       | the developer, freely |
| Develop     | existing Supabase "Klivo Dashboard"       | existing Upstash | `develop` | GitHub Actions only   |
| Production  | its own, created at launch (see ADR-0002) | its own          | `main`    | GitHub Actions only   |

Rules that follow:

1. `prisma migrate dev` runs against `localhost` only. A guard refuses to run it against any other host, so the failure is a clear message rather than a damaged shared database.
2. **No human runs a migration against a remote database.** No exceptions, including "just this once, it is only develop".
3. On merge to `develop`: CI passes, then `prisma migrate deploy` against develop, then the API deploy is triggered, then `/health/ready` is checked. `main` follows the same shape against production.
4. Render's own auto-deploy is turned **off**. The workflow triggers the deploy hook after the migration succeeds, so code never runs ahead of its schema.
5. A feature branch that changes the schema is tested against local Docker only. Its migration reaches develop when the pull request merges, and not before.

## Options rejected

### Keep sharing one database across local and develop

**Good:** zero setup cost. One source of truth for test data, so a bug seen locally is reproducible with the same rows. No Docker requirement for a new contributor.

**Rejected because:** this is exactly what produced the drift above. Once production exists, the same habit puts an unreviewed local migration one command away from customer data.

### Supabase branching (a database branch per pull request)

**Good:** real Postgres per pull request with no Docker. Seeded from the parent. Merges and resets are managed by the platform, so the workflow is closer to Git than Docker is.

**Rejected because:** it is a paid feature, and it ties the daily development loop to Supabase specifically, which conflicts with keeping the Postgres vendor replaceable.

**Revisit if:** we move to Supabase Pro anyway for backups (see ADR-0002). Then the marginal cost is much lower.

### Run migrations on API boot

**Good:** simplest possible pipeline. No database URL in CI secrets. Schema and code can never be out of step, because the process that needs the schema applies it.

**Rejected because:** several instances racing the same migration is a real failure mode on Cloud Run, where instances scale automatically. A failed migration then takes the whole service down instead of failing one deploy.

## Consequences

- Local setup gains a step: `docker compose up` before `bun dev`. A one-command seed script covers the "I need data" gap.
- CI needs the develop and production database URLs as GitHub secrets. That is one more place a database credential exists.
- Deploys get slower by the duration of the migration. That is the point, not a regression.
- Local test data stops being shared between developers. The seed script is the answer, not a shared database.
- Someone must remember to turn Render's auto-deploy off. Until that happens the pipeline is decorative, because Render will still deploy on its own.

## Open questions

None. The implementation work is tracked separately.
