# ADR-0013: External monitoring and alerting

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Dhruv Khator

## Context

Today nobody is told when something breaks. We find out when a customer complains.

- Six cron jobs run from an external scheduler: classifier, data extraction, handover sweep, retention, FX rate, and now the alert job. When the scheduler stops, or the secret is rotated on one side only, the jobs stop with no signal. The runbook's "Prevent" step for cron jobs is a SQL query that somebody has to remember to run.
- The usage ledger (ADR-0012) records the cost of every provider call, and calls with no price are stored with `cost = null`. Nothing watches for a cost spike or for unpriced calls.
- `event_logs` records every third-party call with its success flag. Nothing watches the error rate.
- Sentry is not set up on develop. It comes at the production launch, so we cannot depend on it here.
- An alert that runs inside the API cannot fire when the API itself is down, or when the scheduler that calls it stops.
- Budget: as close to free as possible. One person (Dhruv) is on call, from a phone.

Facts we decided on:

| Tool         | Free plan                                                                            | Notes                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Stack | 10 monitors at 3-minute checks, 10 heartbeats, 1 status page, Slack and email alerts | The pricing page calls the free tier "for personal projects". Confirm before production. A paid responder seat is about $29 to $34 a month. |
| UptimeRobot  | 50 monitors at 5-minute checks                                                       | Its commercial-use terms changed during 2025 and 2026.                                                                                      |
| Slack        | 90 days of visible history, 10 apps or integrations                                  | The Slack phone app delivers push notifications.                                                                                            |

## The four questions

- **Blast radius:** if monitoring is wrong, we miss an outage or get noise. No customer-facing path depends on it. Every piece is env-gated and fail-open: a Slack or Better Stack failure never fails a request or a cron job.
- **One-way or two-way door:** two-way. Better Stack is configured in its own dashboard; our code only GETs a URL per job. The Slack side is one webhook URL. Moving to another vendor means changing env values.
- **Couples us to:** Better Stack's heartbeat URL format (a GET to a secret URL, a pattern every heartbeat vendor shares) and Slack incoming webhooks (JSON with `text` and `blocks`). Free-plan terms of both vendors.
- **Cost of waiting:** every day without alerts is a day an outage, a stopped cron job or a cost spike can run unnoticed.

## Decision

Two layers, split by what can see what.

**1. Outside our infrastructure: Better Stack (free plan).** It alerts even when the API is down.

- Uptime monitors on API `GET /health/ready`, the dashboard URL, the widget script URL and the widget config endpoint.
- One heartbeat per cron job. The API GETs the job's heartbeat URL after the job **succeeds** (`HEARTBEAT_URL_<JOB>`). For jobs that run in the background (classifier, data extraction), the ping is sent when the run finishes, not when the HTTP trigger is accepted. Better Stack alerts when a ping is late. This covers "the scheduler stopped" and "the API is down" in one mechanism.
- Better Stack sends its alerts to Slack.

**2. Inside the API: our own alert job.** `POST /internal/alerts/run`, every 15 minutes, same auth as the other cron endpoints. It checks what only our database knows:

| Check                       | Fires when                                                                                                                                                                                                      | Default                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Provider error rate         | Failed OUTBOUND calls per provider in `event_logs` over 15 min above a share, with a minimum number of calls                                                                                                    | 10%, at least 20 calls                                                  |
| Daily cost per organization | Today's cost (IST day, INR via `fx_rates`) above a threshold, or above 3x the org's 7-day daily average once today passes ₹50                                                                                   | ₹1000                                                                   |
| Unpriced usage              | Any `usage_records` row with `cost IS NULL` in the last 24 h                                                                                                                                                    | one alert, top provider/models listed                                   |
| Stale cron job              | No completion event within the job's window. A job that has never run on this environment is skipped. Data extraction alerts only when conversations are overdue, because it writes no row when nothing is due. | classifier 26 h, data extraction 10 min, handover sweep 20 min, FX 26 h |

Rules that follow:

- Every alert has a key. A key fires at most once per cooldown (6 h default). A delivered alert is recorded as an `ALERT_SENT` row in `event_logs`, and that row is the cooldown store. No new table.
- An alert Slack did not accept is not recorded, so the next run retries it. At most 10 alerts go out per run.
- Each check is one aggregate query. A failing check does not stop the others. The job pings its own heartbeat only when every check ran, so a broken alert job is itself caught by Better Stack.
- Slack calls and heartbeat pings are logged as OUTBOUND provider calls (`SLACK`, `BETTER_STACK`) in `event_logs`, with the secret part of the URL removed.

