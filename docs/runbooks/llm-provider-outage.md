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
- `UNSUPPORTED_MODEL_PROVIDER`: an agent's `aiConfig.modelId` uses a provider we no longer support (ADR-0011). Set it to an `openai:`, `gemini:` or `sarvam:` model.

Check the provider's status page: OpenAI, Google (Gemini), Sarvam.

## Cause

One provider is down, throttling, or the key is bad. Each agent is pinned to one model via `aiConfig.modelId`. There is no automatic cross-provider fallback (ADR-0011).

## Fix

1. **Per agent, fast:** in the agent editor, switch the model to a healthy provider (for example from `openai:gpt-4.1-mini` to `gemini:gemini-2.5-flash`). Takes effect on the next turn (agent config is cached 60 s).
2. **Platform-wide:** change `DEFAULT_AI_MODEL` and redeploy. Only agents without an explicit `modelId` follow it.
3. **Bad key:** rotate the provider key in the host's env, redeploy. Boot does not fail on a missing key; the first call does.
4. Do not retry-storm: the widget already tells the visitor to try again. Nothing is queued.

## Prevent

- Watch `LLM_COMPLETION_FAILED` per hour. A Sentry alert rule on the 502 count from `/public/chat/stream` is the cheapest signal.
- Keep at least two provider keys funded (OpenAI and Gemini), so agents can be switched fast.
