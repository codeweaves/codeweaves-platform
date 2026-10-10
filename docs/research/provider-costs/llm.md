# Computing the USD cost of one LLM call, per provider

Retrieved: 2026-10-10. Every price and rule has its source next to it. "SRC" means read from installed package source in `apps/api/node_modules` (authoritative for our versions). Anything not confirmed from a primary source is marked **UNCONFIRMED**.

Installed versions (from `apps/api/node_modules/*/package.json`): `ai` 6.0.193, `@ai-sdk/openai` 3.0.67, `@ai-sdk/google` 3.0.80, `@ai-sdk/groq` 3.0.39, `@ai-sdk/openai-compatible` 2.0.48, `@openrouter/ai-sdk-provider` 2.9.0. `@ai-sdk/anthropic` 3.0.71 is present in node_modules but is NOT a declared dependency and is not imported anywhere. Claude reaches us only through OpenRouter.

---

## 1. What we call today (repo)

Routing is by model-id prefix in `parseModelId()` (`apps/api/src/modules/ai/ai-sdk.service.ts:62`). No prefix means OpenRouter.

| Feature                                                                                                            | Model id (default)                                                                                                                                                                                                  | Provider                         | How called                                                                                                            | File                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent chat (widget, WhatsApp, voice), streaming + non-streaming, optional tools (`maxSteps: 3` for human handover) | per-agent `aiConfig.modelId`, else env `DEFAULT_AI_MODEL=openai:gpt-4.1` (`.env.example:156`). Code fallback when env is unset: `openai/gpt-4.1-mini` = **OpenRouter**, not OpenAI direct (`ai-sdk.service.ts:321`) | any                              | AI SDK `generateText` / `streamText` in `LlmService` (`llm.service.ts:128`, `:242`)                                   | `direct-chat.service.ts:391`, `:648`                                                                                                           |
| Model picker (curated)                                                                                             | `openai:gpt-4.1`, `openai:gpt-4.1-mini`, `gemini:gemini-2.5-flash`, `groq:qwen/qwen3-32b`, `anthropic/claude-haiku-4-5` (OpenRouter)                                                                                | OpenAI, Google, Groq, OpenRouter | as above                                                                                                              | `apps/web/components/features/agents/agent-editor/sections/integration-settings.tsx:72-106`                                                    |
| Conversation summary + title                                                                                       | `SUMMARIZATION_MODEL` env, else `groq:llama-3.3-70b-versatile`                                                                                                                                                      | Groq                             | `LlmService.generateCompletion`                                                                                       | `summarization.service.ts:16`, `:128`, `:187`                                                                                                  |
| Topic classifier, language detection, data-field extraction                                                        | `AI_CLASSIFIER_MODEL` env, else `gpt-4o-mini`                                                                                                                                                                       | OpenAI                           | **raw `fetch` to `https://api.openai.com/v1/chat/completions`**, non-streaming, `response_format: json_schema strict` | `common/ai/ai-classifier.service.ts:37`, `:58`, `:368`; callers `conversation-classifier.service.ts:165,168`, `data-extraction.service.ts:253` |
| Optional providers (no default user)                                                                               | `sarvam:<model>`, `cerebras:<model>` (e.g. `cerebras:gpt-oss-120b`)                                                                                                                                                 | Sarvam, Cerebras                 | `@ai-sdk/openai-compatible`                                                                                           | `ai-sdk.service.ts:507`, `:544`                                                                                                                |
| Embeddings                                                                                                         | `getEmbeddingModel()` exists but has **no caller** on develop                                                                                                                                                       | -                                | -                                                                                                                     | `ai-sdk.service.ts:360`                                                                                                                        |

API shape and caching per provider (repo facts):

- **OpenAI via AI SDK uses the Responses API, not Chat Completions.** `createOpenAI(...)(modelId)` calls `createResponsesModel` (SRC `@ai-sdk/openai/dist/index.js:6876-6894`). Only the raw-fetch classifier uses Chat Completions.
- **Prompt caching, explicit:** OpenAI calls send `promptCacheKey: agent-<id>` and `promptCacheRetention: '24h'` (`llm.service.ts:553-558`). Gemini sends `thinkingConfig.thinkingBudget: 0` (thinking off), no explicit cache. Groq Qwen3 sends `reasoningEffort: 'none'`. **OpenRouter (Claude Haiku) gets no `cache_control`, so Anthropic caching never happens.** No Gemini explicit `cachedContent` is created anywhere.
- **The classifier ignores `json.usage`**, so classifier, language and extraction calls are not metered at all today (`ai-classifier.service.ts:422-426` only types `choices`).
- `extractCost()` reads only `providerMetadata.openrouter.usage.cost` (`llm.service.ts:743`). Direct-provider calls record `cost: null`.

### Model availability problems found (affects the price table)

