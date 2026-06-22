# Dynamic Data Capture & Integrations — Architecture Plan

> **Status:** Research + design complete. No code yet. Read the "Plain English" section first; the rest is for whoever builds it.
> **Date:** 2026-06-18
> **Scope:** Three things — (1) letting each bot collect different data, (2) where that data lives + getting it into customers' systems, (3) letting each bot have arbitrary integrations the LLM can call. Plus how the prompt/context ties it together, and the security gates.
> **Sibling docs:** `ai-orchestration-implementation-plan.md` (tool calling is "Phase 4" there), `whatsapp-integration-plan.md`, `rag-pipeline-deep-research.md`.

---

## 1. Plain English — the whole idea in one picture

Think of the platform as **a wall of power sockets.** You wire the socket into the wall **once**. After that, anyone plugs in a lamp, a charger, a TV — anything — and it just works. You never reopen the wall.

**The one principle behind all of this:**

> **We never write code per customer. We write generic *engines* that read per-customer *configuration* (data), and behave differently at runtime.**

We already do exactly this — `Agent.aiConfig`, `Agent.voiceConfig`, `AgentTheme.config` are all "config as data," read by one generic engine (`DirectChatService`) with zero per-customer code. Every problem below is just *"add another kind of config, and a generic engine that reads it."*

The three problems, in plain words:

| Problem | Plain-English solution | Industry name |
|---|---|---|
| **1. Different data per bot** | A form builder. The customer lists the fields they want ("name, email, phone"). That list is saved as data. The AI reads the list and collects those things, then drops the answers into one storage box. | Custom fields / schema-per-tenant |
| **2. Where it lives / "our own DB"** | By default it lives in our database. If a customer wants it elsewhere, we add a "also send a copy to this address" step — like CC-ing an email. We build that copy-sender once; any customer points it wherever. | Destinations / sinks |
| **3. Any integration (OTP, CRM, lookup…)** | The power socket. We build **one** general connector. The customer plugs in whatever they want by filling a form ("call this URL, with this key, send these fields"). The AI is simply *told* "you have a tool called `lookup_customer`" and presses that button on its own. | LLM tool calling + tool registry |

**The promise you cared about most:** adding bot #500's brand-new integration = the customer fills a form (data). We touch **zero code**. That is the additive/expandable property, and it holds as long as we obey one rule (Section 8).

This is not us inventing something risky. It's the same pattern ChatGPT's custom GPTs, Zapier, n8n, Retell, and Make all use, and your code already has the empty `tools` slot wired into the AI waiting for it.

---

## 2. How it all fits together (one diagram)

```
                          ┌──────────────────────────────────────────────┐
   End user message  ──▶  │              DirectChatService                 │
                          │  (generic engine — unchanged as we add things) │
                          └──────────────────────────────────────────────┘
                                 │            │              │
              reads agent config │            │ assembles    │ runs tool loop
                                 ▼            ▼ prompt        ▼
                       ┌──────────────┐  ┌──────────┐  ┌──────────────────────┐
                       │ DataSchema   │  │ System   │  │ Enabled Tools         │
                       │ (fields the  │  │ prompt   │  │ (per-agent registry)  │
                       │  bot collects)│ │ layers   │  │  → ToolExecutor       │
                       └──────────────┘  └──────────┘  └──────────────────────┘
                                 │                              │
                 LLM fills it via│                  LLM calls   │ via ONE safe
                 save_data tool  ▼                  a tool      ▼ outbound HTTP
                       ┌──────────────────┐              ┌──────────────────────┐
                       │ CollectedData     │             │ Customer's API / CRM  │
                       │ (JSONB, our DB)   │             │ / OTP / anything      │
                       └──────────────────┘              └──────────────────────┘
                                 │
                 on capture, emit│ event
                                 ▼
                       ┌──────────────────────────────────────────┐
                       │ Destinations (fan-out, additive)          │
                       │  • our DB (always)                        │
                       │  • outbound webhook   ┐                   │
                       │  • CRM connector      ├ via SAME safe      │
                       │  • their bucket/DB    ┘  outbound executor │
                       └──────────────────────────────────────────┘
```

