# ADR-0017: Staging environment for client security testing

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Dhruv

## Context

Anand Rathi (SEBI-regulated) asked for a walkthrough and **security testing on a UAT environment** before vendor onboarding. Banks usually repeat this every year and after major releases.

Today there are two environments (ADR-0001): **local** and **develop** (Render, Virginia, sharing nothing with local since ADR-0001). Production (ADR-0002, Cloud Run Mumbai) is not live. Neither existing environment can be handed to an external tester:

- Develop is the team's working environment. Scanners and fuzzing would fill its database with junk and break day-to-day work.
- Develop holds the team's own test data. A tester reports whatever they can read.
- Every public chat request spends real money (LLM, voice, email). An automated scan of the public endpoints against develop's keys has no spending cap.

## The four questions

- **Blast radius:** low. A broken staging environment blocks a client test, not customers.
- **One-way or two-way door:** two-way. Every piece is a free account or project that can be deleted.
- **Couples us to:** Render, Supabase, Clerk, Sentry and Vercel, which we already use. A third long-lived branch, `staging`.
- **Cost of waiting:** the client test cannot start without it.

## Decision

A third remote environment, **staging**, deployed from a `staging` branch. Code moves `develop` → `staging` → `main` by pull request.

| Piece              | Staging                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| API                | New Render account (own workspace), free plan, **Singapore**                 |
| Database + storage | New Supabase project, free plan, **Mumbai**                                  |
| Auth               | New Clerk application, production instance on `app-staging.getklivo.com`     |
| Errors             | New Sentry account                                                           |
| Dashboard + widget | Two new Vercel projects in the existing account, production branch `staging` |
| Email              | Existing Resend account and domain, separate API key                         |
| LLM keys           | Separate keys with low spending caps                                         |
| Cron               | `pg_cron` in the staging Supabase project, same jobs as develop              |
| Hostnames          | `app-staging.`, `api-staging.`, `widget-staging.getklivo.com`                |

Rules that follow:

1. **Fake data only.** No customer data, no copy of develop's database.
2. Only CI migrates the staging database (ADR-0001 rule 2). `deploy-staging.yml` migrates, seeds the bootstrap super admin, then triggers the Render deploy hook.
3. Staging changes only when a PR into `staging` merges, so a client's findings refer to a fixed version.
4. Staging hostnames are never children of the dashboard host (`*.app.getklivo.com`): a cookie scoped to a parent host is sent to its children, and testers deliberately attempt XSS on staging. The dashboard host must also equal the Clerk production instance's domain (or sit under it): Clerk rejects sign-in from any other origin, so changing the dashboard host means changing the Clerk domain too.
5. Keys used during a client test are rotated or revoked when it ends.

Setup steps: `docs/runbooks/environment-setup.md`.

## Options rejected

### Let the client test develop

**Good:** zero setup, available today, and it is the most recent code.

**Rejected because:** see Context. It mixes the team's data with the tester's, has no spending cap, and changes under the tester with every merge.

### Staging on Cloud Run in Mumbai, scaled to zero

**Good:** same region and platform as planned production, so it would also exercise the production deploy path. Request-based billing keeps it inside Google's monthly free tier.

**Rejected because:** request-based billing throttles CPU after a response is sent. The API depends on work that continues after the response: fire-and-forget `event_logs` writes (a project rule, so logging never adds latency) and the classifier and data-extraction cron endpoints, which acknowledge at once because the scheduler's HTTP call times out after 5 seconds. Those would stall. Fixing it means awaiting logs (slower replies) or redesigning the jobs, which is not worth doing for a test environment.

**Revisit if:** the background work moves to a real job runner, or production moves to request-based billing for its own reasons.

### Test production before launch, then reset it

**Good:** one environment instead of two, and the test covers the exact production setup.

**Rejected because:** after a pentest the database, storage and Clerk user list are full of fuzzing junk, and the next client test needs an environment again anyway. Production should start clean.

### Staging in the same Render workspace as develop

**Good:** one account, one dashboard.

**Rejected because:** Render's 750 free instance hours are per workspace. Develop is kept awake around the clock by its cron jobs (about 720 hours a month), so a second always-awake service would exhaust the pool and suspend both.

## Consequences

- Better: client tests run against an isolated, capped, fixed-version environment, and the same setup serves the next client.
- Better: the region is closer than develop's (Singapore to Mumbai, roughly 60 to 75 ms per database call, versus 186 ms from Virginia).
- Worse: findings about hosting (TLS, edge headers) describe Render, not the planned production on Cloud Run. App-level findings carry over unchanged.
- Worse: a third long-lived branch to keep in step, and five more accounts or projects to own.
- Worse: Resend's free daily limit is shared with develop. A burst of invitations during a test can stop develop email for the day.
- New work: `deploy-staging.yml`, CI on `staging`, the setup runbook, and staging cron jobs.

## Open questions

- Whether a Clerk production instance on `app-staging.getklivo.com` coexists cleanly with the develop and production Clerk instances on the same root domain. Checked by the smoke test in the runbook (sign in to both in one browser).
