# PII Redaction Plan — keep PII out of LLM context and out of our logs

> Status: **PROPOSED — awaiting review** (no implementation yet)
> Branch: `feature/rag-agentic-integrations`
> Date: 2026-07-12
> Companion plan: `docs/plans/context-memory-rag-latency-plan.md` (§6 there and §7 here cover the latency interplay)

## Decisions locked in the interview

| Question | Decision |
|---|---|
| Masking vs tokenization | **Reversible tokenization.** Human agents see real PII; the LLM and logs see placeholders. Building the reversible architecture also makes a future "masked view for humans" a per-org flag, not a redesign. |
| Multilingual | **Phase the detector, not the architecture.** Ship language-independent pattern detection (identifiers) + English NER path now; multilingual NER (Hindi/Hinglish/Indic) is a pluggable upgrade when a client needs it. The toggle's UI copy must state coverage honestly. |
| What counts as PII for us | Three tiers (below). Names/emails/phones are product-legitimate (lead capture); government/financial identifiers are never needed by the bot. |
| Build now vs wait for clients | Build the cheap-to-retrofit-nothing parts now (interception seams, token map, toggle, pattern tier); defer the expensive detector (NER sidecar) until demanded. |

### The three-tier PII policy

| Tier | Categories | Treatment |
|---|---|---|
| **ALLOW** | Person names, email addresses, phone numbers | Passes to the LLM untouched. This is deliberate: lead capture (`AgentDataField`), CRM tools, and greeting-by-name are the product. Defensible under GDPR/DPDP as purpose-bound processing with a DPA in place with the LLM provider. A per-agent strict mode can later move these to TOKENIZE. |
| **TOKENIZE** | Postal addresses, dates of birth, bank account numbers, generic customer/order IDs marked sensitive | Replaced with stable placeholders (`[ADDRESS_1]`) before the LLM and before persisted logs; original recoverable via the session token map (human agents, tool execution). |
| **HARD-DROP** | Aadhaar, PAN, passport number, driving licence, voter ID, payment card numbers (+ CVV) | Irreversibly masked **at ingestion, before any persistence** — never stored in `chat_messages`, the token map, logs, or the LLM context. Aadhaar storage is legally restricted in India (Aadhaar Act); cards are PCI scope we must never enter. Detect → destroy (`[AADHAAR REDACTED]`), keep last 4 for cards only. Data extraction can therefore never save these, by construction. |

---

## 1. Where PII actually flows today (from reading the code)

**Into the LLM context** (all via `DirectChatService` → `LlmService`):
1. **Message history** — `ContextAssemblyService.assemble()` reads raw `chat_messages.content` ([context-assembly.service.ts:113](../../apps/api/src/modules/ai/context-assembly.service.ts)); **or** the widget's client-supplied `recentHistory` bypasses the DB read entirely (:98-104, fed from [public-chat.controller.ts:435](../../apps/api/src/controllers/public/public-chat.controller.ts)). Any interception must therefore act on the **assembled message array**, not on the DB read.
2. **The new user turn** — `req.newUserMessage`, same seam.
3. **Tool results** — the Vercel AI SDK runs the tool loop internally ([llm.service.ts:94-114](../../apps/api/src/modules/ai/llm.service.ts)); whatever a tool's `execute` returns goes verbatim into model context. E.g. `hubspot_find_contact` returns real name/email/phone ([hubspot.provider.ts:184-193](../../apps/api/src/modules/integrations/providers/hubspot.provider.ts)). The single choke point for **all** tools is `AgentToolsService.wrapExecute()` ([agent-tools.service.ts:87-131](../../apps/api/src/modules/integrations/agent-tools.service.ts)) — every provider tool is already wrapped there for timing/audit.
4. **Summarizer input** — `HybridContextStrategy` feeds older raw messages to `SummarizationService` (its own `LlmService` call), and the summary text itself can carry PII onward.

**Into persisted logs:**
1. **`chat_traces.userMessage` + `chat_traces.response`** — full raw text of every turn ([ai-trace.service.ts:184-185](../../apps/api/src/modules/ai/trace/ai-trace.service.ts)), exposed to the dashboard via `conversations.service.ts:210-225`. **This is the main log-side PII surface.**
2. **Pino file log** — 200-char `userMessagePreview` at trace start (ai-trace.service.ts:115).
3. **`audit_logs`** — visitor chat content never lands here (verified), and tool logging already records **argument keys only** ("values may contain PII", agent-tools.service.ts:105-106) — good baseline. But admin flows persist org-member PII (full user rows/DTOs, invitee emails: `users.service.ts:97,204`, `invitations.service.ts:75-288`, `email.service.ts:32-43`). Different audience (org members, not visitors) — low-priority phase.
4. **`event_logs` does not exist yet** — it's a planned table (`observability-everywhere-plan.md`). This plan makes the redaction service a **mandatory pre-write hook** in that table's design, so it ships clean rather than getting scrubbed later.

