# Rate limits and abuse

## What is enforced today
| Where | Limit | Key | Notes |
|---|---|---|---|
| Widget chat (`warmup`, `send`, `stream`, `request-human`) and voice | 10/min, 100/hr | `X-Device-Id` + agent | Device id is client-supplied and rotatable |
| Same endpoints | 30/min, 300/hr (`MSG_IP_MINUTE_LIMIT`, `MSG_IP_HOUR_LIMIT`) | client IP + agent | The ceiling a rotating device id cannot escape. Uses `request.ip` (`trust proxy` = 1 hop) |
| Dashboard routes | none by default | | `@RateLimit()` is opt-in per route |
| Voice preview (dashboard) | 60/min | user | in-memory |
| Everything, while Redis is down | same limits, counted per API instance | | in-process fallback, see redis-down.md |

`allowedDomains` on an agent is enforced as CORS: a browser on a non-listed site cannot read responses. It does not stop curl. Agent `status = INACTIVE` stops everything.

## Symptom
LLM bill spike, one agent with abnormal volume, many `WIDGET_MESSAGE_RATE_LIMITED` rows, or a customer reports spam.

## Confirm
```sql
-- loudest agents, last hour
SELECT "agentId", count(*) AS msgs, count(DISTINCT "visitorId") AS visitors
FROM event_logs
WHERE "eventName" IN ('WIDGET_MESSAGE_RECEIVED', 'VOICE_CONVERSATION_RECEIVED')
  AND "createdAt" > now() - interval '1 hour'
GROUP BY 1 ORDER BY msgs DESC LIMIT 10;

-- cost per agent today
SELECT "agentId", round(sum(cost)::numeric, 3) AS usd, count(*) AS calls
FROM llm_usage WHERE "createdAt" > date_trunc('day', now())
GROUP BY 1 ORDER BY usd DESC LIMIT 10;

-- are limits firing
SELECT count(*) FROM event_logs
WHERE "eventName" = 'WIDGET_MESSAGE_RATE_LIMITED' AND "createdAt" > now() - interval '1 hour';
```
`visitorId` is a keyed hash of the IP (`vh_...`): one visitor with thousands of messages is one source.

## Fix, smallest blast radius first
1. **One agent under attack:** set it inactive in the dashboard (instant, all channels), or tighten its `allowedDomains` if the abuse comes from a browser on a foreign site.
2. **Rotating device ids from one IP:** lower `MSG_IP_MINUTE_LIMIT` / `MSG_IP_HOUR_LIMIT` (env, redeploy). Defaults 30/300 assume a few real visitors behind one NAT.
3. **Distributed:** block at the edge (Cloudflare WAF rate rule on `/api/klivo/v1/public/*`). The API sees nothing beyond IP.
4. **Redis is down:** limits still apply per instance (N instances = N x limit). Restore Redis for exact counting.

## Prevent
- Alert when daily `llm_usage` cost per org exceeds 3x its 7-day average (SQL above, scheduled).
- Review item A-3 (in `docs/review/develop-review-2026-09-05.md`) makes the IP key robust behind Cloudflare; decide it before launch.
