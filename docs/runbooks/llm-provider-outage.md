# LLM provider outage or rate limiting

## Symptom
Widget shows "The assistant is temporarily unavailable. Please try again." Voice turns end with `PROVIDER_UNAVAILABLE`. Sentry fills with 502s on `/public/chat/stream`.

## Confirm
```sql
SELECT provider, "errorMessage", count(*)
FROM event_logs
WHERE "eventName" = 'LLM_COMPLETION_FAILED' AND "createdAt" > now() - interval '15 minutes'
GROUP BY 1, 2 ORDER BY 3 DESC;
```
- `429` or "rate limit" in the message: provider quota.
- `401`/`403`: key revoked or billing lapsed.
- Timeouts (`AI stream timeout`): provider degraded. Default LLM stream timeout is 60 s (`AI_STREAM_TIMEOUT_MS`); the SSE controller cuts the whole turn at 30 s.

Check the provider's status page: OpenAI, OpenRouter, Google, Groq.

## Cause
One provider is down, throttling, or the key is bad. Agents are pinned to a model via `aiConfig.modelId`, with optional `aiConfig.fallbackModels` (max 2, OpenRouter-routed cascade).

## Fix
1. **Per agent, fast:** in the agent editor set `fallbackModels` on affected agents, or switch `modelId` to a healthy provider. Takes effect on the next turn (agent config is cached 60 s).
2. **Platform-wide:** change `DEFAULT_AI_MODEL` and redeploy. Only agents without an explicit `modelId` follow it.
3. **Bad key:** rotate the provider key in Render env, redeploy. Boot does not fail on a missing key; the first call does.
4. Do not retry-storm: the widget already tells the visitor to try again. Nothing is queued.

## Prevent
- Give every production agent `fallbackModels` on a different provider than its primary.
- Watch `LLM_COMPLETION_FAILED` per hour. A Sentry alert rule on the 502 count from `/public/chat/stream` is the cheapest signal.
- Keep at least two provider keys funded.