**Read paths that must show REAL values (the reversibility seams):** human inbox thread `HandoverService.getThread()` ([handover.service.ts:328-354](../../apps/api/src/services/handover.service.ts)) + inbox last-message preview (:286-290); conversations viewer `ConversationsService.getBySessionId()` ([conversations.service.ts:187-199](../../apps/api/src/services/conversations.service.ts)); widget poll `ChatService.pollPublicSession()` ([chat.service.ts:403-430](../../apps/api/src/services/chat.service.ts)); WhatsApp outbound human replies ([whatsapp-outbound.service.ts:35-57](../../apps/api/src/modules/whatsapp/whatsapp-outbound.service.ts)). The Socket.io layer is ping-only by design (no content) — nothing to do there.

---

## 2. The core architectural choice: redact at the LLM/log **boundary**, store raw in the primary DB

Two possible designs were considered:

- **(a) Tokenize at storage** — `chat_messages` holds placeholders; every human/visitor read re-hydrates from the vault.
- **(b) Tokenize at the boundary** — `chat_messages` holds real text (minus the HARD-DROP tier); tokenization is applied to exactly what leaves for the LLM and what lands in logs.

**Recommendation: (b), boundary tokenization.** Reasons, in order:
1. The goal is literally "out of the LLM and out of our logs" — the primary DB is the same trust domain as the vault would be (same Postgres, same encryption-at-rest); tokenizing storage adds risk-free-looking complexity without reducing the actual exposure the goal targets.
2. Design (a) breaks four read seams (§1) plus conversation **search** (`content contains` filter, conversations.service.ts:86), the data-extraction pipeline, and analytics — every consumer needs vault joins. Design (b) breaks none of them: human agents, the widget visitor, extraction, and search all keep reading `chat_messages` as today.
3. The widget's client-supplied `recentHistory` bypasses DB reads anyway — storage-side tokenization would still require a boundary pass. Boundary tokenization is the *single* mechanism that covers both history sources.
4. HARD-DROP is the exception: those values are masked **before persistence** (they must not exist anywhere, including for human agents).

### Components

**`PiiDetectionService`** (new, `apps/api/src/modules/pii/`) — pure, stateless: `detect(text, lang?) → [{category, tier, start, end, value}]`. Phase 1 engine: deterministic recognizers (§3). Engine is an interface so the NER sidecar (§3, phase 4) plugs in behind the same call.

**`PiiTokenMapService` + `PiiToken` Prisma model** (the "vault", though under design (b) it is a *consistency map*, not the only copy):
```prisma
model PiiToken {
  id             String   @id @default(uuid())
  organizationId String
  chatSessionId  String
  category       String            // EMAIL | PHONE | ADDRESS | ...
  token          String            // "[EMAIL_1]"
  valueEncrypted String            // AES, same util as AgentIntegration credentials
  createdAt      DateTime @default(now())
  @@unique([chatSessionId, token])
  @@index([organizationId])
  @@index([chatSessionId])
}
```
Scoped by `organizationId` (hard requirement) and sessioned so `[EMAIL_1]` means the same value across every turn of a conversation (stable tokens are what let the model say "I'll send it to [EMAIL_1]" coherently). Same-value-same-token within a session (lookup by encrypted-value hash).

**Hook points (all four, nothing else):**
1. **LLM inbound** — in `DirectChatService`, immediately after context assembly and before the system-prompt/LLM call (both `send()` and `stream()`): run `tokenize()` over `context.messages` + the new user turn. Covers DB history *and* client `recentHistory` in one place. Also applied to the summarizer's input inside `HybridContextStrategy` (it calls `LlmService` on raw older messages).
2. **LLM outbound (streaming-safe detokenization)** — the model's reply may contain tokens; re-hydrate before the visitor sees them. For `send()` this is a string replace on the final text. For `stream()` a small buffering transform holds back only a partial match of `[...]` at the chunk tail (tokens are short; worst-case buffering is a few chars) — everything else flushes immediately, so TTFT is untouched. The **persisted** assistant message stores the detokenized (real) text, consistent with design (b).
3. **Tool boundary — both directions in `wrapExecute()`** (agent-tools.service.ts:100-101): detokenize LLM-produced **arguments** (`input`) just before the provider's HTTP call (so `hubspot_save_contact` receives the real email even though the model only ever saw `[EMAIL_2]` — required only when ALLOW-tier is tightened to TOKENIZE; with the default policy names/emails/phones flow anyway), and tokenize **results** before returning them into model context (this one matters from day 1: a CRM record can contain DOB/address the model never needed).
4. **Log writes** — `AiTraceService`: tokenize `userMessage`/`response` before `chatTrace.create` and the pino preview when the toggle is on. Becomes the standard pre-write hook for the future `event_logs` table.

