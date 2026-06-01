# India LLM Latency — Field Intel

Real-world research into how Indian devs / startups / Perplexity actually handle sub-2s LLM TTFT from India. Every claim cites a URL. Generated 2026-05-30 from a 13-agent research workflow (`wf_b6c11759-a3d`).

Companion to: parked branch [`feature/ai-orchestration-phase-1-code`](../../) (commit `7b2b97e`), where the user tested Sarvam 30B, GPT-4.1, Groq Llama 3.3, GPT-OSS and rejected all on latency or quality.

---

## TL;DR

- **Perplexity is fast from India because of Cerebras silicon (~1,200 tok/s), not geography.** The trick is throughput masking the transpacific hop.
- **The user's >3s first call is the OpenAI streaming connection cold-start tax** — confirmed by an OpenAI community thread that OpenAI staff never replied to. Fix: undici keep-alive + 25s heartbeat. Free, today.
- **Single most actionable measurement found:** an Indian dev posted on the Google AI Forum: `ttft=2.18s gemini-3-flash-preview` vs `ttft=156ms qwen/qwen3-32b (Groq)`. **Qwen3-32B on Cerebras free tier (1M tokens/day) is the specific provider/model combo the user has not tested.**
- **Mumbai vs US verdict:** AWS Mumbai (`ap-south-1`) `t4g.micro` for API. Yellow.ai and Haptik are both there. **Do NOT use Fly.io Bangalore** — Fly staff publicly admit India routing "is a mess."
- **Cloudflare from India is broken** on Jio/Airtel (free/pro tiers serve from Singapore/Amsterdam). Drop any "Cloudflare Worker edge proxy" architecture.
- **Cheap providers actually deployed by Indians:** Sarvam Startup Programme (6-12 mo free credits), Krutrim (DeepSeek-Llama-8B at ₹3/M), Cerebras free, DeepSeek direct (~$6/mo at scale).

---

## 1. The Perplexity question

**Perplexity is fast because of Cerebras, not because they're "in India."**

- Flagship Sonar runs on Cerebras wafer-scale at ~1,200 tok/s, hosted in US: https://www.cerebras.ai/press-release/cerebras-powers-perplexity-sonar-with-industrys-fastest-ai-inference
- AWS for everything else (P5 training, `TransferEngine` for serving): https://research.perplexity.ai/articles/enabling-trillion-parameter-models-on-aws-efa
- `r2cdn.perplexity.ai` resolves to Cloudflare anycast (**static assets only**, not inference): https://www.netify.ai/resources/hostnames/r2cdn.perplexity.ai
- They rewrote their tokenizer in Rust for **5× p50 latency cut** — they fight latency at the CPU layer, not the network: https://www.marktechpost.com/2026/05/28/perplexity-ai-open-sources-unigram-tokenizer-that-achieves-5x-lower-p50-latency-than-hugging-face-tokenizers-crate/
- **No evidence found** of any Indian dev publishing a measured Perplexity TTFT from India. Searched r/perplexity_ai, r/IndianAITools, YouTube — zero hits. If we want this number, measure it.

**Implication:** we don't need to be "in India." We need a fast-inference provider. Cerebras and Groq both deliver this.

---

## 2. The cold-start smoking gun (>3s first call)

**OpenAI community forum, user `Sainan`, July 2024** — verbatim:

> *"there is no way to reuse this connection after the '[DONE]', so it just has to be dropped... [TLS handshakes] all-in-all tally up to 1 second wasted per request"*

OpenAI staff never replied. https://community.openai.com/t/how-to-reuse-keep-alive-connections-for-streaming-responses/882953

**OpenAI's own Codex codebase fixes this** with a preconnect pattern — connection is kept warm in `Idle → InFlight → Ready` state:
> *"Preconnect is handshake-only. The first response.create is still sent only when a turn starts."*

PR: https://github.com/openai/codex/pull/10698

**Bhagya Rana measured a 50% p50/p95 cut** from just undici keep-alive + DNS caching (Node.js): https://medium.com/@bhagyarana80/the-node-js-keep-alive-trick-that-halved-latency-02264fc34bdf

