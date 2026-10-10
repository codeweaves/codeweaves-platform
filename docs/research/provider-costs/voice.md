# Per-call cost of STT and TTS calls (Sarvam, Deepgram, ElevenLabs)

All web sources were retrieved on **2026-10-10**. I used only official pages from the providers. Anything that no primary source confirms is marked **UNCONFIRMED**. Prices exclude GST and other taxes unless a page says otherwise.

---

## 1. What the repo calls today

Code paths: `apps/api/src/modules/voice/providers/*.provider.ts`, `apps/api/src/modules/voice/voice.service.ts`, `apps/api/src/modules/whatsapp/whatsapp-inbound.service.ts`.

### 1.1 Call inventory

| #   | Provider / model                                       | Endpoint                                                                                                             | Code                                                                   | Used when                                                                                                                                                                                   | What the response gives us today                                                                                                       |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Sarvam STT `saarika:v2.5`                              | `POST https://api.sarvam.ai/speech-to-text` (multipart, `language_code` = mapped hint, or `unknown` for auto-detect) | `sarvam.provider.ts` `transcribe()`                                    | Step 1 of every voice turn without a hint (widget and WhatsApp). Also used when an Indian-language hint routes to Sarvam.                                                                   | `request_id`, `transcript`, `language_code`, `language_probability`, `timestamps`. **No duration field.** No usage headers are parsed. |
| S2  | Sarvam STT `saarika:v2.5` with `language_code=unknown` | same                                                                                                                 | `sarvam.provider.ts` `detectLanguage()`                                | Only through `VoiceService.detectLanguage()`. **No caller exists outside voice.service.ts, so this is dead code today.**                                                                    | same as S1                                                                                                                             |
| S3  | Sarvam TTS `bulbul:v3` (REST)                          | `POST https://api.sarvam.ai/text-to-speech` (`speech_sample_rate` 24000, `mp3`/`wav`)                                | `synthesizeWithCodec()` (used by `synthesize` and `synthesizePreview`) | Batch TTS, WhatsApp voice replies, per-sentence fallback, voice previews                                                                                                                    | `request_id`, `audios[]` (base64). **No character count.**                                                                             |
| S4  | Sarvam TTS `bulbul:v3` WebSocket, one-shot             | `wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3` (`config`, then `text` and `flush`)                          | `synthesizeStream()`                                                   | Per-sentence streaming (Pattern B) with `ttsStreaming=true`                                                                                                                                 | audio chunks and an optional `final` event. **No usage message.**                                                                      |
| S5  | Sarvam TTS `bulbul:v3` WebSocket **session**           | same URL plus `send_completion_event=true`                                                                           | `openSynthesisSession()`                                               | Pattern A: **one WS per voice turn**. Each sentence is sent as `{type:'text'}` then `{type:'flush'}`, and the code waits for `final` before the next sentence. Pings keep the socket alive. | audio chunks and a `final` event per sentence. A summary `SARVAM_TTS_SESSION_*` event_log is written on close.                         |
| D1  | Deepgram STT `nova-3`, pre-recorded                    | `POST https://api.deepgram.com/v1/listen?model=nova-3&language=<hint>&smart_format=true&punctuate=true`              | `deepgram.provider.ts` `transcribe()`                                  | Step 2 when Sarvam detects a non-Indian language, and for a non-Indian hint                                                                                                                 | `metadata.duration` and `metadata.channels` are typed in `DeepgramResponse` but **not read**. `metadata.request_id` is also not read.  |
| D2  | Deepgram `nova-3` `language=multi`                     | same endpoint                                                                                                        | `detectLanguage()`                                                     | Dead code (see S2). It would bill at the **Multilingual** rate.                                                                                                                             | same                                                                                                                                   |
| E1  | ElevenLabs STT `scribe_v2`                             | `POST https://api.elevenlabs.io/v1/speech-to-text`                                                                   | `elevenlabs.provider.ts` `transcribe()`                                | Step 3 fallback when Deepgram fails, or an STT override                                                                                                                                     | Parses `text`, `language_code`, `language_probability`, `words`. **The `audio_duration_secs` field is not read.**                      |
| E2  | ElevenLabs TTS `eleven_turbo_v2_5`, HTTP               | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128` (preview: `opus_48000_32`)    | `synthesizeWithFormat()`                                               | English (non-Indian) TTS, per-sentence (Pattern B), WhatsApp voice replies, previews                                                                                                        | Raw audio bytes. The **`character-cost` and `request-id` headers are not read.**                                                       |
| E3  | ElevenLabs TTS `eleven_turbo_v2_5`, WebSocket          | `wss://api.elevenlabs.io/v1/text-to-speech/{voice}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_24000`  | `synthesizeStream()`                                                   | Per-sentence streaming when `ttsStreaming=true`. The session pattern (A) is **force-disabled for ElevenLabs** (`providerStreamingDisabled`).                                                | `audio`, `isFinal`, `alignment`. No usage field. The code sends `" "` first, then the text, then `""` (EOS).                           |