- **`groq:qwen/qwen3-32b` was shut down on 2026-07-17** and **`groq:llama-3.3-70b-versatile` on 2026-08-16** for free and developer tiers. Groq names `openai/gpt-oss-120b` as the replacement. Source: https://console.groq.com/docs/deprecations (retrieved 2026-10-10). The Groq models page now lists `llama-3.3-70b-versatile` as "Enterprise / Contact Sales" and does not list `qwen/qwen3-32b` at all: https://console.groq.com/docs/models. So the default summarization model and one picker entry fail unless `SUMMARIZATION_MODEL` is overridden or we hold an enterprise contract.
- **Cerebras `zai-glm-4.7` is deprecated on shared inference** (https://inference-docs.cerebras.ai/support/deprecation). The shared catalog now has `gpt-oss-120b` and `qwen-3.8-27b` (https://inference-docs.cerebras.ai/models/overview).
- **Sarvam** chat v1 now serves only `sarvam-105b` and `sarvam-105b-conversations` (https://docs.sarvam.ai/api-reference/chat/chat-completions-v1.md). The `sarvam:sarvam-30b` example in `.env.example` is stale. The comment "Chat completion is free as of 2026" is contradicted by the current price list (section 2.6).
- **Picker id `anthropic/claude-haiku-4-5`**: the OpenRouter model id is `anthropic/claude-haiku-4.5`, with a dot (OpenRouter `GET /api/v1/models`, retrieved 2026-10-10). Whether OpenRouter accepts the hyphen alias is **UNCONFIRMED**. It may fail with an invalid-model error.
- The code comment says `promptCacheRetention: '24h'` is supported on gpt-4.1-mini. OpenAI's list of models with extended retention includes `gpt-4.1` but **not `gpt-4.1-mini`** (https://developers.openai.com/api/docs/guides/prompt-caching). What the API does with the parameter on mini (ignore it or reject it) is **UNCONFIRMED**.
- The code comment says cached tokens get a "50% cached discount". For gpt-4.1 and gpt-4.1-mini the cached rate is **25% of input (a 75% discount)**. Only gpt-4o-mini is 50%. See 2.1.

---

## 2. Per provider

Notation: prices are USD per 1M tokens, so `cost = tokens × price / 1_000_000`.

### 2.1 OpenAI (gpt-4.1, gpt-4.1-mini, gpt-4o-mini)

**a) Prices.** Source: https://developers.openai.com/api/docs/pricing (retrieved 2026-10-10; platform.openai.com/docs/pricing 301-redirects here).

| Model        | Input | Cached input | Output |
| ------------ | ----- | ------------ | ------ |
| gpt-4.1      | 2.00  | 0.50         | 8.00   |
| gpt-4.1-mini | 0.40  | 0.10         | 1.60   |
| gpt-4o-mini  | 0.15  | 0.075        | 0.60   |

- Batch: gpt-4.1 1.00/4.00, gpt-4.1-mini 0.20/0.80, gpt-4o-mini 0.075/0.30, with no cached rate listed. We do not use Batch.
- Flex: these models are not in the Flex table.
- "Fast" (renamed from Priority on 2026-07-30): gpt-4.1 3.50 / 0.875 / 14.00; gpt-4.1-mini 0.70 / 0.175 / 2.80; gpt-4o-mini 0.25 / 0.125 / 1.00.
- No long-context tier for these models. Regional (data residency) endpoints add a 10% uplift, but only "for models released on or after March 5, 2026", so it does not apply to these three. FedRAMP endpoints also carry a 10% uplift.

**b) Usage fields.**

- Responses API (agent chat): `usage.input_tokens`, `usage.input_tokens_details.cached_tokens`, `usage.input_tokens_details.cache_write_tokens`, `usage.output_tokens`, `usage.output_tokens_details.reasoning_tokens`, `usage.total_tokens`. Source: https://developers.openai.com/api/reference/resources/responses/methods/create.md (ResponseUsage). In streaming, usage arrives on the `response.completed` event (SRC `@ai-sdk/openai` reads it there; the event name is from the same reference).
- Chat Completions (classifier): `usage.prompt_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens`, `usage.completion_tokens_details.reasoning_tokens` (also `accepted_prediction_tokens` and `rejected_prediction_tokens`). In streaming, usage arrives only with `stream_options: {include_usage: true}`, as a final chunk with empty `choices`. "If the stream is interrupted or cancelled, you may not receive the final usage chunk." Source: https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events and https://developers.openai.com/cookbook/examples/how_to_stream_completions. The AI SDK chat model always sends `include_usage: true` (SRC `@ai-sdk/openai/dist/index.js:923`).
- **Subset rules:** cached tokens are a subset of input tokens. OpenAI's own cost formula is `ordinaryInputTokens = inputTokens - cachedTokens - cacheWriteTokens` (https://developers.openai.com/api/docs/guides/prompt-caching). Reasoning tokens are a subset of output tokens (the AI SDK computes `text = output - reasoning`, SRC `index.js:2719`). gpt-4.1 and 4o-mini are non-reasoning, so reasoning is 0.
- Rejected prediction tokens "are still billed like other completion tokens" (https://platform.openai.com/docs/guides/predicted-outputs). We do not use Predicted Outputs.

**c) Caching.** Source: https://developers.openai.com/api/docs/guides/prompt-caching.

