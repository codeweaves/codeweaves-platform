# ADR-0012: Usage ledger and price list for cost metering

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Dhruv Khator

## Context

We need the real cost of every provider call to build a pricing model. Today:

- `llm_usage.cost` is filled only from OpenRouter's reported cost. Direct OpenAI and Gemini calls store `null`, and there is no price list.
- Tool-calling turns count only the last step. Classifier and extraction calls are not recorded. Some providers' usage is lost.
- Voice calls record providers and latency, but not the billable audio seconds or characters.
- `UsageTrackingService` buffers rows in memory and drops them when the buffer is full or a flush fails.
- Providers bill in different currencies: USD (OpenAI, Gemini, Deepgram, ElevenLabs, Resend) and INR (Sarvam, Meta WhatsApp in India).
- Every provider is on a free trial today, so there are no negotiated rates yet.

Dhruv's requirements:

- Each conversation's cost broken down line by line.
- The total shown in INR.
- No dependence on a provider-reported cost.

## The four questions

- **Blast radius:** wrong formulas or prices give wrong pricing decisions. Writes are fire-and-forget, so a metering failure never breaks a chat.
- **One-way or two-way door:** the table shapes are moderately hard to change once months of data exist. The formulas and prices are easy to change, because each row stores the prices it used.
- **Couples us to:** the provider usage-field formats, which are captured per provider in tested functions. Also the ECB reference rate for USD to INR.
- **Cost of waiting:** every month without metering is a month of cost data we can never recover.

## Decision

**Tables**

- `provider_prices`
  - Columns: provider, model, unit, price, per-quantity, currency, effective-from, source URL, note, created-by.
  - Units: input token, cached input token, cache-write token, output token, audio second, character, message, email.
  - A price change adds a new effective-dated row. Rows are never edited.
- `usage_records`: one row per billable provider call.
  - When and who: `occurredAt`, `organizationId` (null for platform cost such as voice previews), `agentId`, `chatSessionId`, `messageId`.
  - What: `channel`, `feature` (chat, warmup, summary, classifier, extraction, STT, TTS, voice preview, WhatsApp message, email), `provider`, `model`, `providerRequestId`.
  - How much: typed quantity columns `inputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `outputTokens`, `reasoningTokens`, `audioSeconds`, `characters`, `units`.
  - Cost: `cost` (decimal, null when no price matched), `currency`, `pricing` (JSON snapshot of the unit prices and price-row ids used).
  - Origin: `quantitySource` (`PROVIDER_REPORTED`, `MEASURED` or `ESTIMATED`), and `billedTo` (`PLATFORM`, or `CLIENT` for WhatsApp pass-through).
- `fx_rates`: one USD-to-INR rate per day, from the ECB reference rate (frankfurter.app) or set by staff.

**Rules**

1. We compute cost as the provider-reported quantities × our price list, using one tested formula per provider. We never count tokens ourselves.
2. Costs stay in the provider's currency. Reports convert to INR at query time, with the rate for `occurredAt`'s date, or the nearest earlier day.
3. Aggregation runs in SQL on the typed columns (see the analytics-in-the-database rule).
4. `UsageMeterService.record()` never throws into the request and never drops a row silently. A failed write is logged and retried once.
5. A call with no matching price is still recorded with its quantities, and flagged on the admin page.
6. `llm_usage` is replaced: backfill it into `usage_records` with recomputed costs, move its writers, then drop the table in a later release.

## Options rejected

### Use the provider-reported cost (OpenRouter's `usage.cost`)

**Good:** exact to the cent, including cache discounts, with no price list to maintain.

**Rejected because:** only OpenRouter returns it, and we are removing OpenRouter (ADR-0011). Every direct provider returns usage counts but no cost.

### Store each unit as its own row (input, cached, output as separate rows)

**Good:** maps one-to-one to the breakdown on screen.

**Rejected because:** it triples the rows and makes per-call queries need a group-by. Typed columns plus the price snapshot give the same breakdown.

### Store the INR amount at write time

**Good:** reports need no join.

**Rejected because:** every write would depend on having today's rate, and a wrong rate would be frozen into the row. Converting at query time from `fx_rates` keeps writes simple and lets us correct a rate later.

### Keep the in-memory buffered writer

**Good:** fewer database round trips.

**Rejected because:** it drops rows when the buffer is full or a flush fails, which is wrong for cost data. One chat turn makes about 3 to 6 provider calls, so direct inserts are well within budget at 10K conversations a month.

## Consequences

- Real cost per conversation, agent, organization, provider and model, in native currency and in INR.
- Someone must keep the price list current. The admin page flags any call with no price.
- `ESTIMATED` and `MEASURED` rows are less exact than `PROVIDER_REPORTED` ones, and the reports show the share of each.
- Monthly reconciliation against provider usage APIs is still needed to prove the formulas. It is planned as later work.