**3. Delivery: one Slack channel, `#klivo-alerts`,** through one incoming webhook (`SLACK_ALERTS_WEBHOOK_URL`). Better Stack alerts and our own alerts land in the same place. The Slack phone app gives push notifications. Each message names the environment (`APP_ENV`) and links to `/dashboard/admin/status`.

## Options rejected

### UptimeRobot

**Good:** five times as many free monitors (50) as Better Stack, a long track record, and simple to set up.

**Rejected because:** as far as we know, its heartbeat (cron) monitors are a paid feature, and heartbeats are the half we need most (six cron jobs). Confirm on its pricing page if this option comes back. Its commercial-use terms changed during 2025 and 2026, which is the same uncertainty Better Stack has, without the heartbeats. Checks every 5 minutes instead of 3.

**Revisit if:** Better Stack's free plan is ruled out for commercial use and UptimeRobot's paid plan is cheaper than a Better Stack seat.

### Self-hosted Uptime Kuma

**Good:** open source (MIT), no vendor terms, unlimited monitors, push (heartbeat) monitors, and Slack notifications built in. Zero licence cost.

**Rejected because:** it has to run somewhere. On our own infrastructure it shares the failure it is supposed to detect. On a separate host it is one more server to patch, back up and monitor, and nobody watches the watcher. For one on-call person the hosting work costs more than a seat.

**Revisit if:** we already run a second, independent host for other reasons.

### Grafana Cloud alerting reading Postgres

**Good:** one tool for dashboards and alerts, a generous free tier, real alert rules with history, and SQL alert queries that could replace our alert job entirely.

**Rejected because:** it needs a database user with network access from Grafana Cloud into Supabase, which widens the database's attack surface (we are closing the Data API, not opening new paths). The alert logic would live in a vendor UI instead of tested code in the repo. More setup than the problem needs today.

**Revisit if:** we adopt Grafana for metrics anyway, or the alert rules outgrow a small service.

### Sentry only

**Good:** we are adopting it at the production launch anyway. It has alert rules, cron monitors and Slack integration in one product.

**Rejected because:** it is not set up on develop and the launch date is open. Its cron monitors and uptime checks are limited on the free plan. It does not know our cost or price data, so the cost and unpriced checks would still need our own job.

**Revisit if:** at the production launch, Sentry's cron monitors can replace the Better Stack heartbeats on the plan we buy.

### Telegram bot for alerts

**Good:** free, no seat limits, a reliable push on every phone, and a simple bot HTTP API.

**Rejected because:** Better Stack sends to Slack natively, so Telegram would mean two channels or a relay. Slack threads let a second person pick up an alert later. A bot token and chat id are two more secrets for the same job.

**Revisit if:** we stop using Slack.

## Consequences

- Better: a stopped scheduler, a dead API, a provider outage, a cost spike and an unpriced model each reach a phone within about 15 minutes.
- Better: no new table and no new dependency in the API. Each piece is off until its env var is set.
- Worse: the Better Stack free plan is described as "for personal projects". **Confirm before production.** If it is not allowed, the fallback is a paid responder seat (about $29 to $34 a month) or the UptimeRobot revisit above.
- Worse: the in-API alert job cannot alert when the API is down or its scheduler stops. Better Stack's uptime monitors and the `HEARTBEAT_URL_ALERTS` heartbeat cover that. Both layers are needed.
- Worse: the cooldown store is `event_logs`. With `EVENT_LOG_ENABLED=false`, the cooldown falls back to the instance's memory, so a restart can repeat an alert.
- Worse: Slack free keeps 90 days of visible history. Alert history beyond that lives in `event_logs` (`ALERT_SENT` rows).
- New work: create the Slack channel and webhook, the Better Stack monitors and heartbeats, and set the env vars per environment (docs/runbooks/alerts.md). Add the alert job to the scheduler every 15 minutes.
- To remember: thresholds are guesses until we have a month of real cost data. Dhruv sets the production values.

## Open questions

| Question                                                                              | Who decides                        |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| May the Better Stack free plan be used for a commercial product, or do we buy a seat? | Dhruv, before production           |
| Production thresholds for daily cost per organization and provider error rate         | Dhruv, after a month of usage data |