- Automatic, "enabled by default for supported OpenAI models".
- Models before GPT-5.6 have no cache-write charge. GPT-5.6 and later charge writes at 1.25× input, and "Cache-write pricing is not an additive fee".
- Minimum length: the 1,024-token minimum is stated only for GPT-5.6 and later. For earlier models "the minimum cacheable input length varies with request settings", and `cached_tokens` "is rounded down to the nearest multiple of 128".
- In-memory retention is "around 5 to 10 minutes of inactivity, up to one hour". `24h` extended retention is listed for `gpt-4.1` (and gpt-5.x), not gpt-4.1-mini or gpt-4o-mini. The docs state **no separate price for 24h retention**. That it costs nothing extra is **UNCONFIRMED** (the docs say nothing either way).

**d) AI SDK mapping** (SRC `@ai-sdk/openai/dist/index.js:2690-2726`, Responses; `:72-110`, Chat):

- `inputTokens` = `input_tokens` (**inclusive** of cached)
- `inputTokenDetails.cacheReadTokens` = `cached_tokens` (0 if absent)
- `inputTokenDetails.noCacheTokens` = `input_tokens - cached_tokens`
- `inputTokenDetails.cacheWriteTokens` = **always undefined**. The installed version does not map `cache_write_tokens`. This does not matter for gpt-4.1, but it will under-bill GPT-5.6+.
- `outputTokens` = `output_tokens` (inclusive of reasoning); `outputTokenDetails.reasoningTokens` = `reasoning_tokens`
- `usage.raw` = the provider usage object, untouched
- `providerMetadata.openai.serviceTier` = the `service_tier` the response reports (SRC `:5478`, `:6368`). Use it to choose the price column.

**e) Formula.**

```
cost = (input_tokens - cached_tokens - cache_write_tokens) × P_in
     + cached_tokens × P_cached
     + cache_write_tokens × P_write          # 0 for gpt-4.1 / 4o-mini
     + output_tokens × P_out                 # reasoning already inside output_tokens
```

Pick the price row by the `service_tier` the response reports (default, priority/"fast", flex).

Worked example, gpt-4.1 Responses: `input_tokens=5000`, `cached_tokens=3968` (a multiple of 128), `output_tokens=300`.
`1032×2.00 + 3968×0.50 + 300×8.00 = 2064 + 1984 + 2400 = 6448` per 1M, so **$0.006448**.
The same tokens on gpt-4.1-mini: `1032×0.40 + 3968×0.10 + 300×1.60 = 412.8 + 396.8 + 480 = 1289.6`, so **$0.0012896**.
Classifier on gpt-4o-mini: `prompt_tokens=1500`, cached 0, `completion_tokens=40`: `1500×0.15 + 40×0.60 = 249`, so **$0.000249**.

**f) Reconciliation.** Both endpoints need an admin key. Source: https://developers.openai.com/cookbook/examples/completions_usage_api and https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs.

- `GET /v1/organization/usage/completions`: `bucket_width` 1m / 1h / 1d; `group_by` includes `model`, `project_id`, `api_key_id`, `user_id`, `batch` (and `service_tier`, per search-result summary: **UNCONFIRMED**). Fields: `input_tokens`, `input_cached_tokens`, `output_tokens`, `input_audio_tokens`, `output_audio_tokens`, `num_model_requests`.
- `GET /v1/organization/costs`: **daily buckets only** (`1d`), `group_by` `project_id` and `line_item`; returns `amount.value` and `amount.currency`.
- Per-model granularity: tokens per model per minute, hour or day from usage; dollars per line_item per day from costs. Recommendation: one OpenAI **project per environment** so `project_id` separates dev from prod.

### 2.2 Google Gemini API (gemini-2.5-flash)

**a) Prices.** Source: https://ai.google.dev/gemini-api/docs/pricing (retrieved 2026-10-10). Paid tier, Standard:

|                                        | Text/image/video                | Audio |
| -------------------------------------- | ------------------------------- | ----- |
| Input                                  | 0.30                            | 1.00  |
| Output (**including thinking tokens**) | 2.50                            | 2.50  |
| Context cache (read)                   | 0.03                            | 0.10  |
| Cache storage                          | 1.00 per 1M tokens **per hour** |       |

- Batch and Flex: input 0.15 (audio 0.50), output 1.25, caching and storage the same as Standard. Priority: input 0.54, output 4.50, cache 0.054, storage 1.80/h.
- **No long-context tier for 2.5 Flash.** For comparison, 2.5 Pro has a >200k tier: input 1.25 → 2.50, output 10 → 15, cache 0.125 → 0.25. Flash-Lite: 0.10 / 0.40 / cache 0.01.
- Free tier: input and output "Free of charge", caching "Not available". Free-tier data use is different (see the billing doc).

**b) Usage fields.** `usageMetadata` (https://ai.google.dev/api/generate-content):

- `promptTokenCount`: "When `cachedContent` is set, this is still the total effective prompt size", so it **includes cached tokens**.
- `cachedContentTokenCount`: "Number of tokens in the cached part of the prompt".
- `candidatesTokenCount`: "Total number of tokens across all the generated response candidates" (excludes thoughts).
- `thoughtsTokenCount`: thinking tokens, **separate from candidates**.
- `toolUsePromptTokenCount`: "Number of tokens present in tool-use prompt(s)". This is for built-in tools (Search grounding, code execution). Whether it is billed as input is **UNCONFIRMED**. We do not use built-in tools.
- `totalTokenCount`: "prompt + thoughts + response candidates".
- Also `promptTokensDetails` / `cacheTokensDetails` / `candidatesTokensDetails` (per modality) and `serviceTier`.
- Streaming (`streamGenerateContent`): every chunk is a `GenerateContentResponse` that may carry `usageMetadata`. The AI SDK keeps the last non-null one (SRC `@ai-sdk/google/dist/index.js:1846-1848`). Whether the final chunk always holds cumulative totals is per the SDK's behaviour; the docs do not say: **UNCONFIRMED**.

**c) Caching.**

