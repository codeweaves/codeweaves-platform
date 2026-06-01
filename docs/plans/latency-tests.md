# Text Chat Latency Tests

Tracking latency + quality across LLM providers for the Shreya sales bot (Panvelkar & Pol Associates). Text path only — voice path will be a separate doc.

Agent: P&P Associates (`5cf55175-2617-44a3-9d51-caba79d68a93`)
Routing: direct (n8n bypassed)
Server: dev (local), Render-style infra

## Common test setup

Same for every test. Reset to a fresh session per model.

**Agent config**
- Temperature: 0.3
- Max output tokens: 250
- Max context messages: 15
- Max input tokens: 8000
- Context strategy: sliding-window
- System prompt + KB: ~1,350 input tokens

**Test prompts** (sent in this exact order):

1. `hi, how are you. can you tell me more about yourself?`
2. `Can you tell me more the services you provide?`
3. `can you explain each one in brief`
4. `My name is khator, Dhruv Khator.`
5. `Nope`

## Results summary

| # | Model | Msgs | TTFT avg | TTFT median | Total avg | Total median | Cold-start TTFT | Cost | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `openai:gpt-4.1` | 5 | 1556ms | 1455ms | 2752ms | 2870ms | **3076ms** | ~$0.013 | Baseline. Auto-cache kicked in on turns 4-5. |
| 2 | `groq:qwen/qwen3-32b` | 3 | **188ms** | 167ms | **423ms** | 478ms | **248ms** | $0 (free tier) | `reasoning_effort='none'` required to suppress `<think>` leak. |
| 3 | `cerebras:zai-glm-4.7` | 0 | — | — | — | — | — | — | 429 queue overload, never completed. |
| 4 | `openai:gpt-4o-mini` | 5 | 3674ms ⚠️ | 1937ms | 4375ms | 2882ms | 2274ms | ~$0.0008 | **Quality regression — hallucinated KB-fallback for in-KB questions on turns 1 & 3.** Outlier on turn 4 (TTFT 11.9s). |
| 5 | `openai:gpt-4.1-mini` | 3 | **1395ms** | 1301ms | **2021ms** | 1689ms | 1226ms | ~$0.0012 | Quality close to gpt-4.1, cheaper, faster cold start. No KB-fallback hallucination. |
| 6 | `gemini:gemini-2.5-flash` | 3 | **1055ms** | 1016ms | **1381ms** | 1534ms | 1302ms | ~$0.0004 | Quality solid (bold formatting, all 8 services), 32% faster than gpt-4.1, cheapest non-disqualified option. Caching is explicit (not automatic) — none used. |
| 7 | `gemini:gemini-2.5-flash-lite` | 3 | 1158ms | 1225ms | **1185ms** | 1243ms | 1231ms | ~$0.0005 | **Fast but INCOMPLETE — listed only 3 of 8 services on turns 2 AND 3.** Aggressive brevity overrides KB completeness. Disqualified on quality. |

### Re-tests (after 25s heartbeat shipped)

`AI_KEEPALIVE_HEARTBEAT_MS=25000` keeps TLS pools to all providers warm indefinitely. Re-running the slow-cold-start models to verify the fix.

| # | Model | Msgs | TTFT avg | TTFT median | Total avg | Total median | Cold-start TTFT | Δ vs original cold-start |
|---|---|---|---|---|---|---|---|---|
| 1b | `openai:gpt-4.1` + heartbeat | 5 | **927ms** | 750ms | **1819ms** | 1875ms | **1249ms** | **-59%** (3076 → 1249) |
| 5b | `openai:gpt-4.1-mini` + heartbeat | 3 | 1133ms | 854ms | 1691ms | 1668ms | **716ms** | **-42%** (1226 → 716) |
| 6b | `gemini:gemini-2.5-flash` + heartbeat | 5 | 997ms | 967ms | 1305ms | 1231ms | 1311ms | ~unchanged (1302 → 1311). Heartbeat doesn't help Gemini. |

---

## Test 1 — `openai:gpt-4.1` (baseline)

Session: `80d3e13b-a999-4634-9b10-8c9c53e21124`
Date: 2026-05-30 19:25-19:27
Messages: 5

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 3076ms ❄️ | 3419ms | 1312 | 0 | 28 | 124 |
| 2 | 767ms | 3382ms | 1357 | 0 | 75 | 376 |
| 3 | 1455ms | 2870ms | 1446 | 0 | 191 | 1015 |
| 4 | 1729ms | 1931ms | 1656 | **1536** | 28 | 122 |
| 5 | 752ms | 2156ms | 1693 | **1664** | 25 | 126 |

**Replies:**

1. *I am Shreya, the AI Sales & Support Assistant for Panvelkar & Pol Associates, specializing in Indian labour law consultancy.*