Deepgram TTS (Aura) is not implemented. `synthesize()` throws.

### 1.2 Calls per visitor turn (important for metering)

- The widget never sends `languageHint` (`apps/widget/src/hooks/useVoice.ts:348`). WhatsApp voice notes do not send one either (`whatsapp-inbound.service.ts:123`). As a result, **every voice turn goes through the auto-detect path** (`voice.service.ts:225-369`), unless the agent has an `sttProvider` override:
  1. **Sarvam STT, `language_code=unknown`, on the full clip.** This is always billed.
  2. If the detected language is not Indian (for example English), **Deepgram nova-3 transcribes the same clip again**. That is **two STT charges for the same audio**.
  3. If Deepgram throws, **ElevenLabs scribe_v2 transcribes it again**. That can be **three STT charges**. A Deepgram request that times out on our side at 10 s can still be billed (**UNCONFIRMED**).
- TTS per reply:
  - **Pattern A (Sarvam, `ttsStreaming=true`)**: one WebSocket per turn. N sentences are sent as N text and flush pairs. If a sentence fails, the code falls back to **batch REST for that sentence** (`voice.service.ts:758`). The sentence can then be billed twice if Sarvam had already processed it on the WebSocket (**UNCONFIRMED**).
  - **Pattern B**: one HTTP request (or one WebSocket) per sentence, in parallel.
  - **Provider fallback** (`ttsFallback`, `synthesizeSentenceWithFallback`) re-synthesises the full text with a second provider. You pay for both if the first one was billed before it failed.
- **Voice previews** (`previewVoice`) call TTS with `agentId: "__preview__"`. They are cached for 1 day, but each cache miss is a billable call that is **not attributable to an org** today.

---

## 2. Sarvam AI (currency INR)

### 2.1 Prices

| Item                                                                  | Price                                                                                       | Source                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Speech to Text (REST, streaming, batch)                               | **₹30 per hour**                                                                            | https://www.sarvam.ai/api-pricing ; https://docs.sarvam.ai/api/getting-started/pricing (2026-10-10)   |
| STT with diarization                                                  | ₹45 per hour (we do not use it)                                                             | same                                                                                                  |
| TTS **Bulbul v3** (REST and streaming)                                | **₹30 per 10K characters** (= ₹3.00 per 1,000 characters = **₹0.003 per character**)        | same. The api-pricing FAQ says the price is the same "for both real-time and streaming usage".        |
| Text Language Identification (a separate text API we do **not** call) | ₹3.5 per 10K characters                                                                     | docs pricing page                                                                                     |
| Credits                                                               | ₹1 = 1 credit. Credits are universal across APIs and never expire. New users get ₹100 free. | https://www.sarvam.ai/api-pricing ; https://docs.sarvam.ai/api-reference-docs/getting-started/pricing |

Model names: the pricing pages do not list a separate price for `saarika:v2.5`, only "Speech to Text". **UNCONFIRMED** that saarika:v2.5 bills at the same ₹30/hr. This is likely, because no other STT rate exists.

### 2.2 Rounding, minimums, surcharges