- Implicit caching is "enabled by default for all Gemini 2.5 and newer models" and "We automatically pass on cost savings if your request hits caches". No guarantee is given. Minimum: **2,048 tokens for 2.5 Flash and 2.5 Pro**. Source: https://ai.google.dev/gemini-api/docs/generate-content/caching. Note: OpenRouter's caching page still says implicit Gemini reads cost "0.25x"; Google's own price table (0.03 vs 0.30) means **0.1x**. Use Google's number.
- Explicit caching bills (a) the cached tokens at the reduced rate on each use and (b) storage "billed based on the TTL duration of cached token count". Default TTL is 1 hour. Whether creating the cache is billed at the normal input rate on the Gemini Developer API (Vertex says yes) is **UNCONFIRMED**. We do not use explicit caches.

**d) AI SDK mapping** (SRC `@ai-sdk/google/dist/index.js:252-288`):

- `inputTokens` = `promptTokenCount` (**inclusive** of cached)
- `cacheReadTokens` = `cachedContentTokenCount`; `noCacheTokens` = `prompt - cached`
- `outputTokens` = **`candidatesTokenCount + thoughtsTokenCount`**; `textTokens` = candidates; `reasoningTokens` = thoughts
- `toolUsePromptTokenCount` is **dropped** (not in the SDK's usage schema, SRC `:2408-2420`)
- `providerMetadata.google.usageMetadata` (raw) and `providerMetadata.google.serviceTier`
- Our `extractCachedTokens()` fallback reads `providerMetadata.google.cachedContentTokenCount`, a path that does not exist. The real path is `providerMetadata.google.usageMetadata.cachedContentTokenCount`. This is harmless today only because the normalised `cacheReadTokens` is always a number, so the fallback never runs.

**e) Formula.**

```
cost = (promptTokenCount - cachedContentTokenCount) × P_in
     + cachedContentTokenCount × P_cache
     + (candidatesTokenCount + thoughtsTokenCount) × P_out
     [+ explicit cache storage: cachedTokens × hours × P_storage, billed per cache, not per call]
```

Use the audio rates for the audio part of `promptTokensDetails` (modality AUDIO). We send text only.

Worked example: `promptTokenCount=6000`, `cachedContentTokenCount=4096`, `candidatesTokenCount=250`, `thoughtsTokenCount=0` (we set thinkingBudget 0):
`1904×0.30 + 4096×0.03 + 250×2.50 = 571.2 + 122.88 + 625 = 1319.08`, so **$0.00131908**.

**f) Reconciliation.** Source: https://ai.google.dev/gemini-api/docs/billing.

- Billing runs through a Cloud Billing account. Usage shows in AI Studio > Dashboard > Usage. Costs show in the Cloud Billing console "Cost management" pages: group by SKU and filter Services = Gemini API. Cost data is "typically available within a day".
- The Gemini page documents **no usage or cost API**. The general Cloud Billing export to BigQuery (https://cloud.google.com/billing/docs/how-to/export-data-bigquery) should work for Gemini SKUs, but the Gemini docs do not confirm it: **UNCONFIRMED**.
- The tier is per billing account. A free-tier key costs $0, so the ledger must know which tier the key is on.

### 2.3 Groq (qwen/qwen3-32b, llama-3.3-70b-versatile, now shut down; replacement openai/gpt-oss-120b)

**a) Prices.** Source: https://console.groq.com/docs/models (retrieved 2026-10-10; groq.com/pricing renders no prices to a fetcher).

