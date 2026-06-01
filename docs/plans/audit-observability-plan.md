# Audit & Observability Logging — Implementation Plan

**Status:** Draft / pending approval
**Author:** Engineering (AI-assisted)
**Date:** 2026-05-31
**Scope:** `apps/api` (NestJS). No frontend work.

---

## 1. Goal

Capture a complete, queryable record of every state-changing API action and every
third-party (LLM / voice) call, including:

1. **Who** made the change — internal `userId` + `auth0Id` (already have).
2. **Event type** — `AGENT_UPDATED`, `ORG_ADDED`, `AGENT_DELETED`, … (already have).
3. **Raw HTTP request** — method, URL, **headers** (redacted), and **body**.
4. **Raw HTTP response** — status code + response body.
5. **Entity linkage** — dedicated `agentId` and `organizationId` columns, populated
   automatically when the request concerns an agent / org.
6. **Third-party calls** — full request + response payloads for LLM and voice
   provider calls, linked to the `agentId` they were made for.

The guiding constraint (from `CLAUDE.md`): must scale to **10K orgs**, must not break
production, minimum cost, open-source. That makes **redaction, size caps, async writes,
and retention** first-class parts of this plan, not afterthoughts.

---

## 2. What exists today (baseline)

| Capability | Where | State |
|---|---|---|
| `userId` / `auth0Id` / `correlationId` capture | `correlation-id.middleware.ts` + `logging.interceptor.ts` → `RequestContext` (AsyncLocalStorage) | ✅ |
| Semantic event names | `common/logger/*.logger.ts` → `TracerService.logAuditEvent()` | ✅ |
| Persisted audit rows | `audit_logs` table (`AuditLog` model) | ✅ business object only |
| HTTP method/URL | logged to **stdout only** by interceptor/middleware | ⚠️ not persisted |
| Request headers / body | **nowhere** | ❌ |
| Response body / status | **nowhere** | ❌ |
| `agentId` / `orgId` columns | only generic `contextId` | ❌ |
| LLM call metadata | `chat_traces` + `llm_usage` (tokens/cost/latency) | ⚠️ metadata only |
| LLM raw req/resp payloads | **nowhere** (only `userMessage` + final `response` text) | ❌ |
| Voice provider req/resp | stdout error logs only | ❌ |
| AI trace file | `logs/ai-trace.log` (pino, 7-day rotation, ephemeral) | ⚠️ not durable, not linked |

Key files:
- `apps/api/prisma/schema.prisma` → `AuditLog` (L289), `ChatTrace` (L312)
- `apps/api/src/common/tracer/tracer.service.ts`
- `apps/api/src/common/tracer/correlation.storage.ts`
- `apps/api/src/middleware/correlation-id.middleware.ts`
- `apps/api/src/interceptors/logging.interceptor.ts`
- `apps/api/src/filters/all-exceptions.filter.ts`
- `apps/api/src/common/logger/{agent,organization,user,invitation,auth0,email}.logger.ts`
- `apps/api/src/modules/ai/llm.service.ts` (LLM call site)
- `apps/api/src/modules/ai/usage-tracking.service.ts` (`llm_usage` writer)
- `apps/api/src/modules/ai/trace/ai-trace.service.ts` (`chat_traces` writer)
- `apps/api/src/modules/voice/providers/{elevenlabs,sarvam}.provider.ts`

---

## 3. Design overview

Three layers, each independent and each best-effort (never blocks/fails the request):

```
 HTTP request ──► CorrelationIdMiddleware (captures method/url/headers/body into ALS)
              ──► Guards (UserSyncGuard sets user.id, auth0Id, organizationId)
              ──► HttpAuditInterceptor  ◄── NEW: enriches ALS, captures response,
              │       writes one api_request_logs row per write request (async)
              ──► Controller ──► Service ──► domain *.logger.ts (existing AUDIT events)
                                       └──► LLM / voice provider
                                              └──► ThirdPartyCallLogger ◄── NEW
```

We deliberately split **two concerns into two tables** rather than overloading
`audit_logs`:

- **`api_request_logs`** — one row per HTTP write request (the raw req/resp envelope).
- **`third_party_call_logs`** — one row per outbound LLM/voice call.