**HARD-DROP at ingestion** — a cheap pattern pass on every inbound visitor message at the two persistence entry points (`ChatService` message create for widget/WhatsApp/voice; `onVisitorMessageWhilePaused` for handover-paused turns), masking Tier-3 values before the row is written. This runs **regardless of the toggle** — it's a compliance floor, not a feature. (It's ~regex on a short string; microseconds.)

### Toggle granularity

**Per-agent, in `Agent.aiConfig` JSONB** — the established pattern (`ragEnabled` etc., zero migration, resolved once per turn through `resolveAiConfig`, rides the agent cache):
```ts
pii: {
  enabled: boolean            // default false — opt-in per agent
  logRedaction: boolean       // tokenize chat_traces/pino too (default = enabled)
  tokenizeTiers: ['TOKENIZE'] // later: agent can add 'ALLOW' → strict mode
}
```
Why per-agent and not per-org: (1) no Organization settings model exists today (Organization is bare name/slug — verified); (2) every existing toggle (`humanTakeoverEnabled`, `ragEnabled`, `voiceEnabled`) is per-agent, so the dashboard UX and cache plumbing already exist; (3) agents within one org genuinely differ (a support bot on a regulated product vs a marketing bot). An **org-level policy override** ("force PII redaction on for all agents") is a natural later addition once an org-settings surface exists — flag it in the plan, don't build it. HARD-DROP ignores the toggle entirely.

---

## 3. Detection approach — evaluated, not defaulted

### Phase-1 engine: in-process deterministic recognizers (TypeScript, zero infra)

Regex + checksum validators, running in-process (< 1 ms for chat-sized strings):
- **India:** Aadhaar (12 digits + **Verhoeff checksum** — kills most false positives), PAN (`[A-Z]{5}[0-9]{4}[A-Z]`), passport, driving licence (state formats), UPI ID, PIN code (context-gated), Indian phone formats incl. `+91`/Devanagari-digit normalization.
- **Global:** email, E.164 phones, payment cards (**Luhn** + brand prefixes), IBAN-ish account patterns, DOB formats (context-gated).
- Context words ("aadhaar", "जन्म", "dob", "account no") raise confidence for ambiguous digit runs — the same technique Presidio uses.

