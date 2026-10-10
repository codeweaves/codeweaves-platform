# Usage cost metering and ops console: plan

- **Status:** Draft, for review
- **Date:** 2026-10-10
- **Decisions:** [ADR-0011](../adr/0011-llm-provider-set.md) (LLM providers), [ADR-0012](../adr/0012-usage-ledger-and-price-list.md) (usage ledger and price list)

## Goal

1. Know the real cost of every provider call: the cost per conversation, agent, organization, channel, provider and model, with a line-by-line breakdown and the total in INR. These numbers feed the pricing model.
2. Give platform staff a super admin console: usage and cost, audit log, event log, and job status.
3. Get alerted on a phone when something breaks, even when our API is down.

## What is true today

Sources: the code on develop (f1a1339) and provider docs, all retrieved 2026-10-10. The research notes, with a source URL beside each price and rule, are in [docs/research/provider-costs/](../research/provider-costs/README.md).

**LLM cost is missing or wrong**

- `llm_usage.cost` is filled only for OpenRouter calls. Direct OpenAI and Gemini calls store `null`. There is no price list.
- `LlmService` reads `result.usage`, which covers only the last step (`llm.service.ts:151`). A turn that calls a tool makes 2 to 3 billed calls, but only the last one is counted.
- The classifier and data extraction call OpenAI with raw `fetch` and ignore the `usage` in the response. Their cost is not recorded anywhere.
- The Groq provider drops cached tokens. Cerebras and Sarvam are created without `includeUsage`. Streams the visitor aborts end before the usage event. All of these are recorded as $0.
- Warmup (`POST /public/chat/warmup`) makes one full LLM call with the whole system prompt and knowledge base on every widget load. Its usage row is written, but its cost is null.
- `UsageTrackingService` drops rows when its buffer is full and loses a batch when the flush fails.

**Voice quantities are missing**

- Deepgram returns `metadata.duration` and ElevenLabs STT returns `audio_duration_secs`. We read neither.
- The ElevenLabs TTS HTTP response has a `character-cost` header. We don't read it.
- Sarvam returns no duration and no character count.
- Every voice turn calls Sarvam STT first, to detect the language. For a non-Indian language, Deepgram then transcribes the same audio again. If Deepgram fails, ElevenLabs runs a third time.
- Voice previews in the agent editor bill under `agentId "__preview__"`, so no organization carries the cost.

**Messaging**

- WhatsApp is billed by Meta to the client's own WhatsApp Business Account, not to us. Since 2026-10-01 the first 1,000 service replies a month are free, then INR 0.115 each in India. Status webhooks carry `pricing { billable, category }`, but `whatsapp-webhook.controller.ts:191` discards every status change.
- Resend bills per recipient. One handover email to 5 members is 5 billable emails.
- Clerk, Upstash and Supabase are plan- or volume-based. We treat them as platform overhead, not per-event costs.

**Broken or retiring models**

- Groq shut down `llama-3.3-70b-versatile` (the summary default, `summarization.service.ts:16`) and `qwen/qwen3-32b` (in the picker) for non-enterprise accounts.
- Sarvam marks `saarika:v2.5` "will be deprecated soon" and recommends `saaras:v3` with `mode="transcribe"`. The REST endpoint accepts audio up to 30 s.

**Visibility**

- `audit_logs` and `event_logs` are written everywhere, but no endpoint or page reads them.
- There is no uptime monitor and no alerting. Two of the five cron jobs record no run.

## Decisions

| Topic              | Decision                                                                                                                                                                | Record      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| LLM providers      | Keep OpenAI, Gemini and Sarvam. Remove Groq, Cerebras and OpenRouter. Claude comes later through `@ai-sdk/anthropic`.                                                   | ADR-0011    |
| Cost source        | We compute every cost ourselves: the provider's usage counts × our price list. We don't use a provider-reported cost.                                                   | ADR-0012    |
| Storage            | One `usage_records` row per billable provider call, with typed quantity columns. Prices go in a versioned `provider_prices` table.                                      | ADR-0012    |
| Currency           | Each price and cost stays in the provider's currency (USD or INR). Reports convert to INR at query time, using the stored daily rate in `fx_rates`.                     | ADR-0012    |
| Prices now         | Every provider is on a free trial, so we seed public pay-as-you-go list prices with source URLs. When a real plan starts, add a new price row with that effective date. | ADR-0012    |
| WhatsApp           | Recorded as pass-through (`billedTo = CLIENT`), shown apart from our own cost.                                                                                          | ADR-0012    |
| Voice previews     | Recorded with no organization, as platform cost, for visibility only.                                                                                                   | Plan        |
| Outside monitoring | Better Stack for uptime checks and cron heartbeats, plus a Slack channel for phone alerts. Written as its own ADR in PR 5.                                              | ADR in PR 5 |