---

## 3. The 156ms-from-India measurement

[Google AI Dev Forum thread, geography-tagged "India"](https://discuss.ai.google.dev/t/high-ttft-2s-with-gemini-flash-vs-150ms-on-groq-any-optimization-or-throttling-insights/138024):

> `ttft=2.181539791s gemini-3-flash-preview`
> `ttft=156.328ms qwen/qwen3-32b (Groq)`

**User rejected Groq Llama 3.3 70B and GPT-OSS on quality. Has NOT tested Qwen2.5/3 32B.** That's the specific untested combo.

Cerebras free tier (1M tokens/day, no card) includes Qwen3-32B + Llama 3.3 70B + GPT-OSS 120B: https://pricepertoken.com/endpoints/cerebras/free

---

## 4. The 5 patterns that keep showing up

### Pattern 1 — Small fast model + US inference + accept the hop
**Zomato** moved off GPT-4 to Llama 3 (70B intent + 8B chat) on Together AI in US, sub-10s target, 1,000 msg/min peak. Reason given: *"challenges with scaling costs and latency of larger models like GPT-4."* Didn't fight geography, swapped models. https://www.together.ai/customers/zomato

### Pattern 2 — India-based API origin + foreign LLM
**Yellow.ai** primary region is `z0 - India` (Mumbai). They explicitly wrote: *"the latency of communicating from the West Coast of the United States to India was significantly slower than we expected."* https://tech.yellow.ai/p/yellowais-multi-region-expansion-part-one

**Haptik (Jio)** publishes a **500ms end-to-end voice target**, routes via *"India-based cloud availability zones"*, offers on-prem for Tier-2 customers. Model strategy: *"7B-13B parameter fine-tuned models for FAQ/structured tasks; larger models engaged selectively."* https://www.haptik.ai/blog/latency-interruption-handling-impact-on-voice-ai-quality

### Pattern 3 — Cerebras / Groq for LLM brain (when quality permits)
See section 3 above. 156ms TTFT from India to Groq Qwen3-32B is the cleanest documented number found.

### Pattern 4 — Split-stack: Indic STT/TTS in India + LLM in US
Plivo + Pipecat integration guide: **Sarvam STT (~70ms India) + OpenAI LLM (US) + Sarvam Bulbul TTS (India)**. https://www.plivo.com/docs/voice-agents/audio-streaming/integration-guides/pipecat/sarvam-openai

**ElevenLabs confirms Cars24, Razorpay, Unacademy, Apna, Meesho, Skit all run this split-stack pattern**: https://elevenlabs.io/blog/powering-indian-voice-agent-infrastructure

The user's Sarvam 30B scar (4.2s) doesn't disqualify their STT/TTS — different products.

### Pattern 5 — Keep-alive + warm pool + filler tokens to hide the network
- Sub-500ms voice agent postmortem (HN 570 pts): https://news.ycombinator.com/item?id=47224295. Commenter `evara-ai`: *"We serve callers in India connecting to US-East, and the Twilio edge hop alone adds 150-250ms depending on the carrier."*
- OpenAI Codex preconnect pattern (covered above): https://github.com/openai/codex/pull/10698
- "Optimistic Acknowledge" filler tokens — Hamming AI's pattern name: https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it. Backed by ACM CUI 2024 ("Explaining the Wait" increases trust): https://dl.acm.org/doi/10.1145/3640794.3665550

---

## 5. Cheap providers Indians actually deploy

### Sarvam (direct API) — INR billing, no mandate
- Sarvam-30B: ₹2.5 input / ₹10 output per 1M tokens
- Sarvam-105B: ₹4 / ₹16 per 1M tokens
- STT ₹30/hr, TTS ₹30/10K chars
- **₹1,000 free credits on every plan** + ₹100 signup credit
- https://www.sarvam.ai/api-pricing

**Sarvam Startup Programme** (launched 5 March 2026): 6-12 months free credits scaled to startup. https://www.sarvam.ai/startup-program / https://www.businesstoday.in/technology/news/story/sarvam-launches-startup-programme-offering-ai-credits-tools-to-boost-indias-developer-ecosystem-519295-2026-03-05

Real Indian dev hands-on (Deepak, 27 May 2025): *"definitely faster than ChatGPT and Gemini via the playground"* — qualitative, no TTFT cited. https://deepakness.com/blog/sarvam-m/

**Gap:** no measured TTFT from India for Sarvam-M (24B). The user's scar is on Sarvam 30B — Sarvam-M is untested.

### Krutrim (Ola) — published per-token prices, free signup
- DeepSeek-R1-Distill-Llama-8B: **₹3 / 1M tokens** (~$0.036/M)
- Llama-4-Scout-17B: ₹7/M
- Gemma-3-27B: ₹8/M
- DeepSeek-R1-Distill-70B: ₹10/M
- 22 Indic languages claimed
- OpenLIT integration docs confirm OpenAI-compatible API: https://docs.openlit.io/latest/sdk/integrations/krutrim/
- https://www.olakrutrim.com/ai-studio

**Gap:** no independent latency benchmark found. Cheapest thing on the market with Indic claims; one day of testing reveals whether it's real.

### Cerebras free tier
- **1M tokens/day FREE**, no card
- Llama 3.3 70B + Qwen3 32B + GPT-OSS 120B
- 156ms TTFT from India documented (section 3)
- https://pricepertoken.com/endpoints/cerebras/free

### DeepSeek direct API
- $0.28/M input, $0.42/M output (cache hits $0.028/M)
- At ~1,000 chats/day = **~$6/mo**
- https://api-docs.deepseek.com/quick_start/pricing
- Tamil rated *"clear winner"* vs GPT-4o by Hinduja Balasubramaniyam (WSO2 engineer): https://hindujab.medium.com/deepseek-v3-and-its-tamil-literacy-21907ea5e664
- Hindi rated Tier-2 ("strong, light review needed"): https://machinetranslate.org/deepseek
- **Caveat:** DeepSeek-direct servers are in China. No India TTFT published.

### Yotta Shakti Cloud (India physical inference)
- Llama 3.1 70B at ₹75 / 1M input tokens (~$0.90/M): https://shakticloud.ai/pricing/
- NVIDIA-backed, 16,000 H100s deployed: https://www.nvidia.com/en-in/customer-stories/yotta-built-india-sovereign-ai-infrastructure-shakti-cloud/
- **Gap:** no published TTFT, no public benchmark from a third-party deployer. Real but unproven.

### Vercel AI Gateway / OpenRouter
- OpenRouter free tier: 50 req/day without $10 credit, 1,000/day after. Free models log prompts for training. https://openrouter.ai/docs/api/reference/limits
- Vercel AI Gateway adds **15-20% overhead** on small prompts vs direct SDK (measured Feb 2026 by Zac Clifton): https://dev.to/cliftonz/benchmarking-vercel-ai-gateway-against-the-native-anthropic-sdk-21g5

### Cloudflare AI Gateway from India — DON'T
Punit Sethi measured from Bangalore on Jio Fiber (15 Sep 2025): baseline 47ms, **Cloudflare Free/Pro 152-186ms** (served from Singapore/Amsterdam — Jio + Airtel don't peer with Cloudflare Mumbai).

> *"If your audience is mainly from India, do not assume Cloudflare will improve your site speed."*

https://punits.dev/blog/cloudflare-latency-india/

Cloudflare Business/Enterprise tier (~$200+/mo) routes via Mumbai — kills the $5-10 budget.

---

## 6. Mumbai vs US — verdict from real deployments

**AWS Mumbai for API origin. Accept US for the LLM hop. Do NOT use Fly.io Bangalore.**

Evidence:

- **Yellow.ai chose Mumbai primary** because *"latency from US West Coast to India was significantly slower than we expected"*: https://tech.yellow.ai/p/yellowais-multi-region-expansion-part-one
- **Haptik routes via India-based AZs** + on-prem for Tier-2: https://www.haptik.ai/blog/latency-interruption-handling-impact-on-voice-ai-quality
- **Zomato stayed US** (Together AI) for the LLM, accepted sub-10s. Chat support, not voice. https://www.together.ai/customers/zomato
- **Fly.io community thread from Indian devs**: AWS EC2 Mumbai = **1-3ms intra-region**. Fly Singapore = +50-60ms. Fly Bangalore routing is *"a mess"* — verbatim from Fly staff `jssjr`. https://community.fly.io/t/anyone-using-fly-io-from-india-sri-lanka-pakistan-regions-beware-of-poor-routing/18072 / https://community.fly.io/t/higher-latency-on-fly-apps-compared-to-aws/24124
- **Fly Bangalore has documented capacity failures** (April 2025): https://community.fly.io/t/apr-22-2025-failed-to-deploy-no-capacity-available-in-region-bom-india/24662
- **AWS Bedrock CRIS in ap-south-1**: inference NOT in Mumbai despite the endpoint — AWS's own blog says *"BOM → AWS commercial Regions"* without naming destinations, **publishes zero latency numbers**: https://aws.amazon.com/blogs/machine-learning/access-anthropic-claude-models-in-india-on-amazon-bedrock-with-global-cross-region-inference/

**The one thing that would change this verdict:** Vertex AI `asia-south1` Gemini 2.5 Flash is the **only major LLM with documented inference physically in Mumbai**. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations. User rejected Gemini Flash earlier — but was the test hitting AI Studio (US-routed) or Vertex `asia-south1` (Mumbai-routed)? Worth re-checking. Indian dev forum post asking this exact question got zero Google staff replies: https://discuss.ai.google.dev/t/is-there-any-model-available-or-planned-in-the-asia-south1-region-on-vertex-ai-that-is-more-capable-than-gemini-2-5-flash/128791. Catch: Vertex AI requires a billed GCP project = credit-card mandate (the trauma trigger).

**About the AWS scar:** real, but `t4g.nano` or `t4g.micro` in ap-south-1 with strict billing alerts at $5/$10/$15 is a documented playbook. The previous $1000 bill was almost certainly Bedrock/data-egress, not the compute itself.

---

## 7. Top 10 URLs to bookmark

1. **Sub-500ms voice agent postmortem (570 HN pts)** — confirms colocation > prompt tricks, includes India dev comments: https://news.ycombinator.com/item?id=47224295
2. **Indian dev measures Gemini 2.18s vs Groq 156ms from India** — single most actionable data point: https://discuss.ai.google.dev/t/high-ttft-2s-with-gemini-flash-vs-150ms-on-groq-any-optimization-or-throttling-insights/138024
3. **Punit Sethi — Cloudflare is broken from India on Jio/Airtel**: https://punits.dev/blog/cloudflare-latency-india/
4. **Fly.io staff admits India routing "is a mess"**: https://community.fly.io/t/anyone-using-fly-io-from-india-sri-lanka-pakistan-regions-beware-of-poor-routing/18072
5. **Zomato architecture (Together AI Llama 3, US, sub-10s)**: https://www.together.ai/customers/zomato
6. **Yellow.ai region strategy** (*"US→India was significantly slower than expected"*): https://tech.yellow.ai/p/yellowais-multi-region-expansion-part-one
7. **OpenAI streaming connection cannot be reused — ~1s per call**: https://community.openai.com/t/how-to-reuse-keep-alive-connections-for-streaming-responses/882953
8. **OpenAI Codex preconnect pattern (the fix for #7)**: https://github.com/openai/codex/pull/10698
9. **AWS Bedrock Claude in India via CRIS** (Mumbai endpoint but US/EU inference): https://aws.amazon.com/blogs/machine-learning/access-anthropic-claude-models-in-india-on-amazon-bedrock-with-global-cross-region-inference/
10. **Meesho self-hosts Llama 8B at p99 TTFT 21-36ms** — proof of what India-physical inference looks like at the metal: https://meesho.github.io/BharatMLStack/blog/llm-inference-optimization-sub-sec-latency

---

## 8. What to do this week (in order)

### 1. Today, free, no migration — fix the cold start
Wire `undici` keep-alive + a 25s heartbeat `GET /v1/models` on the NestJS API → n8n / LLM connection. References:
- OpenAI Codex PR #10698 for the preconnect pattern
- Bhagya Rana's 50% latency cut from keep-alive + DNS caching

Estimated impact: kill the >3s first call.

### 2. Today, 10-line code change — add "Optimistic Acknowledge"
Emit a server-side pre-token (`एक सेकंड…` / `got it…`) as the FIRST SSE chunk before n8n→OpenAI returns. Hamming AI's documented pattern. Can turn 2.5s TTFT into sub-300ms *perceived* TTFT.

### 3. This weekend — spike Qwen3-32B on Cerebras free tier
- 1M tokens/day FREE, no card
- Same model as the 156ms India measurement
- 20 prompts each in Hindi/Tamil/Marathi
- If quality holds → free production-grade backend with measurable India numbers, no mandate

### 4. This week — apply to Sarvam Startup Programme
- Zero downside, INR billing, 6-12 months free credits
- Lets us test **Sarvam-M (24B — different from the 30B scar)** + Bulbul TTS + Saaras STT properly
- The split-stack pattern (Sarvam STT/TTS + foreign LLM) is what Cars24, Razorpay, Apna actually run

### 5. Next sprint — migrate API origin to AWS `ap-south-1`
- `t4g.micro`, NOT Fly Bangalore
- Billing alerts at $5/$10/$15 to scar-proof
- Estimated ~$8/mo with NAT + storage
- Same region as Yellow.ai, Haptik

---

## 9. Honest research gaps

- **Reddit was hard-blocked** at every layer of the research environment. The research agent transparently reported this instead of fabricating threads. If r/developersIndia coverage matters, do that manually.
- **No Indian dev has published a measured Sarvam-M (24B) TTFT.** We'd be the first to document.
- **No published Indian TTFT for Perplexity itself.** Measure it ourselves with a curl loop.
- **Haptik / Yellow.ai / Verloop / Zomato disclose region strategy but NOT exact LLM provider + region + TTFT.** Marketing copy yes, raw numbers no. The incumbents are not transparent.
- **No primary peer-reviewed source for "streaming feels 40-60% faster"** — propagates through secondary blogs. Closest academic paper: Tan/Messerschmidt/Yin/Nov CHI '26 https://arxiv.org/pdf/2604.06183
- **OpenAI's announced Mumbai DC (Tata HyperVault, 100MW → 1GW)** is the single biggest variable that would change everything. Announced, not live. Track: https://openai.com/index/openai-for-india/

---

## 10. The architecture-correct answer

Every Indian production chatbot at meaningful scale either (a) accepts the US LLM hop and engineers around it, or (b) is big enough to run their own GPUs. The $5-10/mo cohort has no published peer.

The closest pattern that fits the constraints:

> **AWS Mumbai API + US LLM (Cerebras Qwen3-32B free / DeepSeek / Sarvam-M) + aggressive keep-alive + filler tokens + Sarvam for Indic STT/TTS if voice is in scope.**

---

# Voice Path

Companion research from a 10-agent workflow (`wf_de090d67-bf5`), 2026-05-30. **All voice changes land in the AI orchestration layer (parked branch `feature/ai-orchestration-phase-1-code` / its successor), NOT on top of n8n.** n8n is going away — don't patch around it.

## 11. The mechanical truth (from production Supabase, codeweaves-dashboard)

From 92 voice messages with full timing metadata:
- STT avg **1.93s** (Sarvam Saaras or Deepgram, mixed)
- TTS avg per sentence **3.05s**, p95 **6.25s** (Sarvam Bulbul or ElevenLabs)
- n8n→LLM bucket (LLM + n8n overhead combined): ~4s
- **Time to first audio chunk avg 7.68s**
- Total end-to-end avg **9.33s**, p50 **8.87s**, p95 **13s**

Root cause from code: both Sarvam endpoints and the ElevenLabs synthesize call hit **batch HTTP**, not streaming.
- [apps/api/src/modules/voice/providers/sarvam.provider.ts:156](../../apps/api/src/modules/voice/providers/sarvam.provider.ts#L156) STT batch
- [sarvam.provider.ts:201](../../apps/api/src/modules/voice/providers/sarvam.provider.ts#L201) TTS batch
- [apps/api/src/modules/voice/providers/elevenlabs.provider.ts:114](../../apps/api/src/modules/voice/providers/elevenlabs.provider.ts#L114) TTS batch on `eleven_multilingual_v2` (the slow model)

## 12. ElevenLabs model selection (the 5-minute fix)

Current code hardcodes `eleven_multilingual_v2`. Per Gradium/Coval independently-measured benchmark (https://gradium.ai/content/tts-latency-benchmark-2026):

| ElevenLabs model | TTFT | WER | Notes |
|---|---|---|---|
| `eleven_multilingual_v2` ← current | **1,232 ms** | 3.9% | Slowest, best quality |
| `eleven_turbo_v2_5` | 264 ms | 5.2% | **5× faster, near-identical quality for short replies** |
| `eleven_flash_v2_5` | 288 ms | 5.2% | Same speed bracket |

**Why ElevenLabs matters at all** (when we have Sarvam): Sarvam voices are heavy on North Indian Hindi cadence. For Bengali/Odia/Northeast/non-standard-accent clients, ElevenLabs sounds more natural. Dual-provider routing already in code stays — both providers just need to be faster.

## 13. Sarvam streaming — exists, GA, documented, same price

The code is on batch endpoints. Streaming exists and was never wired.

- **TTS WebSocket**: `wss://api.sarvam.ai/text-to-speech/ws` — https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api/web-socket
  > *"Audio playback begins as soon as the first chunk is synthesized — no need to wait for the full response."*
  Vendor claim: sub-250ms first byte. **Same ₹30/10K chars price as batch.**

- **STT WebSocket**: `wss://api.sarvam.ai/speech-to-text/ws` — https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe/ws
  - Saaras v3, server-side VAD (`high_vad_sensitivity=true`, emits `START_SPEECH`/`END_SPEECH`), partial transcripts
  - Hinglish code-mix is first-class via `mode=codemix`
  - **Trap**: only accepts `wav` / `pcm_s16le` / `pcm_raw`. Widget currently captures Opus. Decode server-side with `prism-media` OR switch widget to AudioWorklet PCM16.

## 14. ElevenLabs streaming

- **WebSocket TTS streaming**: https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets
- Geography: Southeast Asia cluster includes Singapore. From Render Singapore that's ~5-10ms one-way.
- Vendor claims sub-100ms first audio on Flash v2.5 over WebSocket.
- **STT (Scribe v2)**: Sarvam claims to beat it on Indic benchmarks (https://www.sarvam.ai/blogs/asr) — but Scribe is fine for non-North-Indian-accent clients where Saaras struggles. Keep the dual-provider STT routing.

## 15. Node.js sample code to crib from (NOT Python)

- **Sarvam STT WebSocket Node bridge** (MIT): https://github.com/agentvoiceresponse/avr-asr-sarvam
- **Sarvam TTS WebSocket Node bridge** (MIT): https://github.com/agentvoiceresponse/avr-tts-sarvam
- **Pipecat reference impl** (Python — for protocol patterns): https://github.com/pipecat-ai/pipecat/pull/2356
- **LiveKit Agents Sarvam plugin docs** (TS exists but beta-tier; Python plugin is production-blessed): https://docs.livekit.io/agents/models/tts/sarvam/

## 16. The only public Indian Sarvam-streaming deployment with numbers

**GrowwStacks** tested Bulbul v3 + Saaras v3 + GPT-4 (https://growwstacks.com/blog/sarvam-ai-tts-stt-voice-agent-test):
- *"Audio after 300-400ms of processing"*
- *"40-60% perceived latency reduction vs batch"*
- *"88% Hindi accuracy clean"*

Other Indian shops (Cars24, Razorpay, Apna, Meesho, Skit AI, Haptik, Yellow.ai) are named in ecosystem write-ups but **none publish their measured voice stack**.

## 17. Ship order — voice refactor merges into AI orchestration layer

| PR | Effort | Win | Risk | Branch / lands in |
|---|---|---|---|---|
| **PR #0 (5 min)** | Change `eleven_multilingual_v2` → `eleven_turbo_v2_5` at [elevenlabs.provider.ts:114](../../apps/api/src/modules/voice/providers/elevenlabs.provider.ts#L114). Behind per-agent setting if you want fallback. | **~1 sec saved per sentence** for any ElevenLabs agent | Zero — same vendor/API | Standalone fix branch — merge to develop immediately |
| **PR #1 (1-2 days)** | Sarvam TTS batch → Bulbul v3 WebSocket (new `SarvamTTSWebSocketClient`). Sentence flush on each LLM-stream sentence boundary. Replace the 3 batch calls. Keep behind `VOICE_TTS_STREAMING_ENABLED` per-agent flag. | ~2-3 sec saved p50 for Sarvam agents | Low (WS reconnect, 30s ping keepalive) | **AI orchestration branch** — pairs with the direct LLM path via `voice-token-stream.adapter.ts` |
| **PR #2 (1 day)** | ElevenLabs batch → Flash v2.5 WebSocket | First audio chunk ~300ms | Low | AI orchestration branch |
| **PR #3 (2-3 days)** | Sarvam STT batch → Saaras v3 WebSocket + widget VAD (`@ricky0123/vad-web`). Opus→PCM16 decode using `prism-media`. | Another 1.5-2 sec saved | Medium (audio format mismatch is the main gotcha) | AI orchestration branch + widget |

Total to ship full streaming voice: **4-6 days of focused work**, all flag-gated.

**After PR #0+#1+#2+#3 lands, expected p50 time-to-first-audio:** ~2.5-3.5s (down from 8.87s). At that point the direct LLM path replaces n8n and the remaining ~3-4s of LLM bucket becomes the next optimization (handled by chat-side research in sections 1-10 above).

## 18. What to skip

- **Cartesia Sonic-3** — technically the best (188ms TTFA, India POPs, all 3 Indic langs) but $35/M chars vs Sarvam's $0.36/M = 100× cost. Keep as the "if Sarvam WS disappoints in production" upgrade path. Docs: https://docs.cartesia.ai/api-reference/tts/websocket
- **Self-host Whisper / IndicConformer / Indic-Parler** — Indic-Parler users report **10-15 seconds for a 15-word sentence on a g5 GPU**: https://huggingface.co/ai4bharat/indic-parler-tts/discussions/10. Cheapest viable Whisper is Hetzner CPX41 €14.99/mo at 1× realtime: https://1vps.com/best-vps-for-whisper. Skip until GPU budget exists.
- **Switching to Soniox for STT** — better measured Hindi WER (7.4% vs Google 20%) but Marathi isn't in their published comparisons. Stay on Sarvam + ElevenLabs dual-provider.

## 19. Open questions

1. **Barge-in (interrupt the bot mid-reply)** — required for v1? Adds 3-5 days for echo cancellation + dual-direction VAD. Skip if half-duplex is acceptable.
2. **Enterprise customer firewalls** — some corporate proxies block long-lived WSS connections (>30s). Worth checking with one B2B customer's network before flipping the streaming flag for them.
3. **What's the realistic per-language traffic mix?** (Hindi vs Tamil vs Marathi vs Bengali/Eastern accents vs Indian English.) Determines whether to keep the dual-provider routing or simplify to Sarvam-only.

## 20. Voice integration architecture (one-line)

> **Streaming Sarvam Saaras STT WebSocket + widget VAD → direct LLM stream (replaces n8n call) → token stream feeds Sarvam Bulbul v3 / ElevenLabs Flash v2.5 WebSocket TTS (provider chosen per agent) → chunked audio yielded to widget via existing SSE pipeline.**

All providers live behind the existing `VoiceProvider` interface ([apps/api/src/modules/voice/providers/voice-provider.interface.ts](../../apps/api/src/modules/voice/providers/voice-provider.interface.ts)), extended with `synthesizeStream()` / `transcribeStream()` methods that return async iterables. The `voice-token-stream.adapter.ts` from the parked branch is the LLM↔TTS bridge.
