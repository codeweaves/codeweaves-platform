# RAG + Agentic Integrations — Implementation Notes

**Shipped:** 2026-07-04 · branch `feature/rag-agentic-integrations`
**Based on:** [ai-orchestration-implementation-plan.md](./ai-orchestration-implementation-plan.md) (Phase 3 + 4), [rag-pipeline-deep-research.md](./rag-pipeline-deep-research.md), [agent-data-and-integrations-plan.md](./agent-data-and-integrations-plan.md)

This is what actually got built, and where it deviates from the plans (which predate several platform changes — notably BullMQ removal and chat moving fully to direct mode).

---

## What shipped

### 1. RAG knowledge base (per agent, multi-document, cited)

- **Models:** `AgentDocument` + `AgentDocumentChunk` (pgvector `vector(1536)` + generated `tsvector` column). Migration `20260704090000_rag_documents_and_integrations` enables the `vector` extension and creates HNSW (`m=16, ef_construction=200`) + GIN indexes. `organizationId` is denormalised onto both tables so tenancy lives in every query without joins.
- **Ingestion** (`apps/api/src/modules/rag/`): upload (PDF/DOCX/TXT/MD, shared extractor with the legacy static KB) or **URL ingestion** (SSRF-guarded fetcher: https/http only, default ports, DNS-resolved private/reserved/metadata IP rejection, no redirects, 5 MB cap, dependency-free HTML→text). Text extraction is synchronous (instant validation feedback); chunk+embed runs **in-process in the background** (`DocumentIngestionService`, 2-concurrent gate, PENDING→PROCESSING→READY/FAILED, dashboard polls).
- **Chunking strategies** (picker in the dashboard; each document remembers what it was indexed with; re-index applies the current choice):
  - `recursive` (default) — paragraph→line→sentence→word packing to 512 tokens, 50-token overlap
  - `markdown` — heading-aware sections first, headings carried into chunk metadata (better citations)
  - `fixed` — plain token windows
- **Retrieval strategies** (`RagRetrievalService`, raw SQL, always filtered by `agentId AND organizationId`):
  - `hybrid` (default) — vector + Postgres FTS fused with weighted RRF (k=60, 0.6/0.4) in ONE statement
  - `vector` — pure cosine over HNSW
- **Chat integration:** `DirectChatService` checks `hasReadyDocuments` (one indexed query), retrieves **in parallel** with knowledge/context/tool loading, injects a `[RETRIEVED KNOWLEDGE]` block **after** the static prompt sections (preserves provider prompt-cache prefix), instructs inline `[N]` citations, and extracts them post-stream into `metadata.citations` on the assistant message. Retrieval failures degrade to no-RAG (never break chat) and emit `RAG_RETRIEVAL_FAILED` audit events.
- **Embeddings:** `EMBEDDING_MODEL` env (default `openai:text-embedding-3-small`, 1536 dims). Changing dimensionality requires a migration + full re-index — warning documented in `.env.example`.

### 2. Agentic tool calling (concrete integrations, not a connector platform)