Three new pieces of **config** (DataSchema, Tool registry, Destinations) and three new **generic engines** that read them. `DirectChatService` keeps its shape forever — it just reads more config.

---

## 3. Problem 1 — Dynamic data capture per bot

**Pattern (what Typeform, Notion, Intercom, HubSpot, Salesforce all converge on):** separate the *field definitions* (metadata: "what fields exist") from the *values* (the actual collected data). Customers edit definitions through the UI; the AI fills values.

### 3.1 Store field *definitions* in a typed table (not in JSONB)

New Prisma model, e.g. `AgentDataField`, scoped by `organizationId` + `agentId`, one row per field:

```
AgentDataField {
  id, organizationId, agentId,
  key          // machine name, e.g. "email"  — IMMUTABLE (see pitfall)
  label        // "Email address"
  dataType     // enum: string | number | boolean | date | email | phone | enum
  required     // bool
  options      // Json? (for enum/select)
  validation   // Json? (regex/min/max)
  order, isArchived, createdAt, updatedAt
}
```

Why a real table, not JSONB: we list/validate/render these constantly and must enforce `key` uniqueness per agent. (This is exactly Intercom's "Custom Data Attributes" model and Typeform's `fields[]` model.)

### 3.2 Store the collected *values* as one JSONB column

On the per-conversation row (e.g. `ChatSession`, or a dedicated `CollectedData` table):

```
CollectedData {
  id, organizationId, agentId, chatSessionId,
  data        Json    // { "name": "...", "email": "...", "phone": "..." }
  createdAt, updatedAt
}
```

- Keep the **near-universal fields** (name, email, phone) as **real typed columns** since most bots collect them and we'll filter/report on them. Everything bespoke lives in `data` (JSONB). This hybrid is the Postgres-community consensus.
- **Do NOT use EAV** (an attribute-per-row table). It's the documented anti-pattern — slow multi-field writes, query explosions. JSONB with a GIN index does multi-field filters in ~0.5ms across 100K rows.
- **Do NOT do per-customer `ALTER TABLE`.** Even Salesforce refuses to; they emulate columns via metadata. JSONB is our equivalent, simpler.

### 3.3 Validate against the per-tenant schema (two layers)

- **App layer (primary):** build a validator at runtime from the `AgentDataField` rows. Because the schema is stored in the DB and read at runtime, **JSON Schema + Ajv** fits better than compile-time Zod here. (We already use Zod for static DTOs — keep that; use Ajv for the dynamic per-tenant part.)
- **DB layer (defense-in-depth, free on Supabase):** `pg_jsonschema` extension exposes `jsonb_matches_schema()` usable in a `CHECK` constraint, so invalid payloads are rejected at write time. *(Verify the extension is enabled on our Supabase — see Section 10.)*

### 3.4 How the AI fills it

The `AgentDataField` rows become the input schema of a built-in **`save_collected_data` tool** (this is the first user of the tool-calling pipeline in Section 5). The system prompt gets a layer: *"Collect the following during conversation: name, email, phone. You have so far: {name: 'Dhruv', email: missing}. When you learn a value, call save_collected_data."* The model drives the conversation to fill gaps and calls the tool — no regex parsing.

### 3.5 Reporting later without a rewrite ("hot-field promotion")

- GIN index on `data` for general containment filters.
- When a specific field becomes hot/reportable, promote it to a `GENERATED ALWAYS AS (data->>'x') STORED` column and B-tree index it. Generated columns beat GIN/expression indexes for equality filters and keep accurate planner stats. ~40 bytes/row for ~4 typed columns.
- This matches our existing note *"aggregate in the DB on typed columns"* (`project_analytics_db_aggregation`). Clean upgrade path: ship JSONB → promote hot fields → never migrate the model.