- STT: "Priced per hour, billed per second." (docs pricing page). The STT FAQ (https://docs.sarvam.ai/api/speech-to-text/faq) says duration is **"Rounded up to the nearest second"** with a **"Minimum charge: 1 second."**
- **STT language detection surcharge: the FAQ says "Language detection (+10%)"** (same FAQ). Our step-1 call sends `language_code=unknown`, so this surcharge **likely applies to every widget and WhatsApp turn**. **Conflict:** the pricing pages list no detection surcharge. The FAQ also says diarization is +20%, while the pricing page shows ₹45 vs ₹30 (+50%). Treat the +10% as **likely but UNCONFIRMED** until you reconcile it against the dashboard.
- Silence: no rule is stated. Billing is on audio duration, so **silence is billed** (inferred, **UNCONFIRMED**).
- TTS: "Rounded to the nearest character." (docs pricing page). No per-request minimum is stated.
- How characters are counted (code points, graphemes, or bytes; whether spaces and punctuation count; whether the count is taken before or after the automatic normalization in bulbul:v3): **UNCONFIRMED**. bulbul:v3 preprocessing is "automatically enabled" (https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert). Assume input characters until reconciliation shows otherwise.
- WebSocket TTS: the docs give no billing rule. Assume the characters in `text` messages are billed, and that `config`, `flush` and `ping` messages are free (**UNCONFIRMED**). The socket closes after 1 minute of inactivity. (https://docs.sarvam.ai/api-reference-docs/text-to-speech/api/streaming)
- REST STT limit: **30 s per request** (FAQ and https://docs.sarvam.ai/api-reference-docs/getting-started/models/saarika). This is not a cost issue, but a longer WhatsApp voice note will fail on this path.
- Deprecation: "Saarika v2.5 will be deprecated soon." The page recommends saaras:v3 or v4. As of June 2026 the endpoint defaults to saaras:v3 when `model` is omitted. (saarika page and https://docs.sarvam.ai/changelog). The REST reference now lists only `saaras:v4` and `saaras:v3` (https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe). bulbul:v3 is "Stable", and bulbul:v4-flash is "recommended for new integrations" (TTS reference). The pricing pages do not list prices for saaras v4 or bulbul v4-flash.

### 2.3 Billable quantity: where to get it

- **STT: the response has no duration field** (REST reference). We must measure the duration ourselves. Decode the uploaded audio on the server (ffprobe, or a pure-JS parser such as `music-metadata`) to get the duration in seconds, then `ceil()`.
  - Caveat: browser `MediaRecorder` WebM often has **no duration in its header**. A header-only probe returns N/A or Infinity. Read the last cluster or block timestamp, or decode the whole clip.
  - WhatsApp voice notes are OGG/Opus. Their duration comes from the last page granule position, which is reliable.
  - The FAQ does not say whether Sarvam measures the duration before or after its own decoding or resampling (**UNCONFIRMED**).
- **TTS: the response has no character count.** Count the characters of the `text` we send, per request or per WebSocket `text` message. Use code points (`[...text].length`) rather than UTF-16 `.length`. For Devanagari both give the same number, because each matra is its own code point. Emoji differ. Which unit Sarvam actually counts is **UNCONFIRMED**.

### 2.4 Formulas

```
STT_cost_INR  = ceil(max(duration_s, 1)) × (30 / 3600) × (1.10 if language_code == 'unknown' else 1.00)
              = ceil(d) × ₹0.0083333  [× 1.10 → ₹0.0091667 /s]
TTS_cost_INR  = chars × (30 / 10_000) = chars × ₹0.003
```

Worked examples:

- 7.4 s clip with auto-detect: ceil = 8 s. 8 × 0.0083333 = ₹0.0667. With the +10% surcharge: **₹0.0733**.
- 7.4 s clip with an explicit hint: **₹0.0667**.
- Reply of 3 sentences, 180 characters total (WebSocket session or REST, same rate): 180 × 0.003 = **₹0.54**.

### 2.5 Reconciliation

- **No documented usage or billing REST API.** Use the dashboard: the usage page at `dashboard.sarvam.ai/usage` (changelog, June 2025), per-API-key usage (changelog, October 2025), and the Billing page, which shows total, consumed and remaining credits (STT FAQ). Sources: https://docs.sarvam.ai/changelog , https://docs.sarvam.ai/api/speech-to-text/faq.
- To split costs per environment, use a **separate API key per environment or per meter** so the per-key dashboard view can reconcile. Rate limits are per account, not per key (https://docs.sarvam.ai/api-reference-docs/ratelimits).
- Store `request_id` from every response for support escalation (also recommended at https://docs.sarvam.ai/api/integration/livekit-production-best-practices).

---

## 3. Deepgram (currency USD)

### 3.1 Prices (https://deepgram.com/pricing, 2026-10-10)

| Item                                                                | Pay As You Go                           | Growth                              |
| ------------------------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| **Nova-3 Monolingual, pre-recorded** (our D1)                       | **$0.0043/min**                         | $0.0036/min                         |
| Nova-3 Multilingual, pre-recorded (`language=multi`, D2, dead code) | $0.0052/min                             | $0.0043/min                         |
| Nova-3 Monolingual, streaming (not used)                            | $0.0048/min (promo, list price $0.0077) | $0.0042/min                         |
| Nova-3 Multilingual, streaming (not used)                           | $0.0058/min (promo, list price $0.0092) | $0.0050/min                         |
| Smart Formatting                                                    | Included                                | Included                            |
| Speaker diarization, pre-recorded                                   | Included                                | Included                            |
| Redaction / Keyterm / Entity detection (not used)                   | $0.0020 / $0.0013 / $0.0017 per min     | $0.0017 / $0.0012 / $0.0017 per min |
| Aura-2 TTS (not used)                                               | $0.030 per 1K characters                | $0.027 per 1K characters            |

- `punctuate=true` is not listed as a paid add-on. Treat it as free (**UNCONFIRMED** in writing).
- Language detection has no separate price. Detection is part of the Multilingual model. We pass a concrete `language`, so we pay the Monolingual rate.
- Growth plan: "requires a commitment (starting at $4k/year)". New accounts get $200 free credit. Pay As You Go: "No minimums. No expiration." (pricing page FAQ)

### 3.2 Rounding and minimums

- "Deepgram uses true per-second billing. If your audio file is 14 seconds long, you pay for exactly 14 seconds." (pricing FAQ). No per-request minimum is stated.
- Whether fractional seconds are billed exactly or rounded to the nearest second: **UNCONFIRMED**. The FAQ's "per-second" example uses a whole number. The `/requests` sample shows `duration: 30` with `usd: 0.0075` (an older rate).
- Multichannel: "a 10-minute file with 2 channels (stereo) … billed for 20 minutes". We do not send `multichannel=true`, so a stereo upload should be billed once. Whether Deepgram downmixes or bills per channel without `multichannel` is **UNCONFIRMED**. Browser and WhatsApp audio is mono in practice.
- Silence is billed, because billing is on audio duration.
- Failed or timed-out requests: the Requests API records `status` (succeeded or failed). Whether failed requests are billed is **UNCONFIRMED**.

### 3.3 Billable quantity: where to get it

- The response field **`metadata.duration`** (double, required) is shown as seconds in the example (`25.933313`) (https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded). The unit is not stated in the reference, but the example shows seconds. **`metadata.channels`** gives the channel count. **`metadata.request_id`** gives the per-request key for exact lookup later.
- To get an exact charge per request, call `GET /v1/projects/{project_id}/requests/{request_id}`. It returns `response.details.duration`, `total_audio`, `channels`, `usd`, and `tier` (https://developers.deepgram.com/reference/manage/requests/get). The reference does not define `usd`. It appears to be the request cost (**UNCONFIRMED** semantics).

### 3.4 Formula

```
cost_USD = metadata.duration_s × metadata.channels(=1) × (0.0043 / 60)      # PAYG, nova-3 monolingual, pre-recorded
         = duration_s × $0.000071667
```

Example: 7.4 s clip → 7.4 × 0.000071667 = **$0.000530**. On Growth: 7.4 × 0.0036/60 = $0.000444.

### 3.5 Reconciliation APIs

- `GET /v1/projects/{project_id}/requests`: per-request list. Filters: `start`, `end`, `limit` (≤1000), `page`, `request_id`, `endpoint`, `method`, `status`. Each item has `response.details.usd` and `duration`. (https://developers.deepgram.com/reference/manage/requests/list)
- `GET /v1/projects/{project_id}/requests/{request_id}`: one request (see above).
- `GET /v1/projects/{project_id}/usage/breakdown`: `start`/`end` (YYYY-MM-DD), `grouping` ∈ {accessor, endpoint, feature_set, models, method, tags, deployment}, plus feature filters. Results have `hours`, `total_hours`, `requests`, `tts_characters`, and a daily `resolution`. (https://developers.deepgram.com/reference/manage/usage/breakdown/get.md)
- `GET /v1/projects/{project_id}/usage`: summary with filters (https://developers.deepgram.com/reference/manage/usage/get).
- `GET /v1/projects/{project_id}/balances`: `amount` and `units` (USD) (https://developers.deepgram.com/reference/manage/billing/list).
- The `tag` filter exists on usage endpoints. Sending a `tag=<orgId>` query param on `/v1/listen` would let usage be grouped per org on Deepgram's side. The `tag` request parameter is not re-verified here (**UNCONFIRMED**).

---

## 4. ElevenLabs (currency USD)

### 4.1 Prices: current API pricing (https://elevenlabs.io/pricing/api, 2026-10-10)

FAQ, quoted: **"API usage is billed in US dollars, not credits."**

| Item                                                   | Price                                                                          | Notes                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTS **Flash / Turbo** (covers our `eleven_turbo_v2_5`) | **$0.04 per 1,000 characters**                                                 | The included quantity per plan equals the plan price ÷ $0.04. For example, Starter $6 → 150K characters and Pro $99 → 2,475K characters. The rate is the **same on every tier**. |
| TTS v2 Multilingual / v3                               | $0.08 per 1K characters                                                        | not used                                                                                                                                                                         |
| TTS v4 / v4 Turbo                                      | $0.08 / $0.04 per 1K characters (promo $0.022 / $0.011 "72% off until Oct 12") | not used                                                                                                                                                                         |
| STT **Scribe v2** (batch, our E1)                      | **$0.22 per hour**                                                             | Keyterm +$0.05/hr and transcript editing +$0.07/hr. We use neither.                                                                                                              |
| STT Scribe v2 Realtime                                 | $0.39 per hour                                                                 | not used                                                                                                                                                                         |
| Plans                                                  | Free $0, Starter $6, Creator $22, Pro $99, Scale $299, Business $990 per month | Usage beyond a plan's included amount: the page says "Pay only for what you use" for PAYG. It states no separate overage rate (**UNCONFIRMED** whether overage = list rate).     |

FAQ "How is usage metered?": "Text to Speech is billed per character. Speech to Text is billed per audio minute."

**Legacy credit pricing (check which one our account is on).** The PAYG blog (https://elevenlabs.io/blog/weve-lowered-api-agents-pricing-and-introduced-pay-as-you-go, published 2026-05-07, updated 2026-09-28) says existing customers must click "Switch to new pricing" under Manage subscription, or upgrade, to move to the new pricing. On the legacy model (https://elevenlabs.io/pricing):

- Plans grant credits: Free 10K, Starter 30K, Creator 121K, Pro 600K, Scale 1.8M, Business 6M.
- Flash/Turbo cost "between 0.5 and 1 credit per character". Multilingual v2 costs 1 credit per character. STT costs 330 credits per minute.
- Our code comment ("0.5 credits/char on the free tier") reflects this legacy model.
- On legacy pricing, the effective $/character = plan price ÷ credits × credits/char. Example: Starter at 0.5 credits/char = $6/30K × 0.5 = **$0.10 per 1K characters**, versus $0.04 on the new pricing.
- The exact Turbo credit multiplier per plan: **UNCONFIRMED**.

### 4.2 Rounding, minimums, counting rules

- TTS character counting: the help article "How is character length calculated?" (https://help.elevenlabs.io/hc/en-us/articles/49101802985105) says every letter, number, punctuation mark and space counts. **SSML and audio tags count.** Pronunciation dictionaries can change the count. The page is Cloudflare-blocked for direct fetch, so this was read from the search-engine render of the official article. Treat as **confirmed by an official source, but not re-fetched**.
- Text normalization (`apply_text_normalization`, default `auto`): the billed count appears to be based on the input text, not the normalized text (**UNCONFIRMED**). The `character-cost` header settles it per request.
- WebSocket (`stream-input`): the docs say nothing about billing. The required initial `" "` message: whether that 1 character is billed is **UNCONFIRMED**. Expect cost ≈ the characters of all `text` frames. The empty EOS `""` frame is 0 characters. (https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)
- STT: no per-request minimum is stated for base Scribe. Minimums apply only to add-ons:
  - Transcript editing: 10 s minimum.
  - More than 100 keyterms: 20 s minimum.
  - Realtime: "at least 10 seconds of audio per committed transcript".
  - Files must be at least 100 ms. (https://elevenlabs.io/docs/api-reference/speech-to-text/convert ; search render of https://elevenlabs.io/docs/overview/capabilities/speech-to-text)
- STT rounding (per second or per minute): **UNCONFIRMED**. The page says "billed per audio minute", but the price is quoted per hour.
- STT surcharges we do not use: multichannel bills each channel at the full duration; speaker roles add 10%; transcript editing adds 30% (reference page). `tag_audio_events` defaults on and has no listed charge.

### 4.3 Billable quantity: where to get it

- **TTS over HTTP: response header `character-cost`.** The docs section "Tracking generation costs" says: `response.headers.get("character-cost")`, together with `request-id` and `x-trace-id` (https://elevenlabs.io/docs/api-reference/introduction).
  - The markdown copy of the same page shows `x-character-count` instead. Read both and log whichever is present.
  - Whether the header value is characters or credits under legacy pricing: **UNCONFIRMED**. Verify with one live call and compare against `/v1/history`.
- **TTS over WebSocket: no usage field** in any server message (`audio`, `isFinal`, `alignment`, `normalizedAlignment`). Count `[...text].length` of what we send. `alignment.chars` lists the characters of the original text, so its length is a cross-check (**UNCONFIRMED** as the billed count).
- **STT: response field `audio_duration_secs`** ("The duration of the audio that was transcribed in seconds") (https://elevenlabs.io/docs/api-reference/speech-to-text/convert). Our `ElevenLabsSTTResponse` type does not declare it yet.

### 4.4 Formulas

```
TTS_cost_USD (new USD pricing)   = character_cost_header × (0.04 / 1000) = chars × $0.00004
TTS_cost_USD (legacy credits)    = chars × credits_per_char(model, plan) × (plan_price_USD / plan_credits)
STT_cost_USD                     = audio_duration_secs × (0.22 / 3600) = secs × $0.0000611
```

Examples:

- 120-character sentence on Turbo v2.5: 120 × 0.00004 = **$0.0048**. On legacy Starter at 0.5 credits/char: 120 × 0.5 × 6/30000 = **$0.012**.
- 7.4 s Scribe v2 fallback: 7.4 × 0.0000611 = **$0.000452**.

### 4.5 Reconciliation APIs

- `POST /v1/workspace/analytics/query/usage-by-product-over-time`: the current endpoint (changelog 2026-04-20). It takes `interval_seconds`, `group_by` and filters, and returns credit usage by product. The full body schema was not fetched (**UNCONFIRMED** fields). The API key needs Workspace Analytics access. (https://elevenlabs.io/docs/api-reference/workspace/usage/get-usage-by-product-over-time)
- `GET /v1/usage/character-stats` (**deprecated**, still documented). `start_unix` and `end_unix` are in milliseconds. `breakdown_type` includes `api_keys`, `model`, `product_type`, `request_source`. `aggregation_interval` is hour, day, week, month or cumulative, or set `aggregation_bucket_size` in seconds. `metric` is one of credits, tts_characters, minutes_used, request_count, **fiat_units_spent**, and others. (https://elevenlabs.io/docs/api-reference/usage/get)
- `GET /v1/history`: per-generation items with `character_count_change_from` and `character_count_change_to`, `model_id`, `source`, `request_id`, `date_unix`. Filters: `date_after_unix`, `date_before_unix`, `source`, `model_id`. It covers TTS. Whether it covers STT is unclear. With `enable_logging=false` (zero retention) items may be missing (**UNCONFIRMED**). (https://elevenlabs.io/docs/api-reference/history/list)
- Dashboard: Developers → analytics tab (pricing FAQ).

---

## 5. Recommended metering design (summary)

Record one row per provider call, keyed by the provider `request_id`. Fields:

- `provider`, `model`, `endpoint` (rest / ws / ws-session)
- `billable_unit` (seconds or characters) and `billable_qty`, taken from the best available source:

| Provider                       | Best source of the billable quantity                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Deepgram                       | `metadata.duration` × `channels`                                                               |
| ElevenLabs STT                 | `audio_duration_secs`                                                                          |
| ElevenLabs TTS (HTTP)          | `[...text].length` (the `character-cost` header is credits, see open question 7)               |
| ElevenLabs TTS (WebSocket)     | `[...text].length` summed over text frames                                                     |
| Sarvam STT                     | ceil of the server-side decoded duration. Flag `language_code=unknown` for the +10% surcharge. |
| Sarvam TTS (REST or WebSocket) | `[...text].length` per text message                                                            |

- Also store `unit_price` with its currency and a price-table version. Convert INR to USD at a stored daily FX rate.
- Also store `orgId`, `agentId`, `sessionId`, `turnId`, and `reason` (`auto-detect-step-1`, `english-step-2`, `fallback`, `preview`). That makes the two- and three-call turns and the fallback double-charges visible.
- Reconcile monthly against:
  - Deepgram `/requests` and `/usage/breakdown`
  - ElevenLabs analytics or `/v1/history`
  - Sarvam dashboard per-key usage (no API)

---

## 6. UNCONFIRMED items (verify with a live call, the dashboard, or support)

1. Sarvam's STT +10% "Language detection" surcharge for `language_code=unknown`. It is in the FAQ but not in the pricing tables, and the FAQ's diarization figure also conflicts with the pricing table.
2. Whether Sarvam saarika:v2.5 bills at ₹30/hr. The pricing pages name no model. The model is also slated for deprecation.
3. How Sarvam counts TTS characters: code points or graphemes, and before or after automatic normalization. Also whether WebSocket `config`, `flush` and `ping` messages are billed.
4. Whether Sarvam bills on its own decoded duration or the container duration. Whether silence is billed (assumed yes).
5. Deepgram fractional-second handling. Whether failed or timed-out requests are billed. Whether stereo without `multichannel` is billed per channel. The semantics of `details.usd`. The `tag` request param for per-org usage.
6. ElevenLabs: whether our account is on the new USD API pricing or legacy credits, and the Turbo credits/char multiplier per plan on legacy. Overage rate beyond plan inclusion.
7. ~~ElevenLabs header name (`character-cost` vs `x-character-count`) and whether it reports characters or credits.~~ Answered 2026-10-10 by a live call: `character-cost` reports **credits**. An 80-character `eleven_turbo_v2_5` reply returned 40 (0.5 credits per character). We bill the characters sent instead, because the price list is USD per character.
8. Whether the ElevenLabs WebSocket initial `" "` is billed. Whether the WebSocket bills input characters or normalized characters.
9. ElevenLabs STT rounding (per second vs per minute).
10. Whether ElevenLabs `/v1/history` includes STT, and whether it includes zero-retention requests. The request body schema of the new workspace analytics endpoint.
11. Whether an aborted or timed-out call (our 10 s or 15 s `AbortSignal`) is still billed by any provider.