- `openai/gpt-oss-120b`: 0.15 input / 0.60 output. `openai/gpt-oss-20b`: 0.075 / 0.30.
- `llama-3.3-70b-versatile`: "Contact Sales" (enterprise only now).
- `qwen/qwen3-32b`: no longer listed. Historical public prices for these two models could not be confirmed from a current primary source: **UNCONFIRMED**.
- Batch: 50% off, "all batch tokens are billed at the 50% batch rate regardless of cache status" (https://console.groq.com/docs/batch, via search summary: **UNCONFIRMED** wording). Groq also has service tiers (https://console.groq.com/docs/service-tiers). Flex pricing was not checked: **UNCONFIRMED**.

**b) Usage fields.** OpenAI-style `usage.prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, plus timing fields (`queue_time`, `prompt_time`, `completion_time`, `total_time`). Source: https://console.groq.com/docs/prompt-caching ("Response Usage Structure"). `cached_tokens` is a subset of `prompt_tokens`: the doc computes "Cache Hit Rate = cached_tokens / prompt_tokens". `completion_tokens_details.reasoning_tokens` comes from the AI SDK schema (SRC `@ai-sdk/groq/dist/index.js:820-826`). Whether reasoning is billed inside completion_tokens is **UNCONFIRMED** from Groq docs, but it is the OpenAI convention. Streaming: usage arrives in `x_groq.usage` on the last chunk (SRC `@ai-sdk/groq/dist/index.js:590`). The Groq docs page for this was not found: **UNCONFIRMED** in docs.

**c) Caching.** Automatic, cannot be disabled, "50% discount for cached input tokens", no write fee, expires "after 2 hours without use". Minimum is "128 to 1024 tokens depending on the specific model". **Supported only on `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-oss-safeguard-20b`.** Source: https://console.groq.com/docs/prompt-caching.

**d) AI SDK mapping** (SRC `@ai-sdk/groq/dist/index.js:40-75`): `inputTokens` = `prompt_tokens`; **`noCacheTokens` = `prompt_tokens` and `cacheReadTokens` = undefined. The Groq provider ignores `cached_tokens` even though its schema parses it.** `outputTokens` = `completion_tokens`; `reasoningTokens` = `completion_tokens_details.reasoning_tokens`. **To bill cache hits on gpt-oss you must read `usage.raw.prompt_tokens_details.cached_tokens`.** If you don't, you over-bill by up to 50% of the cached input.

**e) Formula.**

```
cost = (prompt_tokens - cached_tokens) × P_in + cached_tokens × (0.5 × P_in) + completion_tokens × P_out
```

Worked example (Groq's own usage sample, gpt-oss-120b): prompt 4641, cached 4608, completion 1817:
`33×0.15 + 4608×0.075 + 1817×0.60 = 4.95 + 345.6 + 1090.2 = 1440.75`, so **$0.00144075**. A naive version that ignores cache gives $0.00178635, which is 24% high.

**f) Reconciliation.** No documented usage or cost API (search of console.groq.com docs). The Spend Limits doc says current spend updates every 10 to 15 minutes in the console (https://console.groq.com/docs/spend-limits). Reconcile against the console billing page by hand: **UNCONFIRMED** whether it exports per model.

### 2.4 Cerebras (gpt-oss-120b; zai-glm-4.7 deprecated)

**a) Prices.** `gpt-oss-120b`: **0.35 input / 0.75 output** (developer pricing). Source: https://inference-docs.cerebras.ai/models/openai-oss (retrieved 2026-10-10). cerebras.ai/pricing renders no table. `qwen-3.8-27b` prices were not checked.

**b) Usage fields.** `usage.prompt_tokens`, `completion_tokens`, `total_tokens`, `image_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.{reasoning_tokens, accepted_prediction_tokens, rejected_prediction_tokens}` ("rejected ... Counted in total completion tokens for billing"), plus `time_info` and a `service_tier` field (priority / default / flex). Source: https://inference-docs.cerebras.ai/api-reference/chat-completions. Streaming usage behaviour is not documented in the streaming guide (https://inference-docs.cerebras.ai/capabilities/streaming): **UNCONFIRMED**.

**c) Caching.** Automatic for all models, 128-token blocks, 5-minute guaranteed TTL (up to 1 h). **No discount:** "Input tokens, whether served from the cache or processed fresh, are billed at the standard input token rate". Source: https://inference-docs.cerebras.ai/capabilities/prompt-caching.

**d) AI SDK mapping** (`@ai-sdk/openai-compatible`, SRC `dist/index.js:68-100`): `inputTokens` = `prompt_tokens` (inclusive); `cacheReadTokens` = `cached_tokens`; `outputTokens` = `completion_tokens` (inclusive of reasoning). **Streaming pitfall:** `stream_options.include_usage` is sent only when the provider is created with `includeUsage: true` (SRC `:654-655`). Our `createOpenAICompatible` calls for Cerebras and Sarvam do not set it, so streamed calls may return no usage, and `normaliseUsage` then records 0 tokens and $0. Whether Cerebras or Sarvam send usage without the flag is **UNCONFIRMED**. Fix by setting `includeUsage: true`.

**e) Formula.** `cost = prompt_tokens × P_in + completion_tokens × P_out`. Cached tokens are **not** discounted. Example: prompt 3000 (2800 cached), completion 500: `3000×0.35 + 500×0.75 = 1425`, so **$0.001425**.

**f) Reconciliation.** Console Analytics has Usage, Cached-Usage and Cost tabs. The Cost tab is monthly, broken down by model and token type, and lags up to 10 min. CSV "Download Report" is documented for the Usage and Cached-Usage tabs. Source: https://inference-docs.cerebras.ai/console/usage-monitoring (via search summary: **UNCONFIRMED**, page not opened). No public billing API was found.

### 2.5 Anthropic Claude Haiku 4.5 (through OpenRouter today)

**a) Prices.** Source: https://platform.claude.com/docs/en/about-claude/pricing (retrieved 2026-10-10).

- Base input **1.00**, 5-minute cache write **1.25**, 1-hour cache write **2.00**, cache hit/refresh **0.10**, output **5.00**.
- Batch: 0.50 / 2.50 (50% off). No long-context tier for Haiku 4.5.
- The `inference_geo: "us"` 1.1× multiplier applies to "Claude 4.6 and later", so not to Haiku 4.5 on the first-party API. Bedrock and Vertex **regional / multi-region endpoints add a 10% premium** for Haiku 4.5.
- Multipliers stack (cache × batch × residency).

OpenRouter price for `anthropic/claude-haiku-4.5` (from `GET https://openrouter.ai/api/v1/models` and `/api/v1/models/anthropic/claude-haiku-4.5/endpoints`, retrieved 2026-10-10): prompt $0.000001, completion $0.000005, cache_read $0.0000001, cache_write $0.00000125, cache_write_1h $0.000002 per token. That is the same as first-party on the `anthropic`, `azure/global`, `amazon-bedrock/global` and `google-vertex/global` endpoints. **The `amazon-bedrock/us`, `amazon-bedrock/eu-west-1`, `google-vertex/us-east5` and `google-vertex/europe` endpoints are 1.1×** (prompt $0.0000011, completion $0.0000055). OpenRouter says "We pass through the pricing of the underlying providers; there is no markup on inference pricing" (https://openrouter.ai/docs/faq).