`audit_logs` (semantic business events) stays as-is but gains `agentId`/`organizationId`
columns. All three share `correlationId` so you can stitch a full story:
*"request X by user U → emitted AGENT_UPDATED → made 1 LLM call + 1 TTS call."*

### Why a new table instead of stuffing it all into `audit_logs`?
- `audit_logs` is keyed on *semantic events* emitted deliberately by services. Not every
  write emits one (coverage is partial). The raw HTTP envelope must be captured
  **automatically for every write**, independent of whether a service logged an event.
- Raw bodies/headers are large and sensitive; isolating them lets us apply a different
  retention/redaction policy and keep `audit_logs` lean and fast to query.

---

## 4. Schema changes (Prisma)

### 4.1 Extend `AuditLog` — add entity columns (keep `contextId` for back-compat)

```prisma
model AuditLog {
  id             String   @id @default(uuid())
  correlationId  String?
  userId         String?
  auth0Id        String?
  contextId      String                 // kept; == agentId or orgId historically
  agentId        String?                // NEW — populated when event concerns an agent
  organizationId String?                // NEW — populated when event concerns an org
  event          String
  data           Json
  createdAt      DateTime @default(now())

  @@index([event])
  @@index([contextId])
  @@index([agentId])                    // NEW
  @@index([organizationId])             // NEW
  @@index([userId])
  @@index([auth0Id])
  @@index([correlationId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### 4.2 New `ApiRequestLog` — raw HTTP envelope for write actions

```prisma
model ApiRequestLog {
  id             String   @id @default(uuid())
  correlationId  String?
  userId         String?
  auth0Id        String?
  organizationId String?
  agentId        String?                // resolved from route params when present
  method         String                 // POST | PUT | PATCH | DELETE
  route          String                 // path template, e.g. /agents/:id  (low-cardinality)
  url            String                 // full originalUrl incl. query
  statusCode     Int?
  requestHeaders Json                   // redacted
  requestBody    Json?                  // redacted + size-capped
  responseBody   Json?                  // redacted + size-capped
  durationMs     Int?
  ip             String?
  userAgent      String?
  errorMessage   String?                // set when the request threw
  createdAt      DateTime @default(now())

  @@index([correlationId])
  @@index([organizationId])
  @@index([agentId])
  @@index([userId])
  @@index([route])
  @@index([statusCode])
  @@index([createdAt])
  @@map("api_request_logs")
}
```

### 4.3 New `ThirdPartyCallLog` — outbound LLM / voice calls

```prisma
model ThirdPartyCallLog {
  id             String   @id @default(uuid())
  correlationId  String?
  organizationId String?
  agentId        String?
  traceId        String?                // links to ChatTrace when available
  provider       String                 // openrouter | openai | groq | gemini | elevenlabs | sarvam
  kind           String                 // LLM | STT | TTS
  operation      String                 // generateCompletion | streamCompletion | transcribe | synthesize
  model          String?                // model id (LLM) or voice id (TTS)
  requestPayload Json                   // redacted + size-capped (messages, params, audio meta — NOT raw audio bytes)
  responsePayload Json?                 // redacted + size-capped (text, finishReason, transcript)
  statusCode     Int?
  success        Boolean  @default(true)
  errorMessage   String?
  latencyMs      Int?
  createdAt      DateTime @default(now())

  @@index([correlationId])
  @@index([agentId])
  @@index([organizationId])
  @@index([traceId])
  @@index([provider])
  @@index([kind])
  @@index([createdAt])
  @@map("third_party_call_logs")
}
```

> **Audio note:** we store STT/TTS **metadata** (byte length, format, sample rate, voice
> id, language) and the **text** side, never raw audio blobs — those are huge and low
> value in a log. This keeps cost down at 10K-org scale.

Migrations: one additive migration per table change. All columns nullable / defaulted →
no backfill needed, zero-downtime safe.

---

## 5. Redaction, size caps, sampling (cross-cutting — build FIRST)

A single shared utility `apps/api/src/common/audit/redaction.util.ts`:

- **Header redaction:** strip/replace `authorization`, `cookie`, `set-cookie`,
  `x-api-key`, `xi-api-key`, `proxy-authorization` → `"[REDACTED]"`.
- **Body field redaction:** deep-walk JSON, redact keys matching
  `/password|secret|token|apiKey|api_key|authorization|credential|ssn|card/i`.
- **Size cap:** `MAX_LOG_PAYLOAD_BYTES` (default 32 KB). If a serialized payload exceeds
  it, truncate and store `{ _truncated: true, _originalBytes: n, preview: "…" }`.
- **Binary guard:** never serialize Buffers/streams/multipart file parts — replace with
  `{ _binary: true, bytes, mime }`.

Config (env, all with safe defaults):
- `AUDIT_HTTP_ENABLED` (default true)
- `AUDIT_THIRDPARTY_ENABLED` (default true)
- `AUDIT_MAX_PAYLOAD_BYTES` (default 32768)
- `AUDIT_SAMPLE_RATE` (default 1.0 — sample non-mutating high-volume routes later if needed)
- `AUDIT_RETENTION_DAYS` (default 90)

---

## 6. Layer 1 — HTTP request/response capture

### 6.1 Extend `RequestContext` (`correlation.storage.ts`)
Add `organizationId?`, `agentId?`, `ip?`, `userAgent?`, `requestHeaders?`,
`requestBody?` to the interface.

### 6.2 `CorrelationIdMiddleware`
Capture `req.headers`, `req.body` (after body parsing — middleware runs after Nest's
body parser), `req.ip`, `req.headers['user-agent']` into the ALS context. (Redaction
happens at write time, not here, to keep the hot path cheap.)

### 6.3 New `HttpAuditInterceptor` (replaces/extends `LoggingInterceptor`)
- Runs after guards, so `req.user` (`id`, `auth0Id`, `organizationId`) is populated →
  enrich ALS (this already happens for userId/auth0Id; add organizationId).
- Resolve `agentId` from route params (`req.params.id` / `:agentId`) **only on
  agent-scoped routes** — use a small route→entity map or the route path pattern.
- Determine `route` template via `context.getHandler()` + reflector metadata (low
  cardinality, good for indexing) and `url` from `originalUrl`.
- On `next.handle()` completion (`tap`), for **mutating methods only**
  (`POST/PUT/PATCH/DELETE`): capture status + response body, then **fire-and-forget**
  a write to `api_request_logs` via a new `HttpAuditService` (async, try/catch, never
  throws — mirrors `TracerService` and `AiTraceService` patterns).
- Keep the existing one-line stdout log for dev visibility.

### 6.4 `AllExceptionsFilter`
On error path, also persist an `api_request_logs` row with `errorMessage` + status, so
failed writes are audited too. (Filter already has the request; add the async write.)

> **Decision — sync vs async write:** writes are fire-and-forget (`void
> service.write(...)`) so audit never adds latency to the user request. Acceptable
> trade-off: a crash between response and write loses that one audit row (same guarantee
> the existing `ChatTrace`/`AuditLog` writes already accept).

---

## 7. Layer 2 — Entity linkage in domain loggers

- Update `TracerService.logAuditEvent()` signature to accept optional
  `{ agentId?, organizationId? }` and write them to the new columns (falls back to
  reading `organizationId` from ALS context).
- Update the six domain loggers so `agent.logger.ts` passes `agentId`,
  `organization.logger.ts` passes `organizationId`, etc. `contextId` stays populated for
  back-compat.
- No behavior change for callers (services call the same logger methods).

---

## 8. Layer 3 — Third-party call capture

New `ThirdPartyCallLogger` service (`apps/api/src/common/audit/third-party-call.logger.ts`)
with one method `log(entry)` that redacts + size-caps + fire-and-forget persists to
`third_party_call_logs`, pulling `correlationId`/`organizationId`/`agentId` from ALS.

### 8.1 LLM — `llm.service.ts`
Single chokepoint already (`generateCompletion` + `streamCompletion`). Wrap both:
- **Request payload:** `{ modelId, systemPrompt, messages, temperature, maxTokens, topP, tools? }`
  (redacted — system prompts can contain secrets/PII; size-capped — message history is large).
- **Response payload:** `{ text, finishReason, usage, cost, actualModel }`.
- For streaming, log on `completion` promise resolution / rejection (we already have a
  clean resolve/reject point at L248/L265).
- `provider` derived from `parseModelId()`; `agentId` from `request.agentId` (already on
  the request object — see L417).

### 8.2 Voice — `elevenlabs.provider.ts` + `sarvam.provider.ts`
Wrap `transcribe` / `synthesize*`:
- **Request:** `{ provider, operation, model/voiceId, languageHint, audioBytes, audioMime }`
  (no raw audio).
- **Response:** STT → `{ transcript, confidence, detectedLanguage, latencyMs }`;
  TTS → `{ audioBytes, format, latencyMs }`.
- Also log non-OK responses + network errors (the `handleErrorResponse` / `handleNetworkError`
  paths) with `success:false` + `errorMessage`.
- `agentId` is **not currently passed** into voice providers → thread it through the
  `STTRequest`/`TTSRequest` interfaces (small change in `voice-stream.interface.ts` +
  `voice.service.ts` call sites). **This is the one cross-cutting change that touches
  more than the logging layer — flagged for review.**

---

## 9. Retention, lifecycle & cost control (10K-org scale)

**Core principle: audit data is TIERED, not deleted.** You cannot predict when an old
record will be needed (a dispute, security investigation, or compliance request can
surface a year+ after the event). Hard time-based deletion destroys evidence you may need
later, so it is *not* the default. What gets expensive is keeping everything **hot**
(indexed, in primary Postgres, in every backup) — so the lever we pull is *moving old
data to cheaper storage*, not erasing it.

### 9.1 The tiers
- **Hot (default: last 90 days)** — in Postgres, fully indexed, instant queries. ~99% of
  lookups are recent. (Window configurable; tiering itself is **phase 2**, not v1.)
- **Cold (older than hot window)** — still retained, moved to cheap storage: a *detached
  Postgres partition* or compressed JSON in object storage (§11.5). Slower to query but
  **always retrievable** — this is what answers "we need a record from 14 months ago."
- **Delete — essentially never.** Only for legally-mandated erasure (see §9.3), never a
  blanket time purge.

### 9.2 v1 behavior (confirmed)
- **Nothing is deleted. Keep forever.** The cleanup job is *built* (lever exists) but
  ships **disabled**: `AUDIT_RETENTION_DAYS=0` = never delete. `audit_logs` (semantic
  business record) is never auto-deleted regardless.
- Tiering/archival is **not built in v1** — only enabled later if hot storage actually
  strains Postgres. The schema (metadata columns split from JSON payload, §11.5) makes
  adding it painless.

### 9.3 Legally-mandated deletion (different from retention purge)
- **Right to erasure (e.g. GDPR):** may *require* deleting a specific subject's personal
  data on request — a targeted by-user redaction, NOT a time-based purge. The redaction
  util (§5) isolates PII so it can be scrubbed from a row without dropping the audit event.
- **Payments/fintech retention mandates:** audit records in this domain are commonly
  subject to **multi-year mandatory retention (often 5–7 years)**. This pushes hard toward
  keep-long / archive-don't-delete and makes early deletion a *compliance risk*. ⚠️ Confirm
  the actual regulatory retention period that applies — it sets the floor for any future
  tiering policy.

### 9.4 Volume note
At 10K orgs, writes + LLM/voice calls could reach millions of rows/day. Mitigations baked
in regardless of tier: writes-only (no GETs), 32KB size caps, no raw audio bytes, indexes
chosen for real query patterns (org, agent, correlationId, time). Postgres `Json` columns
are TOAST-compressed automatically. Phase-2 levers if needed: monthly **partitioning** of
`third_party_call_logs` (archive/detach old months without slow DELETEs) and/or S3 offload.

---

## 10. Build sequence (PR-sized stories)

1. **Foundation** — redaction util + config + extend `RequestContext`. (No behavior change.) + unit tests.
2. **Schema** — Prisma migration: `AuditLog` columns + `ApiRequestLog` + `ThirdPartyCallLog`. `prisma generate`.
3. **HTTP capture** — `HttpAuditService` + `HttpAuditInterceptor` (extend existing) + `AllExceptionsFilter` write. + unit tests.
4. **Entity linkage** — `TracerService` + 6 domain loggers populate `agentId`/`organizationId`. + update existing logger tests.
5. **Third-party — LLM** — `ThirdPartyCallLogger` + wire into `llm.service.ts`. + unit tests.
6. **Third-party — Voice** — thread `agentId` through voice interfaces + wire into both providers. + unit tests.
7. **Retention** — daily cleanup cron + env. + unit test.
8. **(Optional, phase 2)** — read APIs / admin UI to view logs; object-storage sink if volume demands.

Each story: backend unit tests in `apps/api/test/` (per `CLAUDE.md`), then
`bun run lint`, `bun run check-types`, `bun run build`, `bun run test:cov`.

---

## 11. Decisions (locked) + remaining sign-off

1. **GET requests — EXCLUDED ✅ (confirmed).** Capture writes only
   (POST/PUT/PATCH/DELETE) + failed requests. GETs are not logged (major volume saving).
2. **Retention — KEEP FOREVER ✅ (confirmed).** Cleanup job built but disabled by default
   (`AUDIT_RETENTION_DAYS=0`). See §9.
3. **Storage — POSTGRES v1 ✅ (confirmed).** No S3 now. See §11.5 for why FK concern is moot.
4. **Sync vs async writes** — fire-and-forget (no added latency; rare single-row loss on a
   crash between response and write, same guarantee existing `ChatTrace`/`AuditLog` writes
   accept). ✅ recommended — flag if you want synchronous instead.
5. **Sampling** — default 100% capture (since GETs are already excluded, volume is
   bounded). No sampling in v1.
6. **Voice `agentId` threading** — touches `STTRequest`/`TTSRequest` interfaces + voice.service
   call sites (§8.2). Only cross-cutting change outside the logging layer. ✅ flagged for review.

### 11.5 On foreign keys / S3 (clarification)

**Decision: NO FK constraints on the log tables. `agentId` / `organizationId` are
nullable `String` columns, no `@relation`.** This is deliberate and is the standard
pattern for audit/event/append-only tables — not a shortcut. Reasons:

1. **An audit row must outlive what it references.** With a real FK
   `audit_logs.agentId → agents.id`, agent deletion forces a bad choice:
   `CASCADE` wipes the audit history (including the record of the deletion itself),
   `RESTRICT` blocks the agent from ever being deleted, `SET NULL` keeps the row but
   loses which agent it was about. The `AGENT_DELETED` event can't have an FK to a row
   it exists to say is gone.
2. **Write-path cost/contention.** FK checks take a shared lock on the parent row on
   every insert — millions of log inserts/day would add latency + contention to a path
   that must stay invisible fire-and-forget.
3. **Fire-and-forget writes would silently fail.** We swallow log-write errors so logging
   never breaks a request; an FK violation (referenced row mid-delete) would throw and we'd
   silently lose the audit record. No FK = the row always lands.
4. **Not all refs are local rows** (third-party provider/model/external IDs).

Integrity is instead protected by: IDs written by trusted server code (not user input),
indexes on `agentId`/`organizationId` for fast querying, and `LEFT JOIN` + "deleted
agent" rendering in any viewer. Consistent with existing tables (`AuditLog.contextId`,
`ChatTrace.agentId`, `LlmUsage.agentId` are all FK-less string columns).

> FKs remain correct for *operational* tables (a `chat_message` is meaningless without
> its `session`). Audit tables are the explicit opposite case.
- **So S3 loses no integrity we have.** If we ever offload (phase 2), the queryable
  metadata (`agentId`, `organizationId`, `correlationId`, `createdAt`, `provider`) stays
  in Postgres alongside an `s3Key` pointer; only the large raw-payload JSON moves to S3.
  All filtering by agent/org/time still runs against Postgres exactly as in v1.

---

## 12. Explicit non-goals (v1)

- No frontend / admin viewer (phase 2).
- No raw audio byte storage (metadata + text only).
- No change to `chat_traces` / `llm_usage` (they stay as the metrics/replay source; the
  new third-party log is the raw-payload source — linked by `traceId`/`correlationId`).
- No log shipping to external SIEM (can add a sink later).