## Price formulas

All token prices are per 1M tokens. `in`, `cached` and `out` are the list prices.

| Provider                            | Formula                                                                                                                                 | Quantity source                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| OpenAI (gpt-4.1, 4.1-mini, 4o-mini) | `(input − cached) × in + cached × cached + output × out`. Reasoning tokens are already inside output.                                   | Response usage. Per step for tool calls.                 |
| Gemini 2.5 Flash                    | `(prompt − cachedContent) × in + cachedContent × cached + (candidates + thoughts) × out`                                                | Response usage metadata                                  |
| Sarvam LLM (INR)                    | Same shape as OpenAI                                                                                                                    | Response usage, with `includeUsage: true`                |
| Sarvam STT `saaras:v3` (INR)        | `ceil(max(seconds, 1)) × ₹30 / 3600`. Confirm the language-detection surcharge on an invoice.                                           | Measured by us (see PR 3)                                |
| Deepgram nova-3                     | `seconds × channels × $0.0043 / 60`                                                                                                     | `metadata.duration`                                      |
| ElevenLabs Scribe v2                | `seconds × $0.22 / 3600`                                                                                                                | `audio_duration_secs`                                    |
| Sarvam TTS `bulbul:v3` (INR)        | `characters × ₹0.003`                                                                                                                   | Characters of text we send                               |
| ElevenLabs TTS (USD pricing)        | `characters × $0.04 / 1000`                                                                                                             | `character-cost` header, or characters sent on WebSocket |
| Meta WhatsApp (client pays)         | `0` if failed or `billable=false`, else the rate for (category, country). The first 1,000 service messages a month per number are free. | Status webhook `pricing`                                 |
| Resend                              | Recipients × the per-email rate of the current plan. The free tier is 0.                                                                | Recipient count                                          |

Each formula is a pure function with unit tests built from the provider docs' worked examples.

## Work, in pull requests

Each PR ends green on lint, check-types, build and `test:cov`, plus `/verify` for anything user-facing.

### PR 1: provider cleanup and the Sarvam model change (ADR-0011)

1. Remove the Groq, Cerebras and OpenRouter providers, their packages and env vars. Remove `fallbackModels`, which only OpenRouter supports.
2. Model picker: OpenAI `gpt-4.1` and `gpt-4.1-mini`, Gemini `gemini-2.5-flash`, and Sarvam (verify the current model id with a test call).
3. Data migration: move every agent whose `aiConfig.modelId` uses a removed provider to `openai:gpt-4.1-mini`, and record each change in the audit log. List the affected agents in the PR.
4. Summary default becomes `openai:gpt-4.1-mini`. The `DEFAULT_AI_MODEL` fallback becomes `openai:gpt-4.1-mini` (it was OpenRouter).
5. Sarvam STT: `saarika:v2.5` becomes `saaras:v3` with `mode="transcribe"`. Test Hindi, Hinglish, Marathi and English clips first.

### PR 2: usage ledger, price list and LLM metering (ADR-0012)

1. Tables:
   - `provider_prices` (provider, model, unit, price, per-quantity, currency, effective-from, source URL)
   - `usage_records`
   - `fx_rates` (one row per day)
2. `UsageMeterService.record()`:
   - Prices the call from a cached price lookup.
   - Writes one row for each provider call.
   - Never throws into the request.
   - Never drops rows silently. A failed insert is logged and retried once.
   - A call with no matching price is stored with `cost = null`, then shown and alerted on.
3. Meter every LLM path:
   - Chat (text, voice, WhatsApp), costed per step using `steps[i].usage` and `steps[i].response.modelId`.
   - Warmup, as feature `WARMUP`.
   - Summaries, the classifier and data extraction (read `usage` from the raw `fetch` response).
4. Aborted streams: record an estimate (prompt characters / 4) with `quantitySource = ESTIMATED`.
5. Seed the list prices. Add `POST /internal/fx/run`, a daily job that fetches the USD-to-INR rate from the ECB reference rates (frankfurter.app, free, no key). Staff can also set a rate by hand.
6. Backfill `llm_usage` into `usage_records`, recomputing cost from the stored tokens. Writers move to the meter. The `llm_usage` table is dropped in a later release, after the backfill is checked.

### PR 3: voice and messaging metering