**b) Usage fields, native Anthropic** (https://platform.claude.com/docs/en/build-with-claude/prompt-caching):

- `usage.input_tokens` = "input tokens which were not read from or used to create a cache (that is, tokens after the last cache breakpoint)"
- `cache_creation_input_tokens`; `cache_read_input_tokens`; `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}` (their sum equals `cache_creation_input_tokens`)
- "`total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`". So **`input_tokens` EXCLUDES cache tokens.**
- `output_tokens` includes thinking tokens (extended thinking is billed as output). Haiku 4.5 thinking is off unless requested.
- In streaming, usage appears in `message_start` (input and cache fields), and `message_delta` carries the cumulative `output_tokens` ("within `usage` in the response (or `message_start` event if streaming)", same page). That the `message_delta` count is cumulative comes from the streaming docs, which were not re-fetched this session: **UNCONFIRMED**.

Usage fields through OpenRouter (https://openrouter.ai/docs/use-cases/usage-accounting): OpenAI-style `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.cache_write_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`, `cost`, `cost_details.upstream_inference_cost`. Usage is "now always included automatically" and arrives in the last SSE message, in "the model's native tokenizer". **Whether OpenRouter's `prompt_tokens` includes `cache_write_tokens` (and `cached_tokens`) is not stated: UNCONFIRMED.** OpenRouter's caching example (prompt 10339, cached 10318) suggests cached tokens are included.

**c) Caching.** Not automatic. It needs `cache_control`, either top-level ("automatic caching") or per block. Write costs 1.25× (5 min) or 2× (1 h); read costs 0.1×. **Minimum cacheable prompt: 4,096 tokens for Haiku 4.5.** Source: the prompt-caching page above. OpenRouter passes the same rules through (https://openrouter.ai/docs/features/prompt-caching). **We send no `cache_control`, so today every Haiku input token bills at $1.00.**

**d) AI SDK mapping.**

- Through OpenRouter (what we use; SRC `@openrouter/ai-sdk-provider/dist/index.js:2593-2614`): `inputTokens` = `prompt_tokens`; `cacheReadTokens` = `cached_tokens`; `cacheWriteTokens` = `cache_write_tokens`; **`noCacheTokens` = `prompt_tokens - cached_tokens`. It does NOT subtract `cache_write_tokens`.** If `prompt_tokens` includes writes, `noCacheTokens + cacheWriteTokens` double-counts the writes. Compute `uncached = prompt_tokens - cached - cache_write` yourself once the inclusion rule is confirmed. `providerMetadata.openrouter.provider` = the provider name that served the call (e.g. "Amazon Bedrock"). It does **not** say which regional endpoint, so you cannot tell a 1.0× route from a 1.1× route per call. Read `GET /api/v1/generation?id=` or pin routing to global endpoints.
- `@ai-sdk/anthropic` direct (installed, unused; SRC `@ai-sdk/anthropic/dist/index.js:1652-1690`): `inputTokens.total` = `input_tokens + cache_creation + cache_read` (the SDK makes it **inclusive**); `noCache` = `input_tokens`; `cacheRead` = `cache_read_input_tokens`; `cacheWrite` = `cache_creation_input_tokens` (no 5m/1h split, so read `usage.raw.cache_creation` for the 2× 1-hour rate); `reasoningTokens` = undefined.

**e) Formula (native fields).**

```
cost = input_tokens × 1.00
     + ephemeral_5m_input_tokens × 1.25 + ephemeral_1h_input_tokens × 2.00
     + cache_read_input_tokens × 0.10
     + output_tokens × 5.00
     (× 1.1 if served by a regional/multi-region Bedrock/Vertex endpoint)
```

Example, cache hit: `input_tokens=200`, `cache_read=3900`, `output=300`: `200×1 + 3900×0.1 + 300×5 = 2090`, so **$0.00209**.
Example, first call with a 5-minute write: `input_tokens=200`, `cache_creation=4100`, `output=300`: `200 + 5125 + 1500 = 6825`, so **$0.006825**.

**f) Reconciliation.**