- **Providers** (`apps/api/src/modules/integrations/`): **HubSpot** (Private App token; `hubspot_find_contact`, `hubspot_save_contact` with create→409→update upsert) and **Slack** (incoming webhook pinned to `hooks.slack.com`; `slack_notify_team`). Static `ProviderRegistry` — adding a provider = one class + one enum value.
- **Why Private App token / webhook instead of OAuth:** no token expiry → no refresh machinery (the Nango-style lifecycle), self-serve in minutes, no app review. Revisit OAuth only when per-user consent is needed.
- **Credentials:** validated per provider (Zod), verified with a LIVE connection test on connect, AES-256-GCM encrypted at rest (CryptoService), never returned (masked `credentialHint` only), never logged (audit events carry arg KEYS only).
- **Chat integration:** `AgentToolsService` assembles the per-agent ToolSet each turn (one indexed query; decryption stays inside tool closures); merged with caller tools (handover's `connect_to_human` wins collisions); AI SDK runs the loop (`stopWhen: stepCountIs(5)` when integrations present). Tool execute wrappers convert failures to model-readable strings — a dead integration degrades the answer, never kills the stream.

### 3. Live step indicators (widget + demo page)

- `LlmService.streamCompletion` now consumes the AI SDK **fullStream**, surfacing `tool-call`/`tool-result` chunks. `DirectChatService` maps RAG + tool activity to a new `step` chunk (`{id, kind: 'rag'|'tool', label, status: 'active'|'done'|'error'}`, upsert-by-id) which the public controller forwards over SSE — unlike `trace` chunks, which stay internal.
- Widget renders steps in the typing-indicator slot ("Searching the knowledge base…" → "✓ Read policies.pdf", "Checking your CRM…" → "✓ Fetched customer data") and a "Sources" chip row under cited replies (URL sources link out, snippets on hover). Old widget builds ignore the unknown event — backwards compatible. Bundle stays ~54 KB gz (150 KB budget).

### 4. Dashboard

- New **Knowledge Base** editor section: document table (status badges, chunks/tokens, re-index, delete), file upload + Add-URL dialog, RAG toggle, chunking/retrieval strategy pickers, top-K slider (aiConfig fields → central Save; document ops are immediate).
- **Connected apps** in the Integration section: HubSpot/Slack cards with connect dialog (live-test errors surfaced inline), enable toggle, re-test, disconnect.

### 5. Security fix (cross-tenant IDOR)

`agent-knowledge.controller/.service` only checked `deletedAt` — any authenticated user could read/write any org's knowledge by UUID. Fixed via shared `assertAgentAccessible()` (`apps/api/src/utils/agent-access.util.ts`): CLIENT users are pinned to their `organizationId`, cross-tenant access 404s (existence not observable). **Every new endpoint (documents, integrations) uses the same helper**; regression tests cover the isolation. Retrieval SQL additionally filters by the denormalised `organizationId` at the chunk level (defense in depth).

---

## Deviations from the plans (and why)

| Plan said | We did | Why |
|---|---|---|
| BullMQ queue for ingestion (16-5) | In-process background pipeline with a concurrency gate | BullMQ was deliberately removed (Redis cost reduction). Ingestion is a low-frequency dashboard action; a restart mid-ingestion is recovered by re-index. |
| Cohere reranking (16-12) | Not built | Needs a new paid vendor. Hybrid RRF covers the bulk of the win; `ragRerankEnabled` field kept for later. |
| Contextual chunking via LLM (16-6) | Not built | Cost/complexity not justified before eval data exists; strategy enum leaves room. |
| Supabase Storage for originals (16-3) | Extracted text stored in `AgentDocument.rawText` (2 MB cap), original bytes discarded | Matches the existing static-KB pattern; re-index never needs the file; zero storage cost; URL docs re-fetch. |
| Generic HTTP-webhook tool + declarative Tool registry (17-3 / integrations plan §5) | Two concrete providers behind a typed registry | Explicit product decision: build the integrations we have. The safe-outbound-executor/SSRF machinery for arbitrary customer URLs is only needed when a generic tool ships. |
| `event_logs` table | `audit_logs` via new `RagLoggerService` + `IntegrationLoggerService`, `ChatTrace` steps (`rag.retrieve`, `tool.call`, `rag.citations`), `LlmUsage` (`embedding`, `rag-query`) | There is no `event_logs` table in this codebase; these are the actual observability primitives. All fire-and-forget. |

## Senior Developer Review (AI)

- **Review date:** 2026-07-04 · **Outcome:** issues found and fixed · **Method:** 6 parallel adversarial review angles over `git diff develop...HEAD` (line-scan/removed-behavior/cross-file correctness + reuse/simplification/efficiency/altitude/conventions)

### Findings fixed (all `[x]`)

- [x] **HIGH** DEMO/preview sessions received live integration tools — playground tests would post to the customer's real Slack and write junk CRM contacts. Fixed: `sessionSource` threaded into DirectChatRequest; tool assembly skipped for `'DEMO'` (mirrors the handover exclusion) + regression test.
- [x] **HIGH** `Math.max(req.maxSteps, …)` silently raised the handover callers' explicit tool-loop cap of 3 to 5. Fixed: explicit caller `maxSteps` is authoritative; integration default (5) applies only when the caller passes none + test.
- [x] **HIGH** RAG citation instruction leaked `[1]`-style markers into WhatsApp text and voice TTS ("bracket one"). Fixed: `buildRagSystemBlock` takes `inlineCitations` — only `chat-stream` (widget/demo) asks for markers; other channels get grounding-only instructions + tests.
- [x] **HIGH** fullStream switch misclassified our 60s stream timeout as a client abort (`AbortError`) — timeouts vanished from failure analytics. Fixed: the 'abort' part now checks which signal fired; timeout throws a real error + tests for both abort classes and iterator-thrown errors.
- [x] **MED** Two new Postgres queries per chat turn (serial `hasReadyDocuments` + integrations findMany, even for agents with neither). Fixed: both flags/rows now ride the existing AgentCacheService Redis entry (one read the turn already paid); documents/ingestion/integrations write paths invalidate; AgentToolsService now builds from rows with zero queries.
- [x] **MED** Citation regex matched `[1]` inside code blocks/inline code → phantom source chips. Fixed: code spans stripped before marker extraction + tests.
- [x] **MED** Ingestion held a whole-document embed in memory inside an interactive transaction (Prisma 5s default would kill ~2000-chunk documents AFTER paying the embedding bill). Fixed: per-batch embed→insert loop, no wrapping transaction (atomicity via the status state machine — retrieval only sees READY), narrow `select` (rawText no longer dragged around), event-loop yield before chunking.
- [x] **MED** HNSW post-filtering could starve/empty results for tenants outside the global top-40 neighbours. Fixed: retrieval runs inside a transaction with `SET LOCAL hnsw.ef_search = 100` AND `SET LOCAL hnsw.iterative_scan = 'relaxed_order'` (Supabase confirmed on pgvector 0.8.0 via MCP, 2026-07-04 — iterative scan keeps scanning until enough rows survive the tenant filter).
- [x] **LOW** Hand-rolled AbortController timeout plumbing ×3 vs the codebase-standard `AbortSignal.timeout` (13 existing call sites) — converged.
- [x] **LOW** documents.service double-fetched the agent row per write (+ odd deferred `await`); assertAgentAccessible now returns `aiConfig`, strategy passed down, helper deleted.
- [x] **LOW** chunking `flush` merge-or-push logic duplicated between mid-loop and final flush — unified behind one `flush(seedOverlap)`.
- [x] **LOW** `CAPTURE_ELIGIBLE_FEATURES` renamed to `USER_FACING_TURN_FEATURES` (it now gates capture + RAG + tools; the old name hid the coupling).
- [x] **LOW** Missing specs (CLAUDE.md rule): documents.controller, integrations.controller, document-ingestion.service, embedding.service — 26 tests added.
- [x] **LOW** apps/web reuse: local `formatDate` replaced with the shared `lib/utils` helper (invalid-date guard); demo page's local `Citation` replaced with `ChatCitation` from @repo/validation.

### Deferred (recorded, deliberate)

- `send()`/`stream()` share ~80 structurally-identical lines (prompt assembly, tool merge) — extract a `prepareTurn()` helper next time either changes; both paths are test-covered today.
- Widget 30s TypingIndicator watchdog unmounts when steps render; the 60s stream-handler inactivity timeout still recovers hangs (steps also reset it), so worst case is a 60s (not 30s) stall before the error path — acceptable; lift the watchdog to the store if it ever matters.
- `chunkingStrategy`/`provider`/`status` are free strings in Postgres (app-layer enum enforcement only); converting to Prisma enums adds migration friction for new strategies — revisit if a second writer bypasses `resolveAiConfig`.
- Tenancy via `assertAgentAccessible` is convention (matches AgentsService.findById), not structure; a param-scoped guard would make it impossible to forget — candidate for a hardening pass.
- The `step` event type is declared in API interfaces, widget, and demo page (widget deliberately has no @repo/validation dependency); a shared wire-contract type in validation would collapse the API+web copies.

## Operational notes

- **Migration** must run against Supabase (`CREATE EXTENSION vector` is idempotent). pgvector ≥ 0.7 required (HNSW).
- New env: `EMBEDDING_MODEL` (optional). `OPENAI_API_KEY` must be set for the default embedding model.
- pgvector maintenance (weekly `REINDEX CONCURRENTLY`, `VACUUM ANALYZE`) per the orchestration plan 18-10 still applies once volume grows.
- Deferred: reranking, contextual chunking, RAGAS evaluation (16-18), per-tenant HNSW partitioning (>1M vectors/tenant), OAuth-based providers.