Why this and not a library: the Node options ([OpenRedaction](https://openredaction.com/), [@redactpii/node](https://www.npmjs.com/package/@redactpii/node)) are regex packs without India-specific checksums or our tier semantics; the recognizer set we need is small, and Presidio's India recognizers (Aadhaar/PAN/DL/UPI/PIN, in Microsoft's [PII Shield](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/introducing-pii-shield-a-privacy-proxy-for-every-llm-call/4514726)) are directly portable as patterns. Crucially, **identifier detection is language-independent** — an Aadhaar number is 12 digits whether the sentence around it is English, Hindi, or Hinglish — so the highest-risk tier (HARD-DROP) is fully covered from day 1 in every language.

What it does **not** catch: names and free-text addresses (NER territory). Under the default policy names are ALLOW-tier anyway, so phase 1's honest coverage statement is: *"identifiers in any language: yes; names/addresses: English-NER-off (phase 4)."* That honesty requirement goes in the dashboard toggle copy.

### Phase-4 engine (pluggable, on demand): Presidio sidecar with GLiNER

When a client needs name/address detection or Indic-language NER: deploy **[Microsoft Presidio](https://github.com/microsoft/presidio)** as a small Python sidecar (Render service), configured with a **GLiNER** ONNX model as the NER engine — Presidio added GLiNER/ONNX engine support and batch REST in recent releases, and GLiNER multilingual variants are the current best accuracy/footprint tradeoff for zero-shot PII entities (55-60+ types, CPU-friendly quantized). Presidio over raw GLiNER because it brings the recognizer-registry, allow-lists, and anonymizer machinery we'd otherwise rebuild; over LLM-based redaction because sending text to an LLM *to remove PII* defeats the purpose and adds a full round-trip; over cloud DLP APIs (Azure/AWS/GCP) because of per-call cost and data leaving our boundary. Presidio's built-in language support beyond English is limited — the GLiNER engine (or IndicNER models) is what actually carries Hindi/Hinglish/Indic coverage, which is why the engine seam in `PiiDetectionService` matters more than the phase-1 library choice.

Latency: one HTTP call to the sidecar, ~20–80 ms CPU for chat-sized texts (batchable for context assembly). See §7.

---

## 4. Multilingual reality (the "false sense of safety" question)

- **Tier HARD-DROP + identifiers: covered in all languages from phase 1** (patterns are script-normalized; Devanagari digits normalized before matching). This is the tier where silent failure would be catastrophic, and it's the tier pattern-matching is *best* at.
- **Names/addresses in Hindi/Hinglish/Tamil/…: NOT covered until phase 4**, and English NER alone would silently miss them — which is why phase 1 does not ship English NER either and does not claim name coverage at all. No coverage claim → no false sense of safety. The toggle description states exactly this.
- Voice: Sarvam/Deepgram transcripts enter as ordinary text through the same message path — covered identically; no separate audio-side work.
- Detection QA: a small fixture corpus (English + Hindi + Hinglish sentences per category) as unit tests, so coverage claims are executable, not aspirational.

---

## 5. What this plan deliberately does NOT do

- **No redaction of the org's own knowledge base** (RAG chunks, `AgentKnowledge`): orgs upload this content intentionally; redacting it breaks answers. Revisit only if a client demands document-side scrubbing.
- **No org-member PII scrub of `audit_logs` admin flows** in the core phases (invitee emails etc. — §1). Cheap hygiene fix (log IDs, not full DTOs) parked as phase 5.
- **No per-category dashboard UI** in v1 — config exists in `aiConfig` JSONB; UI is a checkbox + honest description. Category matrix UI when a client asks.
- **No changes to `visitorId`** (IP/phone in `chat_sessions`) — operational data, separate retention question.

---

## 6. Phased build order

**Phase 1 — Detection core + compliance floor** (no toggle needed)
`PiiDetectionService` with tiered deterministic recognizers + fixture-corpus unit tests; HARD-DROP masking at the two message-persistence entry points. Exit: an Aadhaar/PAN/card typed into any channel never reaches Postgres, the LLM, or logs — in any language.

**Phase 2 — Tokenization boundary (LLM side)**
`PiiToken` model + migration; `PiiTokenMapService` (AES via the existing credential-encryption util); `aiConfig.pii` toggle; tokenize assembled messages + summarizer input; streaming-safe output detokenization; per-turn trace step `pii.redact` (count by category, duration — no values) through the existing tracer. Exit: with the toggle on, TOKENIZE-tier values appear as placeholders in the outbound LLM request (verifiable in chat_traces) while the visitor and human agents see real text.

**Phase 3 — Logs + tools**
Tokenize `chat_traces.userMessage`/`response` + pino preview; `wrapExecute()` result-tokenization and argument-detokenization. Exit: with the toggle on, no TOKENIZE-tier value exists in any persisted log row for that agent; a HubSpot record's DOB never enters model context.

**Phase 4 — NER sidecar (on demand)**
Presidio+GLiNER sidecar behind the `PiiDetectionService` engine interface; name/address coverage incl. multilingual; per-agent strict mode (ALLOW→TOKENIZE); org-level policy override if an org-settings surface exists by then.

**Phase 5 — Hygiene backlog**
`audit_logs` admin-flow payload trimming; retention policy for `PiiToken` rows (e.g. delete with session, or 90-day TTL).

Multi-tenancy checklist: `PiiToken` carries `organizationId`; toggle lives on the org-scoped Agent; no cross-org token reuse (session-scoped uniqueness).

---

## 7. Latency interplay with the context/RAG work (it must not undo it)

Current turn: p50 2,481 ms / TTFT p50 1,854 ms (measured — see companion plan §2).

| Addition | Where it sits | Cost |
|---|---|---|
| HARD-DROP ingestion pass | Message persistence (already off the LLM's critical path for streaming) | ~microseconds |
| Phase-2 tokenization of assembled messages | Serial, before the LLM call | < 1–2 ms in-process (regex over ~20 short messages) — **~0.1% of TTFT** |
| Streaming detokenization | Inside the token stream | Zero added TTFT (flush-through; buffers only on a partial `[` match at a chunk tail) |
| Tool-result tokenization | Inside the tool loop, per tool call | < 1 ms per result (results already capped at 4,000 chars) |
| Phase-4 NER sidecar | Serial, before the LLM call | +20–80 ms — the only material addition; budgeted consciously, and only for agents that opt into NER-grade detection. Runs *concurrently* with RAG retrieval (both fan out after context assembly), so its net TTFT impact is `max(ner, rag) − rag`, likely ≈ 0–40 ms |

Net: phases 1–3 are latency-invisible; phase 4's cost is opt-in, bounded, and partially hidden behind retrieval. Nothing here re-serializes the parallel work in the companion plan.