- Native: `GET /v1/organizations/usage_report/messages` (buckets 1m / 1h / 1d; group by model, api_key_id, workspace_id, service_tier, context_window, inference_geo, speed; fields cover uncached input, cache read, cache creation and output). `GET /v1/organizations/cost_report` gives **daily buckets only**, USD "as decimal strings in lowest units (cents)", grouped by workspace or description. Priority Tier costs are not in the cost report. Data freshness is about 5 minutes. Needs an Admin API key, which individual accounts cannot have. Source: https://platform.claude.com/docs/en/manage-claude/usage-cost-api.
- Through OpenRouter: `GET /api/v1/generation?id=<gen id>` returns `total_cost`, `usage`, `cache_discount`, `native_tokens_prompt`, `native_tokens_completion`, `native_tokens_cached`, `native_tokens_reasoning`, `provider_name`, `upstream_inference_cost`, `is_byok` (https://openrouter.ai/docs/api/api-reference/generations/get-generation). The Activity page in the UI shows history by model, provider and key. There is also a credits API (https://openrouter.ai/docs/faq).
- **OpenRouter account-level overhead:** a 5.5% fee on Stripe credit purchases ($0.80 minimum; 5% for crypto). BYOK is free up to $25,000/month, then 5% (https://openrouter.ai/docs/faq). This is a purchase-time cost, not a per-call one. Allocate it as an overhead multiplier (about 1.055) in the pricing model.

### 2.6 Sarvam (LLM only if an agent picks `sarvam:`)

**a) Prices, in INR per 1M tokens** (https://www.sarvam.ai/api-pricing, retrieved 2026-10-10): Sarvam 105B / 105B Chat / 105B Conversations: input ₹29.28, cached input ₹10.98, output ₹73.20. No USD price is shown. Whether GST is added on top is **UNCONFIRMED**.

**b) Usage.** OpenAI-style `prompt_tokens`, `completion_tokens`, and `prompt_tokens_details`, which "`null` on a cache miss. On a hit, includes `cached_tokens`" ("billed at the cached-input rate"). Source: https://docs.sarvam.ai/api-reference/chat/chat-completions-v1.md. That `cached_tokens` is a subset of `prompt_tokens` is **UNCONFIRMED** (OpenAI convention).

**c) Billing:** org-level prepaid credits that do not expire (https://docs.sarvam.ai/api/platform/billing.md). No usage or cost API was found.

**d) Formula:** `cost_INR = (prompt - cached) × 29.28 + cached × 10.98 + completion × 73.20` per 1M, then `cost_USD = cost_INR / FX(date)`. Store the INR amount and the FX rate used. Example: prompt 1000, completion 200: `29280 + 14640 = 43920` per 1M, so ₹0.04392.

---

## 3. AI SDK pitfalls (v6.0.193, read from source)

1. **`result.usage` is the FINAL STEP ONLY. `totalUsage` is the sum.** SRC `ai/dist/index.js:4873-4877`: `DefaultGenerateTextResult` stores `totalUsage` and defines `get usage() { return this.finalStep.usage }`. Stream result: `usage` = `finalStep.usage` (`:7842`), `totalUsage` = summed (`:7851`). `LlmService` reads `result.usage` and `streamResult.usage` (`llm.service.ts:152`, `:307`), so **every tool-calling turn (maxSteps 3: human handover) under-counts.** Note: the current ai-sdk.dev docs describe `usage` as "the total token usage of all steps" and `totalUsage` as deprecated. That is a later version's behaviour. Our installed version differs. Trust the source.
2. **Cost must be computed per step, then summed.** Each step is a separately billed API call with its own `steps[i].usage`, `steps[i].providerMetadata` and `steps[i].response.modelId`. Tiered pricing (Gemini 2.5 Pro >200k, Haiku 5.5 >100k) is decided **per request**, so summing tokens first can pick the wrong tier.
3. **`inputTokens` is inclusive of cache reads for every provider we use** (OpenAI, Gemini, Groq, openai-compatible, OpenRouter, and Anthropic through the SDK, which adds cache tokens back in). Bill `noCacheTokens` at the input rate and `cacheReadTokens` at the cached rate. Never bill `inputTokens` at full price **and** add cached on top.
4. **Groq drops `cached_tokens`** (`cacheReadTokens` undefined). Read `usage.raw.prompt_tokens_details.cached_tokens`.
5. **OpenAI drops `cache_write_tokens`** (`cacheWriteTokens` undefined) in @ai-sdk/openai 3.0.67. Read `usage.raw.input_tokens_details.cache_write_tokens` before moving to GPT-5.6+.
6. **OpenRouter `noCacheTokens` does not subtract cache writes.** Compute it yourself.
7. **Gemini `outputTokens` = candidates + thoughts.** Correct for billing, because Google bills thinking at the output rate. `toolUsePromptTokenCount` is dropped.
8. **Reasoning is a subset of output for all providers** in SDK terms (`text = output - reasoning`). Never add `reasoningTokens` on top of `outputTokens`.
9. **The deprecated fields `usage.cachedInputTokens` and `usage.reasoningTokens`** still exist in 6.0.193 (SRC `:2614-2615`) and mirror `cacheRead` / `reasoning`. Prefer `inputTokenDetails` / `outputTokenDetails`.
10. **Actual model under fallback:** `extractActualModel()` reads `providerMetadata.openrouter.model`, which is **not** in the provider's metadata schema (SRC `@openrouter/ai-sdk-provider/dist/index.js`, `OpenRouterProviderMetadataSchema`: `provider`, `reasoning_details`, `annotations`, `usage`). So it always returns the requested model. The served model is in `response.modelId` (SRC `:3815`, `modelId: response.model`). Price by `steps[i].response.modelId`.
11. **Streaming usage can be missing:**
    - `openai-compatible` (Cerebras, Sarvam) without `includeUsage: true` sends no `stream_options`.
    - Any stream that is aborted (our `AI_STREAM_TIMEOUT_MS`, a client disconnect, `abortSignal`) can end before the usage event. OpenAI warns about exactly this, yet the tokens already generated are still billed.
    - `normaliseUsage` turns undefined into 0, so this silently records $0. Record `usage_status = missing` and estimate instead.