2. *Panvelkar & Pol Associates offers:*
   - *Labour Law Compliance Audits*
   - *Employee Relations Advisory*
   - *Workplace Policy Development*
   - *Implementation of Upcoming Labour Codes*
   - *Regulatory Representation*
   - *Crisis Management*
   - *Payroll and Compliance Management*
   - *Strategic HR Transformation*

   *For details, visit the [Services page](https://www.panvelkarandpolassociates.com/services).*

3. *Certainly. Here is a brief overview of each service:*
   1. ***Labour Law Compliance Audits:*** *Assess adherence to labour laws, identify risks, and provide remediation.*
   2. ***Employee Relations Advisory:*** *Resolve disputes, handle grievances, and assist in union negotiations.*
   3. ***Workplace Policy Development:*** *Draft, review, and implement workplace policies tailored to your needs.*
   4. ***Implementation of Upcoming Labour Codes:*** *Analyze gaps, assess impact, and restructure wage definitions.*
   5. ***Regulatory Representation:*** *Represent clients before labour authorities, support documentation, and hearing preparation.*
   6. ***Crisis Management:*** *Intervene in labour crises, manage investigations, and handle media.*
   7. ***Payroll and Compliance Management:*** *Manage payroll processing and statutory payments to ensure compliance.*
   8. ***Strategic HR Transformation:*** *Review HR processes, optimize systems, and conduct training programs.*

   *May I have your full name, email address, and phone number to assist you further?*

4. *Thank you, Mr. Khator. May I have your email address and phone number to connect you with our team for further assistance?*

5. *Understood. If you require detailed guidance or wish to proceed, please share your email and phone number at your convenience.*

**Quality:**
- Formal tone ✓ | KB-grounded ✓ | All 8 services listed on turn 2 ✓
- Lead capture triggered on turn 3 (matches "3-4 exchanges" rule) ✓
- Refusal ("Nope") handled gracefully ✓
- Char-rule violations: turns 2 (376) and 3 (1015) over the 150-char ceiling

**Cost (manual, $2/M in, $0.50/M cached, $8/M out):** ~$0.013 / session.

---

## Test 2 — `groq:qwen/qwen3-32b`

Session: `29989fc3-126a-4384-b16c-3038e0c789b5`
Date: 2026-05-30 19:50-19:51
Messages: 3 (stopped early to avoid 60 RPM cap)
Code change required: `reasoning_effort: 'none'` injected via `buildProviderOptions` ([llm.service.ts:386](../../apps/api/src/modules/ai/llm.service.ts#L386)) — without this, Qwen3 leaked `<think>...</think>` chain-of-thought into the visible response.

| Msg | TTFT | Total | In tokens | Out tokens | Reply chars |
|---|---|---|---|---|---|
| 1 | **248ms** | 478ms | 1355 | 47 | 211 |
| 2 | 167ms | 313ms | 1421 | 69 | 326 |
| 3 | **150ms** | 479ms | 1506 | 155 | 772 |

**Replies:**

1. *Hello, I am Shreya, the AI Sales & Support Assistant of Panvelkar & Pol Associates. I assist with queries related to labour law compliance, employee relations, and workplace policies. How can I assist you today?*

2. *We offer services such as Labour Law Compliance Audits, Employee Relations Advisory, Workplace Policy Development, Payroll & Compliance Management, and more. For a detailed list, visit [our services page](https://www.panvelkarandpolassociates.com/services). May I know your name, email, and phone number to assist you further?*

3.
   1. ***Labour Law Compliance Audits**: Assess adherence to labour laws and identify risks.*
   2. ***Employee Relations Advisory**: Resolve disputes and manage union negotiations.*
   3. ***Workplace Policy Development**: Draft and update policies to reduce industry-specific risks.*
   4. ***Payroll & Compliance Management**: Handle payroll and statutory payments efficiently.*
   5. ***Regulatory Representation**: Represent clients before labour authorities.*
   6. ***Crisis Management**: Address labour crises with 24/7 emergency response.*
   7. ***Implementation of Labour Codes**: Analyze and implement upcoming labour reforms.*
   8. ***Strategic HR Transformation**: Optimize HR systems and processes.*

   *Could you share your name, email, and phone number for a detailed consultation?*

**Quality:**
- Formal tone ✓ | KB-grounded ✓ | No `<think>` leak after fix ✓
- Turn 1 includes warm CTA ("How can I assist you today?") absent from gpt-4.1
- Turn 2 listed only 4 services + "and more" — gpt-4.1 listed all 8
- Turn 2 prematurely asked for name/email/phone — violates "after 3-4 exchanges" rule
- Turn 3 covers all 8 but **reordered** (Payroll moved to #4, Labour Codes to #7 — KB has these at #4 and #7 respectively)
- Char-rule violations on all 3 turns

**Cost:** $0 — within Groq free tier (60 RPM / 500K TPD on Qwen3 preview).

**vs gpt-4.1 baseline:**
- TTFT: 8.3× faster
- Total: 6.5× faster
- No cold-start spike
- Quality gap is small (incomplete first list + early lead capture) but not blocking for production

---

## Test 4 — `openai:gpt-4o-mini`

Session: `5ba4e6c6-6d10-4ff3-988b-03d8be6799c4`
Date: 2026-05-30 20:00-20:01
Messages: 5

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 2274ms ❄️ | 3220ms | 1312 | 0 | 33 | 151 |
| 2 | 1472ms | 2882ms | 1362 | **1152** | 97 | 434 |
| 3 | 812ms | 1251ms | 1473 | **1280** | 33 | 151 |
| 4 | **11878ms** ⚠️ | 12171ms | 1525 | **1280** | 24 | 109 |
| 5 | 1937ms | 2353ms | 1558 | **1408** | 19 | 86 |

**Big outlier on turn 4** — 11.9s TTFT. Could be a network blip, Render dyno hiccup, or OpenAI tail. Without it, TTFT avg drops to 1624ms (still slower than gpt-4.1).

**Caching worked well** — kicked in from turn 2 onwards (vs gpt-4.1 which only caught from turn 4).

**Replies:**

1. *I'm sorry, I don't have that information. Could you please share your name, email, and phone number so our manager can reach out to you regarding this?*

2. *We offer the following services:*
   1. ***Labour Law Compliance Audits***
   2. ***Employee Relations Advisory***
   3. ***Workplace Policy Development***
   4. ***Implementation of Upcoming Labour Codes***
   5. ***Regulatory Representation***
   6. ***Crisis Management***
   7. ***Payroll and Compliance Management***
   8. ***Strategic HR Transformation***

   *For detailed information, please visit our [Services](https://www.panvelkarandpolassociates.com/services) page.*

3. *I'm sorry, I don't have that information. Could you please share your name, email, and phone number so our manager can reach out to you regarding this?*

4. *Thank you, Dhruv Khator. Could you please provide your email address and phone number for further assistance?*

5. *I understand. If you have any specific questions or need assistance, feel free to ask.*

**Quality — significant problems:**
- **Turn 1 FAILED**: User asked Shreya to introduce herself — the answer IS in the KB ("Section 1. Role Definition"). gpt-4o-mini returned the **canned fallback** instead. Should have introduced as Shreya, listed the firm. gpt-4.1 and Qwen3 both got this right.
- **Turn 3 FAILED**: User asked to explain each service in brief — all 8 service descriptions ARE in the KB. gpt-4o-mini returned the canned fallback again. gpt-4.1 and Qwen3 both gave correct per-service explanations.
- Turn 2 correct ✓ — listed all 8 services
- Turn 4 correct ✓ — acknowledged name, asked for email + phone
- Turn 5 off-prompt — said "feel free to ask" instead of following up on lead capture as gpt-4.1 did with the verbatim "please share your email and phone number at your convenience"

**This confirms your earlier qualitative assessment** — gpt-4o-mini-tier models are bad for strict-KB-grounded sales bots. They hallucinate the fallback for questions they SHOULD answer, which is the opposite failure mode of typical LLMs (usually they hallucinate answers; mini hallucinates the "I don't know").

**Cost (gpt-4o-mini pricing $0.15/M in, $0.075/M cached, $0.60/M out):** ~$0.0008 per session (0.08¢). 16× cheaper than gpt-4.1 — but doesn't matter if the quality is unusable.

---

## Test 5 — `openai:gpt-4.1-mini`

Session: `ef316bb3-04c0-4b14-9f4e-e66c1c47895c`
Date: 2026-05-30 20:04
Messages: 3

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 1226ms | 1553ms | 1312 | 0 | 27 | 126 |
| 2 | 1301ms | 1689ms | 1356 | **1152** | 36 | 229 |
| 3 | 1659ms | 2820ms | 1406 | **1280** | 128 | 712 |

**Caching kicked in from turn 2** (vs gpt-4.1 which only caught from turn 4). Cold start 1226ms — **2.5× better than gpt-4.1's 3076ms**.

**Replies:**

1. *I am Shreya, AI assistant for Panvelkar & Pol Associates, specializing in Indian labour law compliance and employee relations.*

2. *We provide Labour Law Compliance Audits, Employee Relations Advisory, Workplace Policy Development, Labour Codes Implementation, Regulatory Representation, Crisis Management, Payroll & Compliance, and Strategic HR Transformation.*

3. *Certainly:*

   *1. Labour Law Compliance Audits: Assess adherence to labour laws, identify risks, and provide remediation.*

   *2. Employee Relations Advisory: Handle disputes, grievances, and union negotiations.*

   *3. Workplace Policy Development: Draft, review, and implement tailored workplace policies.*

   *4. Labour Codes Implementation: Analyze gaps and assess impact of new labour codes.*

   *5. Regulatory Representation: Support and represent before labour authorities.*

   *6. Crisis Management: Manage labour crises with 24/7 response and investigations.*

   *7. Payroll & Compliance Management: Handle payroll and statutory payments accurately.*

   *8. Strategic HR Transformation: Review and optimize HR processes with training.*

**Quality:**
- KB-grounded ✓ — no hallucinated fallback (unlike gpt-4o-mini)
- All 8 services on turn 2 ✓ — though as a comma-separated paragraph instead of a bullet list
- All 8 services correctly explained on turn 3 ✓ — order matches KB
- **Minor formatting gaps vs gpt-4.1**:
  - Turn 1: dropped "Sales & Support" — said "AI assistant" instead of "AI Sales & Support Assistant"
  - Turn 2: no bullet list, no services page link
  - Turn 3: no **bold** on service names (gpt-4.1 and Qwen3 both bolded them)
- Did not trigger lead capture on turn 3 — gpt-4.1 did, Qwen3 did even earlier (turn 2). Mini follows instructions but is more passive about it.

**Cost (gpt-4.1-mini $0.40/M in, $0.10/M cached, $1.60/M out):** ~$0.0012 / 3-message session ≈ ~$0.002 / 5-message session.

**vs others:**
- 7× slower than Qwen3-32B but much better Markdown compliance
- ~25% faster than gpt-4.1 with similar quality
- ~10× cheaper than gpt-4.1
- Doesn't have gpt-4o-mini's hallucinated-fallback failure mode

---

## Test 6 — `gemini:gemini-2.5-flash`

Session: `be41be11-f5f1-46a2-bc6b-1564f887dc54`
Date: 2026-05-30
Messages: 3
`thinkingBudget: 0` already set in `buildProviderOptions` so no reasoning preamble.

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 1302ms | 1542ms | 1379 | 0 | 31 | 139 |
| 2 | 1016ms | 1068ms | 1422 | 0 | 51 | 298 |
| 3 | 847ms | 1534ms | 1482 | 0 | 137 | 682 |

**No caching used** — Gemini's caching API is explicit (`cachedContent` objects), not automatic like OpenAI. Currently leaving free perf on the table. Could be wired later if Gemini wins.

**Replies:**

1. *I am Shreya, an AI Sales & Support Assistant for Panvelkar & Pol Associates. I provide information about our firm's services and expertise.*

2. *We offer **Labour Law Compliance Audits**, **Employee Relations Advisory**, **Workplace Policy Development**, and guidance on **Upcoming Labour Codes**. We also provide **Regulatory Representation**, **Crisis Management**, **Payroll and Compliance Management**, and **Strategic HR Transformation**.*

3.
   1. ***Labour Law Compliance Audits**: Evaluate adherence to central and state labour laws.*
   2. ***Employee Relations Advisory**: Resolve disputes and handle grievances.*
   3. ***Workplace Policy Development**: Draft and review policies for legal compliance.*
   4. ***Implementation of Upcoming Labour Codes**: Analyze gaps and assess impact.*
   5. ***Regulatory Representation**: Represent clients before labour authorities.*
   6. ***Crisis Management**: Provide intervention and investigation support during labour crises.*
   7. ***Payroll and Compliance Management**: Handle end-to-end payroll and statutory payments.*
   8. ***Strategic HR Transformation**: Review HR processes and optimize systems.*

**Quality:**
- KB-grounded ✓ — no hallucination, no fallback abuse
- Full "Sales & Support Assistant" descriptor used ✓ (gpt-4.1-mini dropped this)
- Turn 1 reply 139 chars — **under the 150-char ceiling** (the only model so far that respected it on turn 1)
- **Bold formatting on service names** on turns 2 AND 3 ✓ (gpt-4.1-mini missed this)
- Turn 2 paragraph-form (not bullets) but otherwise complete
- Turn 3 perfect KB-order ✓, all 8 services
- Did not initiate lead capture on turn 3 (gpt-4.1 did, Qwen3 did from turn 2) — passive on lead capture like gpt-4.1-mini

**Cost (Gemini 2.5 Flash $0.075/M in, $0.30/M out):** ~$0.0004 / 3-msg session ≈ ~$0.0006 / 5-msg session.
**Plus**: AI Studio free tier = **1,500 req/day** which is plenty for current scale — effectively $0 at your traffic.

**vs others:**
- 5.6× slower TTFT than Qwen3-32B
- **Fastest among non-Groq options** — beats all GPT models
- Best Markdown adherence so far (bold names on every list)
- 7× cheaper than gpt-4.1-mini paid tier, free at low scale

---

## Test 7 — `gemini:gemini-2.5-flash-lite`

Session: `289bac9a-ec1d-4444-9854-34876ed14a1b`
Date: 2026-05-30
Messages: 3
`thinkingBudget: 0` set automatically (no-op on Flash-Lite — thinking is already disabled by default).

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 1231ms | 1246ms | 1379 | 0 | 19 | 76 |
| 2 | 1225ms | 1243ms | 1410 | 0 | 25 | 145 |
| 3 | 1017ms | 1067ms | 1443 | 0 | 57 | 269 |

**Notable: TTFT ≈ Total** (1158ms vs 1185ms avg). The model finishes almost immediately after first token because **outputs are extremely short** — 19/25/57 tokens vs 31/51/137 for Flash. This is the source of the quality problem (see below).

**Replies:**

1. *I am Shreya, an AI Sales & Support Assistant for Panvelkar & Pol Associates.*

2. *Panvelkar & Pol Associates offers services including Labour Law Compliance Audits, Employee Relations Advisory, and Workplace Policy Development.*

3. *Certainly. We offer:*
   1. ***Labour Law Compliance Audits**: Evaluation of adherence to central and state labour laws.*
   2. ***Employee Relations Advisory**: Dispute resolution and grievance handling.*
   3. ***Workplace Policy Development**: Policy drafting and legal review.*

**Quality — significant issue:**
- Turn 1 is too terse — dropped the description of what the firm does (76 chars, 19 tokens). Other models all included specialization context.
- **Turn 2 listed ONLY 3 services out of 8** (Compliance Audits, ERA, Policy Dev). Missing: Labour Codes Implementation, Regulatory Representation, Crisis Management, Payroll & Compliance, Strategic HR Transformation.
- **Turn 3 explained ONLY 3 services out of 8.** Same 3 as turn 2. Major incompleteness.

Flash-Lite is over-aggressively obeying the 150-character rule from the system prompt at the cost of KB completeness. It interprets "concise" as "drop the data." For a sales bot, **missing services means missing potential leads** — disqualifying for production.

The model is technically following one rule (response length) but violating a more important one (KB Restriction priority #1 — "Use ONLY the Official Knowledge Base" implies completeness of in-KB content).

**Cost (Gemini 2.5 Flash-Lite $0.10/M in, $0.40/M out):** ~$0.0005 / 3-msg session ≈ ~$0.0008 / 5-msg session. AI Studio free tier 1,500 req/day applies.

**vs Flash:**
- Marginally slower TTFT (1158 vs 1055ms)
- Faster total (1185 vs 1381ms) — but only because of severe output truncation
- Worse quality — dropped 5 of 8 services
- Slightly more expensive paid, both free under AI Studio quota

**Disqualified on quality** — same outcome as gpt-4o-mini, different failure mode (gpt-4o-mini hallucinated the fallback; Flash-Lite truncates KB content).

---

## Re-test 1b — `openai:gpt-4.1` with 25s heartbeat

Session: `330ecdd8-5722-43fc-839c-fcccea55642d`
Date: 2026-05-31
Messages: 5
Change: heartbeat active — `AI_KEEPALIVE_HEARTBEAT_MS=25000`. TLS pool to `api.openai.com` is refreshed every 25s, so the first message of any session lands on an already-warm socket.

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | **1249ms** | 1875ms | 1312 | 0 | 28 | 124 |
| 2 | 1216ms | 2344ms | 1357 | 0 | 75 | 376 |
| 3 | 719ms | 1659ms | 1446 | 0 | 196 | 1048 |
| 4 | 750ms | 907ms | 1661 | **1536** | 23 | 92 |
| 5 | 700ms | 2311ms | 1693 | **1664** | 32 | 141 |

**Cold-start tax demolished:** message 1 TTFT 1249ms (vs 3076ms originally) — **-1827ms / -59%.**

Caching still kicks in on turns 4-5 (same as original — caching depends on stable prompt, not heartbeat).

**Quality:** identical to original gpt-4.1 test — all 8 services, lead capture triggered on turn 3, refusal handled gracefully. Slight wording variation across turns 4 & 5 is temp=0.3 sampling noise.

**Side-by-side vs original:**

| Metric | Original | + Heartbeat | Δ |
|---|---|---|---|
| Cold-start TTFT | 3076ms | 1249ms | **-59%** |
| TTFT avg | 1556ms | 927ms | -40% |
| TTFT median | 1455ms | 750ms | -48% |
| Total avg | 2752ms | 1819ms | -34% |
| Total median | 2870ms | 1875ms | -35% |

The heartbeat is now mandatory for any OpenAI-direct usage. Without it, every "fresh" user (one who hasn't messaged in the past ~30s) eats the cold-start tax.

---

## Re-test 5b — `openai:gpt-4.1-mini` with 25s heartbeat

Session: `b92219f5-f9b8-454b-bdad-50fa93a75db2`
Date: 2026-05-31
Messages: 3

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | **716ms** | 1223ms | 1312 | 0 | 27 | 127 |
| 2 | 1830ms | 2182ms | 1356 | **1152** | 37 | 240 |
| 3 | 854ms | 1668ms | 1407 | **0 ⚠️** | 108 | 603 |

**Cold-start win:** message 1 TTFT 716ms vs 1226ms original. **-42%.**

**Caching anomaly:** turn 3 returned `cachedInputTokens: 0` even though the prompt prefix (system + KB) was identical to turn 2. Original test cached on both 2 and 3. Either temp=0.3 sampling routed the request to a different OpenAI backend, or `promptCacheKey` isn't pinning as reliably as expected. Worth a 5-turn re-test to see if this is a pattern.

**Replies:**

1. *I am Shreya, AI assistant for Panvelkar & Pol Associates, specializing in Indian labour law consultancy and compliance support.*

2. *We provide Labour Law Compliance Audits, Employee Relations Advisory, Workplace Policy Development, Labour Codes Implementation, Regulatory Representation, Crisis Management, Payroll & Compliance Management, and Strategic HR Transformation.*

3. *Certainly:*
   *1. Labour Law Compliance Audits: Assess adherence to labour laws and identify risks.*
   *2. Employee Relations Advisory: Resolve disputes and handle grievances.*
   *3. Workplace Policy Development: Draft and update tailored workplace policies.*
   *4. Labour Codes Implementation: Analyze gaps and assess impact of new codes.*
   *5. Regulatory Representation: Support in hearings and documentation.*
   *6. Crisis Management: Manage labour crises and emergency response.*
   *7. Payroll & Compliance Management: Handle payroll and statutory payments.*
   *8. Strategic HR Transformation: Optimize HR processes and training.*

**Quality:** matches original 4.1-mini test profile — "AI assistant" instead of "AI Sales & Support Assistant", comma-separated services on turn 2, no bold on turn 3 numbered list. Same minor formatting gaps as before.

**Side-by-side vs original:**

| Metric | Original | + Heartbeat | Δ |
|---|---|---|---|
| Cold-start TTFT | 1226ms | 716ms | -42% |
| TTFT avg | 1395ms | 1133ms | -19% |
| Total avg | 2021ms | 1691ms | -16% |

Less dramatic than gpt-4.1's -59% because 4.1-mini was already faster cold. But turn-1 win is real and worth keeping the heartbeat on.

---

## Re-test 6b — `gemini:gemini-2.5-flash` with 25s heartbeat

Session: `50f5265f-d489-4e66-90f6-251f0a893e8c`
Date: 2026-05-31
Messages: **5** (full script this time)

| Msg | TTFT | Total | In tokens | Cached | Out tokens | Reply chars |
|---|---|---|---|---|---|---|
| 1 | 1311ms | 1546ms | 1379 | 0 | 35 | 168 |
| 2 | 967ms | 1063ms | 1426 | 0 | 51 | 304 |
| 3 | 799ms | 1663ms | 1486 | 0 | 197 | 1029 |
| 4 | 1012ms | 1020ms | 1696 | 0 | 34 | 150 |
| 5 | 896ms | 1231ms | 1733 | 0 | 63 | 222 |

**Heartbeat didn't help Gemini meaningfully.** Cold start essentially unchanged (1311 vs 1302ms original). TTFT avg moved from 1055 → 997ms (-5%) — within sampling noise. Two probable causes:
1. The heartbeat endpoint (`/v1beta/models`) may land on a different anycast / CDN backend than the chat endpoint (`/v1beta/models/{model}:streamGenerateContent`), so warming one doesn't warm the other.
2. Gemini's API socket lifecycle / keep-alive timeout may differ from OpenAI's — 25s isn't tuned for `generativelanguage.googleapis.com`.

This is a real finding: **the heartbeat is mainly an OpenAI/Groq fix, not universal.**

**Replies:**

1. *I am Shreya, an AI Sales & Support Assistant for Panvelkar & Pol Associates. I provide information about our firm's services and expertise in Indian labour regulations.*

2. *We offer **Labour Law Compliance Audits**, **Employee Relations Advisory**, **Workplace Policy Development**, and **Implementation of Upcoming Labour Codes**. We also provide **Regulatory Representation**, **Crisis Management**, **Payroll and Compliance Management**, and **Strategic HR Transformation**.*

3.
   1. ***Labour Law Compliance Audits**: Evaluate adherence to central and state labour laws, identify risks, and provide remediation.*
   2. ***Employee Relations Advisory**: Handle dispute resolution, grievance handling, and union negotiations.*
   3. ***Workplace Policy Development**: Draft, legally review, and guide implementation of tailored policies.*
   4. ***Implementation of Upcoming Labour Codes**: Conduct gap analysis and impact assessment for new codes.*
   5. ***Regulatory Representation**: Represent clients before labour authorities and provide documentation support.*
   6. ***Crisis Management**: Offer intervention, emergency response, and investigation management during labour crises.*
   7. ***Payroll and Compliance Management**: Provide end-to-end payroll processing and statutory payment management.*
   8. ***Strategic HR Transformation**: Review HR processes, optimize systems, and conduct training programs.*

   *Could you please share your name, email, and phone number so our manager can reach out to you regarding these services?*

4. *Thank you, Mr. Khator. Could you please also provide your **email address** and **phone number**? This will allow our manager to contact you directly.*

5. *Understood. If you change your mind, you can reach us at support@panvelkarandpolassociates.com or visit our website at [https://www.panvelkarandpolassociates.com/contact](https://www.panvelkarandpolassociates.com/contact).*

**Quality (5-msg run, full picture now):**
- All 8 services on turns 2 AND 3 ✓
- Lead capture triggered on turn 3 (matches the rule) ✓
- **Refusal handling on turn 5 was excellent** — proactively provided contact email + page link rather than just asking again. Subjectively better than gpt-4.1's "share your email and phone number at your convenience."
- Bold formatting maintained across all list responses ✓
- Turn 4 included bold on key entities ("email address", "phone number") ✓

**Side-by-side vs original:**

| Metric | Original (3 msgs) | + Heartbeat (5 msgs) | Δ |
|---|---|---|---|
| Cold-start TTFT | 1302ms | 1311ms | unchanged |
| TTFT avg | 1055ms | 997ms | -5% (noise) |
| Total avg | 1381ms | 1305ms | -6% (noise) |

**Takeaway:** Gemini Flash's quality on a 5-msg run looks **even better** than the original 3-msg sample. Refusal handling is a small but real quality win over gpt-4.1. Latency is unaffected by the heartbeat fix — so for Gemini we don't get an extra speed-up, but we also don't lose anything. Net: Gemini Flash is a stronger #2 than the 3-msg test suggested.

---

---

# Indic A/B Tests

Comparing how the top models handle Hindi, Marathi, and Hinglish for the same Shreya agent. Same system prompt + KB (which is in English). The bot must reply in the language the user wrote in per Section 2 of the prompt.

**Test prompts per language:**

### Hindi
1. `नमस्ते, क्या आप अपने बारे में बता सकती हैं?`
2. `आप कौन सी सेवाएं देते हैं?`
3. `कृपया हर सेवा को संक्षेप में समझाइए।`

### Marathi
1. `नमस्कार, तुम्ही स्वतःबद्दल सांगू शकाल का?`
2. `तुम्ही कोणत्या सेवा देता?`
3. `कृपया प्रत्येक सेवेबद्दल थोडक्यात सांगा.`

### Hinglish
1. `hi, can you tell me apke baare me?`
2. `aap kya kya services dete ho?`
3. `mujhe har service ke baare me thoda bata do`

## Indic test 1 — `groq:qwen/qwen3-32b` × Hindi

Session: `3736ac42-07a0-4bb6-9db3-62b37087df85`
Date: 2026-05-31
Messages: 3

| Msg | TTFT | Total | In tokens | Out tokens | Reply chars |
|---|---|---|---|---|---|
| 1 | **156ms** | 439ms | 1381 | 145 | 149 |
| 2 | **35216ms** ⚠️ | 35503ms | 1559 | 156 | 160 |
| 3 | 143ms | 1131ms | 1755 | 513 | 584 |

**Turn 2 was 35 SECONDS** — almost certainly Groq free-tier rate-limit / queue event. Qwen3-32B preview tier is 60 RPM / 6K TPM / 500K TPD. Input was 1559 tokens combined with the prior turn's 145 output tokens — could have tripped the 6K TPM ceiling on a per-minute rolling window. **This is the first time we've seen Qwen3 misbehave on Groq.**

**Replies:**

1. *नमस्ते! मैं श्रेया हूँ, पैनवेलकर एंड पोल एसोसिएट्स की एआई सेल्स एवं सपोर्ट असिस्टेंट। हम लेबर लॉ कंसल्टिंग और एम्प्लॉयी रिलेशन ऑडिट में विशेषज्ञ हैं।*

2. *हम लेबर लॉ के अधीन विभिन्न सेवाएं प्रदान करते हैं, जैसे कि लेबर लॉ कंप्लायंस ऑडिट, एम्प्लॉयी रिलेशन अडवाइजरी, वर्कप्लेस पॉलिसी डेवलपमेंट और अन्य संबंधित सेवाएं।*

3.
   *1. **लेबर लॉ कंप्लायंस ऑडिट** – कानूनी अनुपालन की जांच और जोखिम कम करने का मार्ग।*
   *2. **एम्प्लॉयी रिलेशन अडवाइजरी** – विवाद समाधान और ग्रिवेंस मैनेजमेंट।*
   *3. **वर्कप्लेस पॉलिसी डेवलपमेंट** – नीतिगत निर्माण और नियमों का अनुपालन।*
   *4. **लेबर कोड्स के लागू होने की तैयारी** – नए कानूनों के अनुकूलता विश्लेषण।*
   *5. **नियमन प्रतिनिधित्व** – श्रम आयुक्तों से आपका प्रतिनिधित्व।*
   *6. **क्राइसिस मैनेजमेंट** – श्रम संकट में त्वरित प्रतिक्रिया और प्रबंधन।*
   *7. **पैग रोल एवं कंप्लायंस मैनेजमेंट** – सैलरी और नियमित कानूनी भुगतान।*
   *8. **एचआर रणनीति बदलाव** – एचआर प्रक्रिया अपडेट और अनुकूलन।*

**Quality:**
- ✓ Turn 1 correct identity, brand + title transliterated cleanly, proper Hindi grammar
- ❌ Turn 2 only listed 3 services + "and other related services" — incomplete (English Qwen test had the same issue)
- ✓ Turn 3 covered all 8 services with bold formatting + KB order preserved
- ⚠️ **Transliteration error on turn 3:** "पैग रोल" should be "पेरोल" (Payroll). Native speakers would notice.
- Service names mostly transliterated (English-in-Devanagari) rather than translated — acceptable for tech/business terms

**Latency excluding the 35s outlier:** TTFT median 156ms, total median 1131ms. When it's working, it's blazing fast even on Hindi. When it stalls (rate limit), it's catastrophic.

## Indic test 2 — `openai:gpt-4.1-mini` × Hindi

Session: `141c4482-360d-44db-85bd-81f53b1ed191`
Date: 2026-05-31
Messages: 3

| Msg | TTFT | Total | In tokens | Out tokens | Reply chars |
|---|---|---|---|---|---|
| 1 | 1176ms | 1535ms | 1312 | 38 | 130 |
| 2 | 1164ms | 1628ms | 1365 | 53 | 178 |
| 3 | 1266ms | 2321ms | 1440 | 103 | 333 |

Avg TTFT 1202ms, total avg 1828ms. **No outliers, consistent.**

**Replies:**

1. *नमस्ते, मैं श्रेया हूँ, Panvelkar & Pol Associates की AI Sales & Support Assistant, जो भारतीय श्रम कानूनों में विशेषज्ञता रखती है।*

2. *हम निम्नलिखित सेवाएं प्रदान करते हैं: श्रम कानून अनुपालन ऑडिट, कर्मचारी संबंध सलाह, कार्यस्थल नीति विकास, नियामक प्रतिनिधित्व, संकट प्रबंधन, वेतन प्रबंधन, और HR रणनीतिक परिवर्तन।*

3.
   *1. श्रम कानून अनुपालन: कानून पालन जांच व सुधार।*
   *2. कर्मचारी संबंध: विवाद समाधान व शिकायत प्रबंधन।*
   *3. नीति विकास: नीतियाँ बनाना व अद्यतन।*
   *4. नियामक प्रतिनिधित्व: अधिकारियों के समक्ष प्रतिनिधित्व।*
   *5. संकट प्रबंधन: आपातकालीन हस्तक्षेप।*
   *6. वेतन प्रबंधन: वेतन व कानूनी भुगतान।*
   *7. HR परिवर्तन: HR प्रक्रिया समीक्षा व प्रशिक्षण।*

**Quality:**
- ✓ Turn 1 correct identity. Style choice: kept brand name AND title in English; rest of sentence in Hindi (mixed script). Different from Qwen3 which transliterated everything.
- ❌ Turn 2 listed **7 of 8 services** — missing **"Implementation of Upcoming Labour Codes"** (KB #4)
- ❌ Turn 3 explained **7 of 8 services** — same Labour Codes omission. Consistent drop on both turns.
- ❌ No **bold** formatting on turn 3 numbered list
- Style choice: **translated** service names to Hindi (e.g. "श्रम कानून अनुपालन" instead of transliterating "लेबर लॉ कंप्लायंस") — more native-feeling, but loses the English-business-term register that Indian B2B clients often expect

**Hindi A/B comparison so far:**

| Dimension | Qwen3-32B Hindi | gpt-4.1-mini Hindi |
|---|---|---|
| TTFT (median) | 156ms | 1176ms |
| Latency consistency | ⚠️ One 35s outlier | ✓ Consistent |
| Brand name handling | Devanagari transliteration | Kept English |
| Service names | Transliteration (Indian-business style) | Translation (more native Hindi) |
| Markdown bold | ✓ Yes | ❌ No |
| Service coverage on T2 | 3 of 8 | 7 of 8 |
| Service coverage on T3 | **8 of 8** | 7 of 8 (Labour Codes consistently dropped) |
| Errors | 1 transliteration error ("पैग रोल") | None observed |

So far, **Qwen3 wins on completeness when it answers (8 of 8 on T3)** but has the rate-limit fragility. gpt-4.1-mini is more consistent (no outliers) but consistently incomplete (7 of 8). Neither is perfect on Hindi yet.

---

## Indic test 3 — `openai:gpt-4.1` × Hindi

Session: `130a93ad-c998-4bb9-bdea-f7a723952e01`
Date: 2026-05-31
Messages: 3

| Msg | TTFT | Total | In tokens | Out tokens* | Reply chars |
|---|---|---|---|---|---|
| 1 | **664ms** | 917ms | 1312 | 29 | 117 |
| 2 | 1139ms | 2486ms | 1356 | 83 | 251 |
| 3 | **536ms** | 2645ms | 1659 | 33 | 604 |

*`outputTokens` looks suspiciously low for turn 3 (33 tokens for 604 Devanagari chars). Likely a metadata-extraction quirk in our `normaliseUsage` — flagged for the instrumentation-bugs list, doesn't affect quality assessment.

Avg TTFT 780ms — **better than gpt-4.1-mini Hindi (1202ms)** and competitive with Gemini Flash. Heartbeat is doing its job on gpt-4.1.

**Replies:**

1. *मैं Panvelkar & Pol Associates की AI Sales & Support Assistant हूँ, जो भारतीय श्रम कानून सलाह में विशेषज्ञता रखती है।*

2. *हम निम्नलिखित सेवाएं प्रदान करते हैं:*
   *1. श्रम कानून अनुपालन ऑडिट*
   *2. कर्मचारी संबंध सलाह*
   *3. कार्यस्थल नीति विकास*
   *4. आगामी श्रम कोड्स का कार्यान्वयन*
   *5. नियामक प्रतिनिधित्व*
   *6. संकट प्रबंधन*
   *7. पेरोल और अनुपालन प्रबंधन*
   *8. रणनीतिक HR परिवर्तन*

3.
   *1. श्रम कानून अनुपालन ऑडिट: केंद्रीय व राज्य श्रम कानूनों की जांच व जोखिम पहचान।*
   *2. कर्मचारी संबंध सलाह: विवाद समाधान, शिकायत निवारण, यूनियन वार्ता।*
   *3. कार्यस्थल नीति विकास: नीति ड्राफ्टिंग, कानूनी समीक्षा, कार्यान्वयन मार्गदर्शन।*
   *4. श्रम कोड्स कार्यान्वयन: अंतराल विश्लेषण, प्रभाव मूल्यांकन, वेतन पुनर्रचना।*
   *5. नियामक प्रतिनिधित्व: श्रम अधिकारियों के समक्ष प्रतिनिधित्व, दस्तावेज़ीकरण।*
   *6. संकट प्रबंधन: श्रम संकट हस्तक्षेप, जांच प्रबंधन, मीडिया हैंडलिंग।*
   *7. पेरोल व अनुपालन प्रबंधन: पेरोल प्रोसेसिंग, वैधानिक भुगतान।*
   *8. रणनीतिक HR परिवर्तन: HR प्रक्रिया समीक्षा, सिस्टम अनुकूलन, प्रशिक्षण।*

**Quality — best Hindi run yet:**
- ✓ Turn 1 correct identity, brand + title in English, rest in Hindi; 117 chars under the 150-char rule
- ✓ **Turn 2 listed all 8 services** in KB order (mini dropped Labour Codes; Qwen3 dropped 5 of 8)
- ✓ **Turn 3 explained all 8 services** with proper Hindi descriptions (mini dropped Labour Codes again; Qwen3 had the "पैग रोल" transliteration bug)
- ✓ Correct "पेरोल" — no transliteration error
- ✓ KB order preserved on turn 3
- ❌ No **bold** formatting (same gap as mini)
- Natural Indian Hindi code-switching style — translates service names to Hindi but keeps English business terms (HR, ड्राफ्टिंग, प्रोसेसिंग) inline where appropriate

## Hindi A/B standings (3 of 4 models tested — Gemini Flash pending)

| Dimension | gpt-4.1 | gpt-4.1-mini | Qwen3-32B |
|---|---|---|---|
| TTFT avg | **780ms** | 1202ms | 156ms (when not throttled) |
| Latency consistency | ✓ | ✓ | ⚠️ One 35s outlier |
| Cold start | 664ms | 1176ms | 156ms |
| Service coverage T2 | **8 of 8** | 7 of 8 | 3 of 8 |
| Service coverage T3 | **8 of 8** | 7 of 8 | 8 of 8 |
| Markdown bold | ❌ | ❌ | ✓ |
| Transliteration errors | None | None | "पैग रोल" |
| Cost / session | ~$0.013 | ~$0.002 | Free |

**gpt-4.1 leads on Hindi quality** — most complete and most accurate. Qwen3 is best when it answers (8/8 on T3 with bold formatting) but the rate-limit fragility is a deal-breaker for prod. mini is reliably incomplete (7 of 8).

---

## Indic test 4 — `gemini:gemini-2.5-flash` × Hindi

Session: `e6eaee6b-f6b8-41ef-8fd7-49ce82e2aee5`
Date: 2026-05-31
Messages: 3

| Msg | TTFT | Total | In tokens | Out tokens | Reply chars |
|---|---|---|---|---|---|
| 1 | 1236ms | 1447ms | 1376 | 24 | 83 |
| 2 | 1370ms | 1985ms | 1409 | 87 | 356 |
| 3 | 1169ms | 2204ms | 1507 | 175 | 599 |

Avg TTFT 1258ms, total avg 1879ms — consistent.

**Replies:**

1. *नमस्ते। मैं श्रेया हूँ, पनवेलकर एंड पोल एसोसिएट्स की एआई सेल्स और सपोर्ट असिस्टेंट।*

2. *हम श्रम कानून अनुपालन ऑडिट, कर्मचारी संबंध सलाहकार, कार्यस्थल नीति विकास, आगामी श्रम संहिताओं के कार्यान्वयन, नियामक प्रतिनिधित्व, संकट प्रबंधन, पेरोल और अनुपालन प्रबंधन, और रणनीतिक एचआर परिवर्तन जैसी सेवाएं प्रदान करते हैं। आप हमारी सेवाओं के बारे में अधिक जानकारी के लिए [हमारी वेबसाइट](https://www.panvelkarandpolassociates.com/services) पर जा सकते हैं।*

3. *निश्चित रूप से।*
   *1. **श्रम कानून अनुपालन ऑडिट**: केंद्रीय और राज्य श्रम कानूनों का पालन सुनिश्चित करना।*
   *2. **कर्मचारी संबंध सलाहकार**: विवाद समाधान और संघ वार्ता में सहायता।*
   *3. **कार्यस्थल नीति विकास**: कानूनी रूप से सुदृढ़ नीतियों का मसौदा तैयार करना।*
   *4. **आगामी श्रम संहिताओं का कार्यान्वयन**: नए श्रम संहिताओं के लिए तैयारी।*
   *5. **नियामक प्रतिनिधित्व**: श्रम आयुक्तों के समक्ष प्रतिनिधित्व।*
   *6. **संकट प्रबंधन**: श्रम संकटों में हस्तक्षेप और समाधान।*
   *7. **पेरोल और अनुपालन प्रबंधन**: पेरोल और वैधानिक भुगतानों का प्रबंधन।*
   *8. **रणनीतिक एचआर परिवर्तन**: एचआर प्रक्रियाओं की समीक्षा और अनुकूलन।*

**Quality — best Hindi run yet:**
- ✓ Turn 1 correct identity (Devanagari transliteration for brand + title, more native than gpt-4.1/mini)
- ✓ **Turn 2 listed all 8 services** + included [services page link]
- ✓ **Turn 3 explained all 8 services** with **bold formatting** + brief descriptions
- ✓ Correct "पेरोल" — no transliteration error
- ✓ KB order preserved
- ❌ Turn 1 minimal (just identity, no specialty description like gpt-4.1 had)

## Hindi A/B FINAL standings (all 4 models)

| Dimension | gpt-4.1 | gpt-4.1-mini | Qwen3-32B | **Gemini Flash** |
|---|---|---|---|---|
| TTFT avg | 780ms | 1202ms | 156ms* | 1258ms |
| Consistency | ✓ | ✓ | ⚠️ 35s outlier | ✓ |
| Cold start | 664ms | 1176ms | 156ms* | 1236ms |
| Service coverage T2 | 8/8 | 7/8 | 3/8 | **8/8** |
| Service coverage T3 | 8/8 | 7/8 | 8/8 | **8/8** |
| Markdown bold | ❌ | ❌ | ✓ | **✓** |
| Services link | ❌ | ❌ | ❌ | **✓** |
| Transliteration errors | None | None | "पैग रोल" | None |
| Cost / session | ~$0.013 | ~$0.002 | Free | Free (1500/day) |

*when not rate-limited

**Gemini 2.5 Flash leads on Hindi.** Only model to combine all 8 services on both turns, bold formatting, services link, and correct transliteration. Plus free at current scale.

---

---

# Voice tests

## Voice setup

Same agent (Shreya / P&P Associates), `routingMode='direct'`, LLM `groq:qwen/qwen3-32b`. Triggered via the dev test chat page's 🎙️ mic button which posts to `POST /api/klivo/v1/public/voice/conversation` with `Accept: application/x-ndjson` for the streaming response.

### Voice models / config used (P&P agent)

| Layer | Provider | Model | Voice / speaker | Source |
|---|---|---|---|---|
| STT (English) | Deepgram | `nova-3` | n/a | [deepgram.provider.ts:93](../../apps/api/src/modules/voice/providers/deepgram.provider.ts#L93) — hardcoded |
| STT (Hindi / Marathi / Indic) | Sarvam | `saarika:v2.5` | n/a | [sarvam.provider.ts:153](../../apps/api/src/modules/voice/providers/sarvam.provider.ts#L153) — hardcoded |
| TTS | ElevenLabs | `eleven_multilingual_v2` | `Xb7hH8MSUJpSbSDYk0k2` (provider default — `ELEVENLABS_DEFAULT_VOICE_ID` is empty in `.env`) | Agent's `voiceConfig.ttsProvider = "elevenlabs"`; model + voice from [elevenlabs.provider.ts:54,85,192](../../apps/api/src/modules/voice/providers/elevenlabs.provider.ts#L54) |

**Important:** these tests used ElevenLabs `eleven_multilingual_v2` for TTS — the SLOW model (1,232ms TTFT per the Coval benchmark in the field-intel doc). PR #0 (swap to `eleven_turbo_v2_5`, ~264ms TTFT) would directly address this. All the TTS latencies below (1.8-4.6s per sentence) are on the slow Multilingual v2 model.

STT provider chosen per-language by `VoiceService.resolveSTTProvider` (Deepgram for English, Sarvam for Indic). TTS via batch ElevenLabs HTTP endpoint — WebSocket streaming not yet wired (that's PR #2 in the field-intel doc).

**Bugs fixed during voice testing:**
- Dev page was hitting the stale `/api/codeweaves/v1/...` URL after the Klivo rebrand merge — voice button would 404. Fixed at [dev-test-chat.page.ts:297](../../apps/api/src/controllers/dev/dev-test-chat.page.ts#L297).
- Voice controller's `transcription` chunk wasn't including the session ID. Each voice turn from the dev page created a fresh session instead of appending to the conversation. Fixed both server-side ([voice.controller.ts:418](../../apps/api/src/modules/voice/voice.controller.ts#L418) now emits `sessionId: session.sessionId`) and client-side ([dev-test-chat.page.ts handleVoiceChunk](../../apps/api/src/controllers/dev/dev-test-chat.page.ts) now captures it on the first chunk).

## Voice test 1 — Qwen3-32B multilingual (Hindi / Marathi / English)

Each row below is a SEPARATE session (because of the session-ID bug, now fixed). All on LLM `groq:qwen/qwen3-32b` with `reasoning_effort: 'none'`. STT provider chosen automatically per language. TTS via ElevenLabs `eleven_multilingual_v2` for all sessions (P&P agent's `voiceConfig.ttsProvider = "elevenlabs"`).

### Full per-session metrics (STT → LLM → TTS)

| # | Session | Lang | **STT** model + latency | **LLM** in→out tokens · est. TTFT* | **TTS** model · avg/sent · sentences | **TTFC** | **Total** |
|---|---|---|---|---|---|---|---|
| 1 | `8cb305f1-...` | en | deepgram `nova-3` · **2914ms** | qwen3-32b · 1383 → 47 · ~729ms | eleven_multilingual_v2 · 1903ms · 3 sent | 5546ms | 6456ms |
| 2 | `4518b967-...` | mr | sarvam `saarika:v2.5` · **927ms** | qwen3-32b · 1491 → 310 · ~890ms | eleven_multilingual_v2 · 1784ms · 3 sent | 3601ms | 4482ms |
| 3 | `6e7f3933-...` | hi | sarvam `saarika:v2.5` · 1165ms | qwen3-32b · 1469 → 125 · ~1139ms | eleven_multilingual_v2 · 2138ms · 1 sent | 4442ms | 4450ms |
| 4 | `0825eecd-...` | hi | sarvam `saarika:v2.5` · 1272ms | qwen3-32b · 1633 → 246 · ~1425ms | eleven_multilingual_v2 · 3484ms · 1 sent | 6181ms | 6198ms |
| 5 | `102c4736-...` | en | deepgram `nova-3` · 2347ms | qwen3-32b · 1371 → 177 · *(parallel)* | eleven_multilingual_v2 · 4625ms · 9 sent | 5183ms | **11387ms** |

*Est. LLM TTFT = `TTFC - STT - avgTtsLatency`. Session 5 is "parallel" because TTS for sentence 1 was firing while sentences 2-9 were still being generated by the LLM — the math doesn't isolate cleanly. **The voice path doesn't currently log LLM TTFT explicitly in `chat_messages.metadata`** — flagged for the instrumentation gaps list.

**TTFC = time-to-first-audio-chunk** (the perceived "bot started replying" moment).

**Averages:** STT 1725ms · LLM est. TTFT ~1000ms · TTS avg/sent 2787ms · TTFC 4990ms · Total 6595ms

**vs production baseline** (from earlier Supabase analysis):
- TTFC: 4990ms vs **7680ms baseline** → **-35%**
- Total: 6595ms vs **9330ms baseline** → **-29%**

The LLM speedup IS visible in the voice path now. But STT + TTS are still batch — that's where the remaining latency lives.

## Key findings

### 1. Sarvam STT is ~2.5× faster than Deepgram STT 🔥

| Provider | Avg STT latency | Range |
|---|---|---|
| Sarvam | **1121ms** | 927-1272ms |
| Deepgram | **2631ms** | 2347-2914ms |

Both providers serve short utterances (5-15 second clips) but Deepgram takes 2.5× longer. Whatever logic picks Deepgram for English by default should be flipped to Sarvam — **single-line config change, saves ~1500ms on every English voice turn**. Sarvam Saaras supports English well; the original "Deepgram for English, Sarvam for Indic" split was based on outdated assumptions about Indic-only capability.

### 2. TTS dominates total latency, exactly as predicted

Average TTS per sentence is 1.8-4.6s on batch endpoints. This is the entire reason for PR #1 (Sarvam Bulbul v3 WebSocket TTS) in the field-intel doc — WebSocket streaming gives first audio chunk in ~300-400ms instead of waiting for the full sentence audio.

### 3. `reasoning_effort: 'none'` works on voice path too ✓

None of the 5 voice responses leaked `<think>` blocks. The Qwen3 reasoning-disable fix we added for text chat applies cleanly to voice (same `LlmService` code path).

### 4. Quality varies by language

| Session | Lang | Service coverage | Notes |
|---|---|---|---|
| 1 | English | Full + lead capture | Clean intro, asks "how may I assist you today?" |
| 2 | Marathi | All 8 services listed | Mix of Devanagari + English transliterations |
| 3 | Hindi | Only 4 of 8 services | Truncated to 1 sentence |
| 4 | Hindi | All 8 services | Mixed Devanagari + English |
| 5 | English | All 8 with bold + lead capture | Best run |

Same pattern as text-mode Hindi tests: Qwen3 sometimes drops services when generating Hindi.

## Per-language transcripts (USER → BOT)

**Session 1 (English):**
- *Hey, man. Who are you, and what can you help me with?*
- *I am Shreya, AI Sales & Support Assistant for Panvelkar & Pol Associates. I can assist you with labour law compliance, employee relations, workplace policies, and other related services. How may I assist you today?*

**Session 2 (Marathi):**
- *मला तुमच्या सर्विसेसच्या माहिती पाहिजे होतं ते तुम्ही प्रोव्हाइड करू शकता काय*
- *आम्ही निश्चितपणे आमच्या सेवा माहिती प्रदान करू शकतो. खालीलपैकी कोणती सेवा आपल्यासाठी सर्वात योग्य आहे? 1. श्रम कायदा अनुसरण ऑडिट 2. कर्मचारी संबंधांचे सल्लागार 3. कार्यस्थळ धोरण विकास 4. आगामी श्रम कोडची अंमलबजाई 5. नियमावली प्रतिनिधित्व 6. संकट प्रबंधन 7. पगार आणि अनुसरण प्रबंधन 8. स्ट्रॅटेजिक HR रूपांतर ...*

**Session 3 (Hindi, truncated):**
- *ये सब सर्विसेस के बारे में क्या आप मुझे ब्रीफ में एक्सप्लेन कर सकते हो*
- *हमारी सर्विसेस में लेबर लॉ कंप्लायंस, एम्प्लॉई रिलेशनशिप एडवाइजरी, वर्कप्लेस पॉलिसी डेवलपमेंट, और क्राइसिस मैनेजमेंट शामिल हैं।* (only 4 of 8)

**Session 4 (Hindi, complete):**
- *नहीं, मेरा कहने का मतलब था क्या ये सर्विसेज के बारे में जो भी आप आर्ट सर्विसेज प्रोवाइड करते हो उनके बारे में आप एक्सप्लेन कर सकते हो कि हर एक सर्विस क्या करती है?*
- *हमारी 8 प्रमुख सर्विसेज हैं — लेबर लॉ कंप्लायंस ऑडिट, एम्प्लॉइ के रिलेशनशिप एडवाइजरी, वर्कप्लेस पॉलिसी डेवलपमेंट, लेबर कोड्स के इम्प्लीमेंटेशन, रेग्युलेटरी रिप्रेजेंटेशन, क्राइसिस मैनेजमेंट, पेरोल एंड कंप्लायंस मैनेजमेंट, और स्ट्रैटेजिक एचआर ट्रांसफॉर्मेशन।*

**Session 5 (English, full reply):** Full 8-service bulleted list with bold + lead capture — same quality as our text-mode gpt-4.1 baseline.

## Action items (in impact order)

1. **PR #0: Switch ElevenLabs model `eleven_multilingual_v2` → `eleven_turbo_v2_5`** — these tests used the slow Multilingual v2 model (1232ms TTFT). Turbo v2.5 is independently measured at 264ms TTFT with similar quality. **One-line change in [elevenlabs.provider.ts:54](../../apps/api/src/modules/voice/providers/elevenlabs.provider.ts#L54). Saves ~1 sec per TTS sentence.**
2. **Flip STT default to Sarvam for English** — Deepgram nova-3 ran at 2347-2914ms vs Sarvam saarika:v2.5 at 927-1272ms. Single-line config change. **Highest ROI fix after PR #0** — saves ~1.5 sec on every English voice turn. Zero risk.
3. **PR #1: Sarvam Bulbul v3 WebSocket TTS** — drops first-audio-chunk from ~5s to ~3s per GrowwStacks' measured numbers. (Note: P&P uses ElevenLabs, so PR #2 — ElevenLabs Flash v2.5 WebSocket — applies for them.)
4. **PR #2: ElevenLabs Flash v2.5 WebSocket TTS** — for ElevenLabs-routed agents like P&P. Sub-100ms first-chunk per vendor claim.
5. **PR #3: Sarvam Saaras v3 WebSocket STT** — first partial transcript in ~300-500ms instead of waiting for full audio.
6. **Instrumentation: log LLM TTFT in voice path metadata** — currently the voice flow's `chat_messages.metadata` doesn't capture LLM TTFT separately, so we have to estimate it from `TTFC - STT - avgTTS`. Should mirror what direct text-chat already does (raw `ttftMs` field).
7. Session-ID bug fix has already shipped (above).

---

## Voice test 2 — gpt-4.1 multilingual (single session, 5 turns)

Session: `90c33a76-a496-400f-80b8-eb62d1033888`
Date: 2026-05-30 21:22-21:26
Messages: **5 turns in ONE session** (session-ID fix verified working ✓)
LLM: `openai:gpt-4.1` direct mode with 25s heartbeat active
TTS: ElevenLabs `eleven_multilingual_v2` voice `Xb7hH8MSUJpSbSDYk0k2`
Note: this test ran BEFORE the voice→LLM metadata wiring; the `chat_messages.metadata` for these assistant messages doesn't yet have `model`/`llmTtftMs`/`outputTokens` fields. The numbers below come from `llm_usage` joined by timestamp. Subsequent voice tests will have all LLM metrics in `chat_messages.metadata` natively.

| # | Lang | STT model · ms | STT prov | LLM tokens in→out · cached | TTS avg/sent · sentences | TTFC | Total |
|---|---|---|---|---|---|---|---|
| 1 | en | nova-3 · **2454ms** | deepgram | 1332 → 38 · 0 cached | 1854ms · 2 | **7700ms** ❄️ | 7983ms |
| 2 | mr | saarika:v2.5 · 898ms | sarvam | 1408 → 76 · 0 | 2180ms · 1 | 5639ms | 5648ms |
| 3 | hi | saarika:v2.5 · 1011ms | sarvam | 1524 → **356** · 0 | **6138ms** · 3 | 9936ms | **11049ms** |
| 4 | en | nova-3 · 2315ms | deepgram | 1877 → 27 · **1024 cached** | 1201ms · 2 | 4858ms | 5442ms |
| 5 | en | nova-3 · 2044ms | deepgram | 1908 → 23 · **1024 cached** | 1209ms · 2 | 4536ms | 5323ms |

**Averages:** STT 1744ms · TTFC 6534ms · Total 7089ms.
**OpenAI auto-cache kicked in at turn 4** (1024 cached tokens both turns 4 and 5).

**Replies:**

1. *I am Shreya, the AI Sales & Support Assistant for Panvelkar & Pol Associates. I assist with Indian labour law compliance, employee relations audits, and workplace policy advisory.*

2. *हो, आम्ही खालील सेवा पुरवतो:*
   1. *Labour Law Compliance Audits*
   2. *Employee Relations Advisory*
   3. *Workplace Policy Development*
   4. *Implementation of Upcoming Labour Codes*
   5. *Regulatory Representation*
   6. *Crisis Management*
   7. *Payroll and Compliance Management*
   8. *Strategic HR Transformation*

   *अधिक माहिती हवी असल्यास कृपया सांगा.*

3. *(All 8 services explained in Hindi descriptions with English service names. Closes with "कृपया अपना पूरा नाम, ईमेल और फोन नंबर शेयर करें ताकि हमारी टीम आपसे संपर्क कर सके।" — lead capture in Hindi.)*

4. *Thank you, Mr. Kator. Please provide your email address and phone number so our team can contact you for further assistance.*

5. *Understood. If you need detailed assistance or wish to proceed, please share your email and phone number anytime.*

**Quality observations:**
- ✓ **Multi-turn session worked** (session-ID fix verified)
- ✓ **Code-switching handled cleanly** — Marathi user message → Marathi acknowledgment + English service names + Marathi closing. Hindi → Hindi explanations with inline English service terms. Matches typical Indian B2B speech.
- ✓ Lead-capture triggered in turn 3 (after 3 exchanges, per the rule)
- ❌ **STT made a name error**: "Khator, Dhruv Khator" → "kator drov kator". Deepgram nova-3 struggling with Indian names — **another reason to flip default English STT to Sarvam**.

## gpt-4.1 voice vs Qwen3 voice (averages)

| Metric | Qwen3 voice | gpt-4.1 voice | Δ |
|---|---|---|---|
| TTFC avg | 4990ms | 6534ms | **+31% slower** |
| Total avg | 6595ms | 7089ms | +7% slower |
| Cold-start TTFC | 5546ms | 7700ms | +39% slower |

gpt-4.1 is slower across the board for voice too — same as text. Quality (especially multilingual code-switching) is noticeably more polished on gpt-4.1.

---

## Voice test 3 — gpt-4.1 multilingual, POST-Turbo v2.5 (LLM metadata now in `chat_messages.metadata`)

Session: `c285893a-991d-45d7-a804-ba0740134e8f`
Date: 2026-05-31
Messages: **5 turns in ONE session**

**Changes since voice test 2:**
1. ElevenLabs TTS model swapped from `eleven_multilingual_v2` (1232ms TTFT per Coval) → `eleven_turbo_v2_5` (264ms TTFT per Coval). Single-line config change in [elevenlabs.provider.ts:59](../../apps/api/src/modules/voice/providers/elevenlabs.provider.ts#L59).
2. LLM metrics (TTFT, tokens, cost, model, etc.) now plumbed through the voice path into `chat_messages.metadata` — first voice test with the full STT/LLM/TTS breakdown natively in DB.

| # | Lang | STT ms | STT prov | **LLM TTFT** | LLM total | in→out tokens | cached | **TTS avg/sent** | Sent | TTFC | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | en | 2848 | deepgram | **868** | 1545 | 1354 → 64 | 0 | **614** | 3 | 5232 | 5733 |
| 2 | mr | 909 | sarvam | 870 | 1699 | 1443 → 154 | 0 | 2858 | 1 | 6591 | 6599 |
| 3 | hi | 1102 | sarvam | 1314 | 3747 | 1622 → 345 | 0 | 1336 | 2 | 5999 | 6923 |
| 4 | en | 2593 | deepgram | **497** | 1106 | 1974 → 31 | 0 | **341** | 2 | 4280 | 4885 |
| 5 | en | 1903 | deepgram | **617** | 959 | 2008 → 19 | **1024** | **314** | 2 | 3629 | 3986 |

**Averages:** STT 1871ms · LLM TTFT 833ms · LLM total 1811ms · TTS avg/sent **1093ms** · TTFC 5146ms · Total **5625ms**

### TTS swap impact (Multilingual v2 → Turbo v2.5)

Apples-to-apples on the 3 English turns in this session vs the 3 English turns in Voice test 2:

| Metric | Multilingual v2 | Turbo v2.5 | Δ |
|---|---|---|---|
| TTS avg/sent (English) | 1421ms | **423ms** | **-70%** |
| English TTFC (warm turns 4,5) | 4697ms | **3955ms** | -16% |
| English total (turns 4,5) | 5383ms | **4436ms** | -18% |

**Matches Coval benchmark prediction.** Turbo v2.5 wins decisively on English. Hindi turn was 78% faster (6138 → 1336ms). Marathi turn was 30% slower as a single sample (2858 vs 2180ms); needs more data to confirm pattern.

### Full session vs Voice test 2 (gpt-4.1 + Multilingual v2)

| Metric | gpt-4.1 + ML v2 | gpt-4.1 + Turbo v2.5 | Δ |
|---|---|---|---|
| TTFC avg | 6534ms | **5146ms** | **-21%** |
| Total avg | 7089ms | **5625ms** | **-21%** |
| Cold-start TTFC | 7700ms | 5232ms | -32% |

### Heartbeat verified on voice path

LLM TTFT across all 5 turns: 868 / 870 / 1314 / 497 / 617ms. Turn 1 is in the same band as warm turns — the 25s heartbeat is keeping the OpenAI socket warm even when voice is the first interaction of a session. Pre-heartbeat, the first turn would have been ~3000ms+ TTFT.

### Replies

1. *I am Shreya, the AI Sales & Support Assistant for Panvelkar & Pol Associates. I assist with queries on Indian labour law compliance, employee relations audits, and workplace policy advisory. For details, please visit our [About page](https://www.panvelkarandpolassociates.com/about).*

2. *हो, आम्ही खालील सेवा पुरवतो:*
   *1. लेबर लॉ कंप्लायन्स ऑडिट्स*
   *2. एम्प्लॉयी रिलेशन्स अ‍ॅडव्हायझरी*
   *3. वर्कप्लेस पॉलिसी डेव्हलपमेंट*
   *4. लेबर कोड्स इम्प्लिमेंटेशन*
   *5. रेग्युलेटरी रिप्रेझेंटेशन*
   *6. क्रायसिस मॅनेजमेंट*
   *7. पेरोल आणि कंप्लायन्स मॅनेजमेंट*
   *8. स्ट्रॅटेजिक HR ट्रान्सफॉर्मेशन*
   *अधिक माहितीसाठी कृपया आपले पूर्ण नाव, ईमेल आणि फोन नंबर शेअर करा.*

3. *(All 8 services with detailed Hindi explanations, English service names inline. Closes with Hindi lead capture.)*

4. *Thank you, Mr. Katur. Please provide your **email address** and **phone number** so our team can contact you with detailed information.*

5. *Understood. If you need further assistance or wish to proceed, please let me know.*

### Quality notes
- ✓ Multi-turn session worked (no session-ID bug)
- ✓ Multilingual code-switching: English → Marathi → Hindi → English handled smoothly
- ✓ All 8 services on turns 2 AND 3
- ✓ Lead capture triggered on turn 2 (Marathi response) — slightly early but acceptable
- ✓ Bold formatting on turn 4 ("**email address**", "**phone number**")
- ❌ STT name error again: "Khator, Dhruv Khator" → "katur dhruv katur" (Deepgram nova-3 on Indian names). Same issue as Voice test 2. Sarvam STT for English would likely fix this.

### Open instrumentation gaps still
- `cost: null` on every assistant message — cost calculator not wired into the voice path's `llm_usage` write either
- `ttsProvider` / `ttsModel` not logged per message (we know it's ElevenLabs Turbo v2.5 from agent config + code, but explicit logging would help analytics)
- `chat_traces` still empty — step-level trace persistence broken (both text and voice path)

---

## Test 3 — `cerebras:zai-glm-4.7` (FAILED — queue overload)

Date: 2026-05-30 19:42
No session created.

```
HTTP 429
code: "queue_exceeded"
message: "We're experiencing high traffic right now! Please try again soon."
x-should-retry: false
```

Server-side capacity squeeze on Cerebras's preview-tier shared compute. Not the client rate limit.

**Side bug surfaced:** Vercel AI SDK retried 3× despite `x-should-retry: false` — wasted ~10s wall-clock. Fix: set `maxRetries: 1` on streamText.

---

## Provider-side instrumentation gaps (separate fixes)

Surfaced during these tests, not blocking the latency work:

1. **`chat_traces` table empty for direct-mode sessions** — trace IDs are stamped on `chat_messages.metadata` but no DB rows written. Pino-backed AI tracer logs to file/console only.
2. **`cost: null` on every `llm_usage` row** — cost calculator not wired. Manual calculation possible from token counts + provider pricing.
3. **AI SDK ignores `x-should-retry: false`** — burns 10s on Cerebras 429s. Set `maxRetries: 1` for streaming calls.
4. **`cachedInputTokens` not visible on Groq** — Groq response may not expose cache info the same way as OpenAI; needs investigation.

---

## Provisional verdict (will be revised as more models tested)

**`groq:qwen/qwen3-32b` is currently the fastest viable option** — 6-8× faster than gpt-4.1 with quality close enough for production. `openai:gpt-4.1` remains the quality benchmark and fallback option.

**`openai:gpt-4o-mini` is DISQUALIFIED on quality** — hallucinates the "I don't have that information" fallback for in-KB questions. Cheapest by far ($0.0008/session) but unusable for a strict-KB sales bot.

**`openai:gpt-4.1-mini` is a viable middle-ground** — 25% faster than gpt-4.1, 10× cheaper, quality close (minor Markdown polish gaps). Reasonable fallback option to `groq:qwen/qwen3-32b` for clients where Qwen3 quality feels too compressed.

**`gemini:gemini-2.5-flash` is the new quality leader for the price** — fastest non-Groq option, cheapest paid tier, best Markdown adherence (bold names on every list), respected 150-char rule on turn 1 (only model to do so), AI Studio free tier covers current scale. Strong second pick after Qwen3-32B if Qwen quality fails Indic A/B testing.

**`gemini:gemini-2.5-flash-lite` is DISQUALIFIED on quality** — listed only 3 of 8 services in both the overview and the per-service explanation. Over-prioritises the 150-char rule at the cost of KB completeness. Different failure mode than gpt-4o-mini's fallback hallucination, same outcome: unusable for production.

## Final ranking (after all 7 tests)

| Rank | Model | TTFT | Total | Cost | Verdict |
|---|---|---|---|---|---|
| 🥇 1 | `groq:qwen/qwen3-32b` | 188ms | 423ms | Free | Production candidate (subject to Indic A/B) |
| 🥈 2 | `gemini:gemini-2.5-flash` | 1055ms | 1381ms | Free up to 1.5K req/day | Strong fallback, best Markdown |
| 🥉 3 | `openai:gpt-4.1-mini` | 1395ms | 2021ms | $0.002/session | Quality middleweight |
| 4 | `openai:gpt-4.1` | 1556ms | 2752ms | $0.013/session | Quality benchmark, expensive |
| ❌ DQ | `openai:gpt-4o-mini` | — | — | — | Hallucinates KB-fallback |
| ❌ DQ | `gemini:gemini-2.5-flash-lite` | — | — | — | Drops services to stay short |
| 🚧 Untested | `cerebras:zai-glm-4.7` | — | — | — | Queue overloaded — retry later |

**Next steps** (decoupled from further model testing):
1. Indic quality A/B for top 3 (Qwen3, Gemini Flash, gpt-4.1-mini) on Hindi + Marathi prompts.
2. Implement per-agent model routing (probably default Qwen3, fallback Gemini Flash, premium gpt-4.1).
3. Fix instrumentation gaps (chat_traces persistence, cost calculation).
4. Add 25s heartbeat to address gpt-4.1's 3076ms cold-start tax (less critical now that Qwen3 is the candidate — Groq doesn't have a cold-start problem).
5. Wire Gemini explicit caching (`cachedContent`) if Gemini wins or becomes a primary fallback.