1. STT quantities:
   - Deepgram: `metadata.duration`.
   - ElevenLabs: `audio_duration_secs`.
   - Sarvam: WhatsApp voice notes are OGG/Opus, so `music-metadata` reads their duration. The widget sends its recording length, which the server clamps to 0 to 60 s, because browser WebM files often carry no duration. These rows are marked `quantitySource = MEASURED`.
2. TTS quantities: characters of text sent for Sarvam and ElevenLabs WebSocket; the `character-cost` header for ElevenLabs HTTP. A sentence that falls back to a second provider is billed twice, so it is recorded twice.
3. One STT call per turn: `saaras:v3` handles English too, so Deepgram and ElevenLabs become failover only. This removes the second STT charge on English turns. **Confirm English quality on test clips before merging.**
4. WhatsApp voice notes longer than 30 s: send them to Sarvam's batch API, or split them. Pick one after testing the `saaras:v3` limit.
5. WhatsApp: read status webhooks and write pass-through rows. The organization is resolved from `phoneNumberId`, through the channel, to the agent.
6. Resend: one row per send, with quantity = recipients. Pass the organization in.
7. Voice previews: recorded with no organization, feature `VOICE_PREVIEW`.

Changes from this plan, made while building PR 3:

- OGG duration comes from a small parser of our own (last page granule / 48 kHz, minus the Opus pre-skip), not `music-metadata`. WAV is read from its header. That avoids a new dependency for about 60 lines of code.
- When nothing can be measured (no container duration and no widget length), the row is stored with `quantitySource = ESTIMATED`, from bytes at an assumed 64 kbps.
- STT failover: when Sarvam throws, Deepgram and then ElevenLabs get the caller's language hint, or else the agent's default language.
- WhatsApp rows for recipients outside India use the model `<category>:intl`. The price list holds India rates only, so these rows stay unpriced and flagged instead of priced at the wrong rate.
- Meta only marks a message `billable` after the monthly free tier, so free messages are never recorded. Utility and authentication volume tiers are not applied.
- Item 4 (WhatsApp voice notes longer than 30 s) is not done. It still needs a test of the `saaras:v3` length limit.

### PR 4: super admin console (platform roles only)

1. **Usage and cost:**
   - Totals and trends by organization, agent, channel, provider, model and month.
   - A breakdown per conversation: every line with provider, model, quantity, native cost and INR cost, then the INR total.
   - Unit economics: cost per conversation and per voice minute.
   - CSV export, audit-logged.
2. **Price list:** view the prices and add a new effective-dated row. Rows are never edited in place.
3. **Audit log:** filter by organization, user, action and date. Needs `AuditLog:Read`.
4. **Event log:** provider calls with latency and errors, channel traffic, and failed requests.
5. **System status:** last run and result of each cron job, provider error rate over the last hour, rows with no price, and API readiness.

New permission: `Usage:Read`, platform-only, held by `platform.super_admin` and `platform.ops`. Every page is read-only, except adding a price row.

### PR 5: monitoring and alerts

1. Better Stack free plan:
   - Monitors on API `/health/ready`, the dashboard, the widget script and the widget config endpoint.
   - One heartbeat per cron job, pinged when the job finishes.
   - The free plan is described as "for personal projects", so confirm it may be used before production.
2. A Slack channel, `#klivo-alerts`, receives Better Stack alerts and our own alerts through one incoming webhook. The Slack phone app delivers them as push notifications.
3. Our own alerts:
   - Daily cost per organization above a threshold, or a sudden jump.
   - Provider error rate above 10% over 15 minutes.
   - Any call recorded with no price.

### Later

- Monthly reconciliation against provider usage APIs (OpenAI usage and costs, Deepgram usage, ElevenLabs usage). Sarvam has no usage API, so use its dashboard.
- Claude through `@ai-sdk/anthropic`. Its cache-write and cache-read formula is already in the research notes.
- Sentry DSNs and alert rules at the production launch (see the prod checklist).

## Open questions

| Question                                                                                                                             | Who answers                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Sarvam STT: is the real rate ₹30 per hour (docs) or ₹1.5 per minute (marketing page)? Is the detection surcharge real? Is GST added? | A test call plus the first invoice |
| ElevenLabs: is the account on the new USD pricing or on old credits?                                                                 | Dhruv, account settings            |
| `saaras:v3` English quality, compared with Deepgram, before dropping the second STT call                                             | Test clips in PR 3                 |
| Alert thresholds: daily cost per organization, error rate                                                                            | Dhruv, at PR 5                     |