12. **Service tier changes the price.** Record `providerMetadata.openai.serviceTier` and `providerMetadata.google.serviceTier` per call. An OpenAI project set to a non-default tier, or `auto`, can change the rate without any code change.

## 4. Other things that make naive `tokens × price` wrong

- **Use the provider-reported counts, never a local tokenizer** (`token-counter.service.ts` is for context budgeting). Provider counts include hidden overhead:
  - Anthropic's tool-use system prompt adds **496 tokens (tool_choice auto/none) or 588 (any/tool) on Haiku 4.5** whenever tools are present (pricing page table).
  - OpenAI and Gemini count tool or function definitions and strict JSON-schema `response_format` as input tokens. That this is "billed as input" is the general convention and is **UNCONFIRMED** in the current OpenAI and Google docs read this session.
  - OpenRouter reports native-tokenizer counts.
- **OpenAI cached counts are rounded down to 128-token multiples** on pre-GPT-5.6 models, so the "uncached" remainder is billed at the full rate.
- **Cache minimums:** a prompt below the minimum gets no discount whatever the key (Gemini 2.5 Flash 2,048; Haiku 4.5 4,096; Groq 128 to 1,024; Cerebras 128-token blocks with no discount anyway).
- **Gemini explicit-cache storage** is a time-based charge billed per cache, not per call. We create none today.
- **Rounding:** no provider documents per-request rounding; they bill aggregated usage. Anthropic's cost report uses decimal cents. **UNCONFIRMED:** exact invoice-level rounding for every provider. Recommendation: store integer token components plus a `price_version` id, and compute cost as a decimal (e.g. `numeric(20,12)` USD, or integer nano-USD). Never round per call. Round only at invoice or aggregate level.
- **Free tiers:** Gemini free tier, Groq or Cerebras free keys, and Sarvam signup credits all bill $0 cash. The ledger needs a per-key tier flag. Otherwise a "computed" cost will not match the real invoice.
- **Failed requests:** a 4xx or 5xx before generation is not billed. A stream cut mid-way is billed for tokens produced. Content-filtered outputs: **UNCONFIRMED** per provider.
- **Data residency / regional uplift:** OpenAI +10% (models released ≥ 2026-03-05 only); Anthropic US geo 1.1× (4.6+); Bedrock and Vertex regional 1.1× for Haiku 4.5, reachable through OpenRouter's default routing.
- **OpenRouter's 5.5% credit-purchase fee** and **Sarvam INR→USD FX** are account-level adjustments.

## 5. Recommended per-call ledger row (derived from the above)

`provider, served_model (response.modelId), step_index, service_tier, input_total, input_uncached, cache_read, cache_write_5m, cache_write_1h, output_total, reasoning, raw_usage (jsonb), usage_status (reported|missing|estimated), price_version, cost_usd (decimal), currency_native, cost_native, fx_rate`.
One row per **step** (per HTTP call), not per `generateText` call. Reconcile monthly against: OpenAI `/v1/organization/costs` (daily) plus `/usage/completions` (per model); Anthropic `cost_report` (daily) and `usage_report`; OpenRouter `/api/v1/generation` per id or the Activity page; Gemini through the Cloud Billing console (BigQuery export: UNCONFIRMED); Groq, Cerebras and Sarvam through their consoles only.

## UNCONFIRMED summary

1. Whether OpenRouter `prompt_tokens` includes `cache_write_tokens` (and `cached_tokens`).
2. Whether OpenRouter accepts the picker id `anthropic/claude-haiku-4-5`. The canonical id is `anthropic/claude-haiku-4.5`.
3. What OpenAI does with `prompt_cache_retention: '24h'` on gpt-4.1-mini (not on the supported list), and whether 24h retention is free.
4. Historical Groq prices for qwen3-32b and llama-3.3-70b-versatile (both now shut down for non-enterprise accounts). Groq Flex pricing. A Groq usage API.
5. Cerebras and Sarvam streaming usage without `stream_options.include_usage`. Cerebras CSV export of cost.
6. Gemini `toolUsePromptTokenCount` billing; whether explicit-cache creation is billed on the Gemini Developer API; whether the final stream chunk is cumulative; BigQuery billing export for Gemini SKUs.
7. Sarvam GST on top of list price; whether `cached_tokens` is a subset of `prompt_tokens`.
8. Exact OpenAI usage-API `group_by=service_tier`; the Anthropic `message_delta` cumulative-output detail (not re-fetched); provider invoice rounding rules; billing of content-filtered outputs.