### 3.6 Pitfalls (Problem 1)
- Field `key` and `dataType` are **immutable**; to "rename," archive + recreate (Intercom's rule). Renaming a JSONB key means rewriting every historical row.
- If `WHERE data->>'x'` shows up in most queries, that field should already be a promoted column.
- Always scope every query by `organizationId` (see Section 7.4 RLS backstop).

---

## 4. Problem 2 — Where the data lives, and "we want it in our DB"

### 4.1 The honest reality
**95% of "store it in our systems" requests = "deliver it to our CRM / our webhook," not "host it in our database."** True data-residency / BYO-DB is a rare, funded, enterprise-tier feature. Serve the common case cheaply; keep the rare case as an additive escape hatch.

### 4.2 The destination/sink abstraction (Segment's model)

Three concepts:

1. **Canonical event** — on data capture, emit one normalized record: `LeadCaptured { orgId, agentId, conversationId, fields{}, occurredAt, eventId }`. Single source of truth; destinations never reach into raw tables.
2. **DestinationType (code, additive)** — one handler per target type (`internal_db`, `webhook`, `hubspot`, `salesforce`, `google_sheets`, `s3_bucket`…), each implementing `validateConfig()`, `authenticate()`, `deliver(payload, config, secrets)`. **Adding a target = registering one handler. No core change.**
3. **DestinationInstance (data, per-tenant)** — a row owned by an org: `{ orgId, type, config(JSON: url, field-mapping, region), secretRef, enabled, eventFilter }`. Field mapping lives **per instance**, so two orgs map the same event to different CRM fields.

"Store in our DB" is just `internal_db` being destination #1. Everything else is more registered types.

### 4.3 Reliable delivery on our existing stack (outbox + BullMQ)

We already use BullMQ (WhatsApp inbound). Reuse it — no new infra.

- **Transactional outbox:** write a `delivery_outbox` row **inside the same Prisma `$transaction`** as the capture. Avoids the dual-write trap (crash between DB write and queue push loses/phantoms deliveries — BullMQ alone is not transactional with Postgres).
- **Relay:** worker polls `pending` rows with `SELECT ... FOR UPDATE SKIP LOCKED`, enqueues BullMQ jobs, marks `dispatched`. (Or Postgres `LISTEN/NOTIFY` for push.)
- **Delivery worker:**
  - **Sign:** HMAC-SHA256 over the **raw** body (`X-Webhook-Signature`), plus `X-Webhook-Timestamp` (reject >5min skew) and `X-Webhook-Id` for dedupe. Sign bytes, not re-serialized JSON. Follow the **Standard Webhooks** spec.
  - **Retries:** BullMQ `attempts` + exponential backoff **+ jitter**; tiered up to ~3 days (Stripe-style) or auto-disable after sustained failure (Shopify disables after 19 fails/48h).
  - **Failure classes:** 5xx/timeout/connection → retry; 4xx (except 429) → DLQ; 429 → respect `Retry-After`.
  - **DLQ + replay UI + delivery logs** (attempts, status, latency).
  - **Per-tenant isolation:** per-tenant rate limits + **per-endpoint circuit breaker** so one slow customer endpoint can't back up everyone (critical at 10K orgs).

### 4.4 The BYO-DB / residency spectrum (cheap → expensive)

| Tier | Means | Commonality | Cost |
|---|---|---|---|
| 1. Outbound webhook | We POST to their endpoint | Very common; covers most asks | **Cheap** (4.3) |
| 2. CRM connector | Per-tenant OAuth into HubSpot/Salesforce + mapping | Common | Low-moderate |
| 3. BYO bucket/warehouse | Write to their S3/GCS/Snowflake share | Occasional | Moderate |
| 4. Regional residency | Their data processed in their region | Enterprise/regulated | High (regional cells) |
| 5. BYOK / customer keys | They hold the encryption key | Premium enterprise | High |
| 6. Dedicated DB-per-tenant | Their own instance | Enterprise-only, deliberate | Very high |

**Future-proofing now (cheap, do it early):** add a `region` field to the tenant and keep all secrets/keys tenant-scoped from day one. Then tiers 4–6 become additive instead of a rewrite. The dominant real pattern is **"selective residency"** (customer content/processing in-region, control plane global — what Slack/OpenAI/GitHub do); full duplication is rarely needed.

---

## 5. Problem 3 — Dynamic integrations (the LLM tool registry)

This is the big one, and it's pure **LLM tool calling**. A tool is **data** (name + description + param schema); execution is a separate **declarative HTTP config**. The LLM only sees the data half; one generic engine runs the execution half. This is identical across OpenAI GPT Actions, Retell, Make, n8n, Zapier.

### 5.1 Data model

```
Tool {                          // the definition + how to run it
  id, organizationId,
  kind            // "http" | "mcp"
  name            // snake_case, ^[a-z0-9_]{1,64}$
  description     // ← the MOST important field; drives LLM selection
  inputSchema     Json          // JSON Schema of params the LLM fills
  enabled, isMutating           // isMutating → may need human-in-the-loop

  // execution (http kind):
  method, urlTemplate, headersTemplate Json, queryTemplate Json,
  bodyTemplate Json, bodyType,  // json | form | text
  timeoutMs,                    // default 10s, hard cap ~30s
  responseMapping Json,         // JSONPath/JMESPath; truncate to ~8–15k chars

  // auth:
  authType,                     // none | api_key | bearer | basic | oauth2
  authConfigEncrypted           // via CryptoService (AES-256-GCM)

  // mcp kind: stores server url + auth instead of an http template
}

AgentTool { agentId, toolId, enabled, overrides? }   // which tools each bot has
```

Template strings use a **tiny sandboxed placeholder syntax** — `{{args.x}}`, `{{secret.apiKey}}`, `{{agent.x}}`. **Do not** adopt a Turing-complete templating engine (Make's IML has conditionals — too much attack surface). Secrets resolve at call time only, never persisted resolved, never logged.

### 5.2 The generic executor (`ToolExecutorService`) — runs ALL http tools

1. Validate the LLM's `args` against `inputSchema` (Ajv) before doing anything.
2. Render url/headers/query/body from `args` + decrypted secrets + agent context (URL-encode injected values).
3. **SSRF defense (mandatory — see Section 7.1).**
4. Attach auth per `authType` (api key → header/query; bearer; basic; oauth2 → fetch/refresh + cache token).
5. Execute with hard timeout + small retry budget (tighter than Retell's 2-min/2-retry — use ~10s + 1 retry for chat UX) + circuit breaker per host.
6. Map response via `responseMapping`, **truncate** (Retell caps at 15k chars); on non-2xx return a structured error string the model can reason about, don't throw.

This is the **same safe outbound executor** that webhook delivery (4.3) uses. Build once; nothing else makes raw outbound calls.

### 5.3 Plugging into the AI SDK loop (per chat turn, in DirectChatService)

1. Load the agent's enabled `AgentTool`s (single indexed query; **cache** the assembled definitions — they change rarely).
2. Build a `Record<string, Tool>`: for each row, an AI SDK `tool({ description, inputSchema, execute })` (or `dynamicTool` for runtime-built schemas) where `execute(args)` calls `ToolExecutorService.run(...)`.
3. `streamText({ model, messages, tools, stopWhen: stepCountIs(N) })` with **N small (5–8)** for chat latency/cost. The SDK feeds each tool result back and re-prompts automatically.
4. `toolChoice: 'auto'`. Persist `response.messages` so tool calls/results survive across turns.

> **Codebase note / correction:** our `LlmCompletionRequest` already has `tools?` and `maxSteps` wired into `streamText` ([llm.service.ts](../../apps/api/src/modules/ai/llm.service.ts)) — currently dormant. The **current Vercel AI SDK replaces `maxSteps` with `stopWhen: stepCountIs(...)`**. Confirm our AI SDK version and migrate the loop control accordingly (Section 10).

### 5.4 MCP, OpenAPI, or custom registry?

**Build the custom declarative registry as the core. Add MCP as an optional adapter. Use OpenAPI only as an importer.**

- **MCP** (Model Context Protocol) is *the* interoperability standard as of 2026 (Anthropic → donated to Linux Foundation's Agentic AI Foundation, adopted by OpenAI, 10k+ servers). **But it's a transport/runtime protocol, not a storage/config schema.** Our customer isn't standing up a server — they're typing a URL + API key into a form. Forcing every integration to be an MCP server adds connection-lifecycle overhead for zero benefit at single-HTTP-call granularity.
  - **Do** add inbound MCP cheaply later: let advanced orgs paste a remote MCP server URL; at request time `createMCPClient({transport:{type:'http',url,headers}}).tools()` and merge into the same loop. This taps the whole ecosystem (incl. Zapier MCP's 9k apps) with no connectors built. *(MCP client is `createMCPClient` from `@ai-sdk/mcp`.)*
- **OpenAPI** specs are written for humans; models misread them and they over-expose endpoints. Great as an **import** format (parse spec → pre-fill registry rows), poor as a runtime/authoring model.

### 5.5 Tool-description quality (this is what makes the LLM call the right thing)
The model picks purely on `name` + `description` + param descriptions. Write **task-oriented** descriptions ("Verify a customer's identity by sending an OTP to their phone") not endpoint-oriented ("POST /otp"); say when to use AND when not to; give types/enums/ranges on every param; prefer **few high-level tools** over many low-level ones. Guard against eager invocation (calling tools on "hello") and, for large catalogs, filter/RAG-over-tools before the call.

### 5.6 UI/UX (non-technical customers) — mirror Retell/Zapier/Make
- **Catalog view:** cards of prebuilt templates (OTP verify, fetch customer, push lead to CRM) + a "Custom HTTP tool" option. We already have an Integration tab in [agent-editor-sidebar.tsx](../../apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx).
- **Per-tool config form:** friendly name + description; auth picker (None/API Key/Bearer/OAuth2) that conditionally renders fields and stores via CryptoService; a param builder (key/type/description/required) that generates the JSON Schema behind the scenes; method + URL + headers/body with `{{param}}` insert chips; a **"Test" button** that runs the executor with sample args and shows the live response (essential for non-devs); optional response-mapping picker. Borrow Zapier's "let AI fill this field" toggle for optional params.
- **Per-agent screen:** simple enable/disable toggles over the org's tool catalog (the `AgentTool` join).

### 5.7 Pitfalls (Problem 3)
SSRF (Section 7.1); tool-description/metadata injection ("tool poisoning"); secret handling (decrypt at call only, never log); uncapped response size (truncate); too many tools (selection accuracy drops); loop runaway (tight `stopWhen`); **self-execute** the call (Retell/Make model) rather than the Vapi webhook-to-your-server model since customers aren't developers; idempotency for mutating tools (model may call twice).

---

## 6. Problem 4 — Context & prompt (how the LLM "knows what to do")

We already assemble the system prompt in layers in `DirectChatService` (persona → knowledge → fallback). We add layers — **never** stuff tools into prompt text; they go in the API's native `tools` parameter as structured definitions.

```
Layer 1  Persona / system prompt           (existing)
Layer 2  Knowledge / RAG context           (existing)
Layer 3  Data-collection instructions      (new: "collect X,Y,Z; have so far: {...}")
Layer 4  Tool-usage guidance               (new: short note; tools themselves via `tools` param)
Layer 5  Fallback phrases                   (existing)
```

- **"How does it know what to do with the data?"** → the tool's `description` says it ("When you have the order ID, call `lookup_order`"). That sentence is the program.
- **State:** track collected-so-far as a small JSON blob, re-injected each turn so the model knows what's still missing. That's the lightweight state machine.

---

## 7. Security — the hard gates (do not ship without these)

Our design, by default, instantiates the **"lethal trifecta"** (private data + untrusted content + an outbound channel) and is literally an **SSRF engine** (we execute customer-supplied URLs). This is normal for this product category and every risk has a clear, mostly **build-once** mitigation. **~80% of protection is one shared "safe outbound HTTP executor"** that both tools (5.2) and webhooks (4.3) route through. Nothing else may make raw outbound calls.

### 7.1 SSRF (P0, hard gate) — the safe outbound executor
- Scheme allowlist (`https`, `http` only); block `file/gopher/ftp/dict/data`. Port allowlist (80/443).
- Resolve host → reject **all** private/reserved IPs: RFC1918, loopback, link-local, **metadata `169.254.169.254` / `metadata.google.internal`**, multicast, `0.0.0.0/8`. Check A *and* AAAA.
- **DNS pinning** (the #1 bypass / rebinding defense): resolve once, validate, **pin that IP** for the actual connection via a custom `lookup` on the HTTP agent. Naive "validate-then-connect" resolves DNS twice and is exploitable — there are live 2026 CVEs on exactly this (FastGPT, Postiz, etc.).
- **Disable redirect following** (or re-validate every hop).
- **Node caveat:** global `fetch`/undici exposes no agent hook for this — use a client that accepts a custom agent (`request-filtering-agent` / `ssrf-agent-guard` as references).
- **Network layer:** default-deny egress for executor workers + **enforce IMDSv2 with hop limit** so even a successful metadata SSRF can't grab cloud role creds.

### 7.2 Credential isolation (P0, hard gate)
- Resolve which credential to use from **server-side tenant context only — never from LLM output or tool args** (this is the confused-deputy / Microsoft Power Platform 2023 breach class: a shared execution layer for tenant-configured connectors leaked OAuth secrets across tenants — *our exact architecture*).
- Composite-key ownership check on the credentials table (BOLA).

### 7.3 Tool-call validation + break the trifecta (P0, hard gate)
- **Platform controls the per-conversation tool allowlist**, not the model.
- **Schema-validate every proposed tool call** (allowed tool, allowed host/method, param types/enums/ranges) before executing. Treat LLM output as untrusted.
- Lock down egress on tools AND webhooks (same executor) so a context with private data + untrusted content has no free exfiltration channel. Consider a quarantined/dual-LLM stage to parse untrusted tool/KB results into validated fields.

### 7.4 P1 (before meaningful scale)
- **Envelope encryption:** keep AES-256-GCM for data (DEK), wrap DEKs with a **per-tenant KEK in KMS/Vault**. A single app-held master key over 10K tenants is an accepted MVP shortcut but must be on a committed migration path — one app compromise otherwise exposes every tenant's keys. (Open-source option: self-hosted HashiCorp Vault.)
- **Postgres RLS backstop:** transaction-scoped tenant context, non-`BYPASSRLS` role, `tenant_id` as **leading index column**. Turns a forgotten `WHERE org_id` (in exports/analytics/jobs — where leaks actually happen) into zero rows.
- **Abuse/cost controls:** Redis-backed per-tenant/per-conversation rate limits (note `@nestjs/throttler` default storage is per-instance — use Redis storage); per-destination-host caps; opossum circuit breaker per host; bulkhead concurrency cap; agent-loop caps (max iterations, per-run token/cost budget, wall-clock timeout, duplicate-call debounce); decompression-bomb guard; **pin undici ≥6.23.0/7.18.2** (CVE-2026-22036).
- **Human-in-the-loop** for sensitive/irreversible (`isMutating`) tools — placed at the tool, not the top agent (blanket approval causes ~93% rubber-stamp fatigue).

### 7.5 P2 (ongoing discipline)
Secret-log redaction + secret scanning; OAuth refresh rotation + reuse detection; authz tests in CI (fail the build); per-tenant spend alerts; egress anomaly monitoring; adversarial red-teaming of injection paths.

---

## 8. The additive guarantee — why you never rewrite

The test that proves it: **"To add a new bot / field / integration / destination, do I change code or add data?"** In this design the answer is always **add data** (a row, a filled form). `DirectChatService` keeps its shape; it just reads more config.

There is exactly **one discipline** that protects this:

> **Never write `if (customer === "ClientX") { ...special... }` in the code.** Everything customer-specific is data, never code.

Adding a genuinely new *capability* (a new auth type, a new destination type, a new field data-type) = registering **one** new handler/enum value in a generic engine — still additive, no flow rewrite. That's the ceiling of what you'll ever touch.

---

## 9. Phased build plan (each phase ships standalone value)

| Phase | What | Unlocks | Effort | Security gates needed |
|---|---|---|---|---|
| **A — Data capture** | `AgentDataField` + `CollectedData` (JSONB) + Ajv validation + wire the dormant `tools` slot for one `save_collected_data` tool + editor UI (form builder) | Every bot (sales/HR/support) captures structured data. Proves the tool pipeline end-to-end on the smallest surface. | Small–medium (scaffolding exists) | Tool-call validation; tenant scoping |
| **B — Integrations** | `Tool` + `AgentTool` registry + **safe outbound `ToolExecutorService`** + AI SDK `stopWhen` loop + catalog/config UI with Test button | "Any integration" — customers self-serve OTP/lookup/CRM-push | Medium | **All P0 gates (7.1–7.3)** + P1 abuse controls |
| **C — Destinations** | Canonical event + outbox + BullMQ relay + `webhook` DestinationType (then `hubspot`/`salesforce`) + delivery logs/DLQ/replay UI | "Get my data into my systems" | Medium | Reuse safe executor; webhook signing |
| **D — Enterprise (only when funded)** | BYO bucket/warehouse → regional cells → BYOK → dedicated DB | Enterprise residency upsell | Large | Per-tenant KEK; regional isolation |

**Start with Phase A.** It's the smallest thing that proves the scary part (LLM filling a custom schema via tools) actually works, and it needs only the lightest security.

**Prep now, cheaply (avoids future rewrites):** add `region` to the tenant; keep all secrets tenant-scoped; decide the KMS/Vault path before the credential store grows.

---

## 10. Open items to confirm in our codebase (verification TODO)

1. **AI SDK version** — does our installed `ai` package use `maxSteps` (older) or `stopWhen`/`stepCountIs` (current)? Our code has `maxSteps`; migrate if needed. Confirm `@ai-sdk/mcp` availability for the MCP adapter.
2. **`pg_jsonschema`** — confirm the extension is enabled on our Supabase project (for the DB-layer CHECK constraint).
3. **BullMQ** — confirm the queue infra used by WhatsApp inbound is reusable for the delivery worker (expected yes).
4. **CryptoService** — confirm it's structured so we can move from single-master-key to per-tenant-KEK envelope encryption without a data migration nightmare.
5. **Egress / hosting** — what does our host (Render?) allow for default-deny egress + IMDSv2 hop-limit enforcement (Section 7.1)?

---

## 11. Verification verdict (across every POV)

- **Industry / real-world:** ✅ Every piece matches the converged 2025-2026 pattern (Segment destinations, Retell/Make declarative tools, JSONB+generated columns, MCP-as-adapter). We are copying a paved road.
- **Architecture / additive:** ✅ Each problem is "config as data + one generic engine." New bots/fields/integrations/destinations = data, not code. The one rule (Section 8) preserves this indefinitely.
- **Scale (10K orgs):** ✅ JSONB + GIN + promoted columns; cached tool assembly; per-tenant rate limits + circuit breakers; outbox on existing Postgres+BullMQ (no new infra). Aligns with `project_analytics_db_aggregation`.
- **Security:** ⚠️→✅ Inherently high-risk category (SSRF engine + lethal trifecta + cross-tenant credential surface), but **safe to build** if the three P0 hard gates (7.1–7.3) ship with the feature and the safe outbound executor is the only outbound path. ~80% is build-once.
- **Cost / open-source:** ✅ Reuses Postgres + BullMQ + CryptoService; KMS is ~$1/key/mo or self-host Vault. No mandatory new paid infra.

---

## 12. Key sources
- **Data modeling:** Postgres JSONB vs EAV (bswen, EDB anti-patterns, coussej), Salesforce UDD architecture (Cirra), Notion data model, Intercom CDAs, Typeform fields, Supabase `pg_jsonschema`, generated columns (richyen).
- **Tool calling:** OpenAI GPT Actions, Retell custom functions, Vapi tools, Make.com requests, n8n AI Agent, Vercel AI SDK tools/`stopWhen`/MCP, MCP governance (Anthropic/Linux Foundation), MCP-vs-API (Tinybird, Auth0).
- **Destinations:** Segment Action Destinations, Hightouch/Census reverse-ETL, Stripe/Shopify webhooks, transactional outbox (pg-transactional-outbox), Standard Webhooks spec, WorkOS data-residency.
- **Security:** OWASP SSRF / API1/API4/API5 / LLM01/05/06 cheat sheets, OWASP Node.js SSRF prevention, Simon Willison (lethal trifecta, dual-LLM), Anthropic "How we contain Claude", AWS SaaS Lens + Postgres RLS, RFC 9700 (OAuth BCP), Microsoft Power Platform breach (Tenable), undici CVE-2026-22036.
