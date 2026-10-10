# Alerts in #klivo-alerts

Alerts come from two places (ADR-0013):

- **Better Stack**: uptime monitors and cron heartbeats. These work when the API is down.
- **Our alert job**: `POST /api/klivo/v1/internal/alerts/run`, every 15 minutes. It reads `event_logs` and `usage_records`.

Every message from our job starts with `[<environment>]` and links to `/dashboard/admin/status`. Each alert key fires at most once per `ALERT_COOLDOWN_HOURS` (default 6). A delivered alert is an `ALERT_SENT` row in `event_logs`:

```sql
SELECT "createdAt", metadata->>'alertKey' AS key, metadata->>'title' AS title
FROM event_logs
WHERE "eventName" = 'ALERT_SENT'
ORDER BY "createdAt" DESC
LIMIT 50;
```

## What each alert means, and first moves

### `<PROVIDER> error rate is N%` (key `provider-error-rate:<PROVIDER>`)

More than `ALERT_PROVIDER_ERROR_RATE` (10%) of OUTBOUND calls to one provider failed in the last 15 minutes, with at least `ALERT_PROVIDER_MIN_CALLS` (20) calls.

1. See the errors:
   ```sql
   SELECT "eventName", "errorMessage", count(*)
   FROM event_logs
   WHERE provider = '<PROVIDER>' AND direction = 'OUTBOUND' AND success = false
     AND "createdAt" > now() - interval '30 minutes'
   GROUP BY 1, 2 ORDER BY 3 DESC;
   ```
2. Check the provider's status page. 401 or 403 = key revoked or quota out. 429 = rate limit. 5xx or timeouts = provider outage.
3. LLM providers: [llm-provider-outage.md](llm-provider-outage.md). Voice: [voice-failures.md](voice-failures.md). Meta: [whatsapp-webhook.md](whatsapp-webhook.md).
4. `SLACK` or `BETTER_STACK` failing: the alert path itself is broken. Check the webhook URL and the heartbeat URLs.

### `Daily cost above threshold: <org>` (key `org-daily-cost:<orgId>`)

The organization's cost today (IST day, in INR) passed `ALERT_DAILY_ORG_COST_INR` (₹1000).

1. Open the usage page for the org and sort by agent and feature. Or:
   ```sql
   SELECT "agentId", feature, provider, model, count(*), sum(cost) AS cost, currency
   FROM usage_records
   WHERE "organizationId" = '<orgId>' AND "occurredAt" >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
   GROUP BY 1, 2, 3, 4, 7 ORDER BY 6 DESC;
   ```
2. Real traffic (a campaign, a busy day) = fine; consider raising the threshold. One agent or one session dominating = suspect abuse: [rate-limits-and-abuse.md](rate-limits-and-abuse.md).

### `Daily cost jumped: <org>` (key `org-cost-spike:<orgId>`)

Today's cost is more than 3x the organization's average day over the previous 7 days, and above ₹50.

1. Same queries as above. Compare today's model mix with last week's: a switch to a bigger model or voice turned on explains most jumps.
2. A loop or a bot hammering the widget shows as many sessions from one visitor or IP: [rate-limits-and-abuse.md](rate-limits-and-abuse.md).

### `N usage rows have no price` (key `unpriced-usage`)

Calls in the last 24 h were stored with `cost = null`: no `provider_prices` row matched the provider, model and unit. The quantities are kept, so nothing is lost.

1. The message lists the top provider/models. Usually a new model id (a provider renamed or we switched models).
2. Add the price row on the admin price list page (effective-dated). Costs for the unpriced rows can be recomputed from the stored quantities.

### `<job> has not run` (key `stale-cron:<job>`)

No completion event for that job inside its window: classifier 26 h, data extraction 10 min, handover sweep 20 min, FX rate 26 h. Data extraction alerts only when conversations are overdue. A job that has never run on this environment is not checked.

1. Follow [cron-jobs.md](cron-jobs.md): call the endpoint by hand, then check the scheduler.
2. Better Stack's heartbeat for the same job should also be late. If only our alert fired, the job runs but fails before it finishes: look for `*_FAILED` rows in `event_logs`.

### Better Stack: monitor down or heartbeat missed

- **API `/health/ready` down**: [database-connections.md](database-connections.md) for 503, [deploys-and-shutdown.md](deploys-and-shutdown.md) after a deploy.
- **Heartbeat missed for one job**: [cron-jobs.md](cron-jobs.md).
- **Heartbeats missed for every job, including ALERTS**: the scheduler (pg_cron) is down, `INTERNAL_API_SECRET` changed on one side, or the API is down.
- **Widget script or config down**: widgets on customer sites are broken. Check the CDN or the web host first, then the API.

## When the alert job itself misbehaves

- **No alerts ever**: `SLACK_ALERTS_WEBHOOK_URL` unset makes the job a no-op (`{"disabled": true}`). Call it by hand and read the summary: `{checked, alertsSent, suppressed, deferred, failedChecks}`.
- **`failedChecks` not empty**: a query failed. Render logs: `[AlertsService] [run] - alert check <name> failed`. The ALERTS heartbeat is withheld until every check passes, so Better Stack will also flag it.
- **The same alert every 15 minutes**: the cooldown store is `event_logs`. Check `EVENT_LOG_ENABLED` is not `false`.
- **Too noisy**: raise the threshold env var, or `ALERT_COOLDOWN_HOURS`. Do not delete `ALERT_SENT` rows to silence an alert; that re-arms it.

## Better Stack setup checklist

Do this once per environment that should page someone (staging optional, production required). Confirm the free plan's "for personal projects" terms first (ADR-0013).

1. Slack: create `#klivo-alerts`. Add an incoming webhook for it (Slack app "Incoming Webhooks"). Put the URL in `SLACK_ALERTS_WEBHOOK_URL` on the API. Install the Slack phone app and turn on notifications for the channel.
2. Better Stack: connect Slack under Integrations and send alerts to `#klivo-alerts`.
3. Uptime monitors (3-minute checks):
   - API: `GET https://<api>/health/ready`, expect HTTP 200.
   - Dashboard: `https://<dashboard>/`, expect HTTP 200.
   - Widget script: the `codeweaves-widget.js` URL customers embed, expect HTTP 200.
   - Widget config endpoint: `GET https://<api>/api/klivo/v1/public/agents/<publicId>/config` for a demo agent we own, expect HTTP 200.
4. Heartbeats, one per job. Set each period to the job's schedule and a grace period of about one schedule:

   | Heartbeat       | Env var on the API              | Schedule                                        |
   | --------------- | ------------------------------- | ----------------------------------------------- |
   | Classifier      | `HEARTBEAT_URL_CLASSIFIER`      | daily                                           |
   | Data extraction | `HEARTBEAT_URL_DATA_EXTRACTION` | every minute (when driven by the external cron) |
   | Handover sweep  | `HEARTBEAT_URL_HANDOVER_SWEEP`  | every 5 min                                     |
   | Retention       | `HEARTBEAT_URL_RETENTION`       | daily                                           |
   | FX rate         | `HEARTBEAT_URL_FX`              | daily                                           |
   | Alerts          | `HEARTBEAT_URL_ALERTS`          | every 15 min                                    |

5. Add `POST /api/klivo/v1/internal/alerts/run` to the scheduler every 15 minutes ([cron-jobs.md](cron-jobs.md)).
6. Test: call `/internal/alerts/run` by hand and confirm a `200` summary. Pause one heartbeat's job and confirm Better Stack posts to Slack.
