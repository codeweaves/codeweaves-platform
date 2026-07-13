# Context/Memory Management + RAG Latency Plan

> Status: **PROPOSED — awaiting review** (no implementation yet)
> Branch: `feature/rag-agentic-integrations`
> Date: 2026-07-12
> Companion plan: `docs/plans/pii-redaction-plan.md` (PII redaction sits in the same request path; latency interplay is called out in both docs)

## Decisions locked in the interview

| Question | Decision |
|---|---|
| Memory scope | **Within-conversation only.** Shape the data model so a cross-conversation "visitor memory" layer can be added later without rework, but do not build it. |
| Priority order | **Quality > speed > cost** — manage all three; no quality regressions to buy latency. |
| Latency target | No hard number given; set from data (see §2) and design-doc alert thresholds (retrieval p99 > 200 ms warn; LLM p99 > 3 s warn). |

---

## 1. What the code actually does today (claim verification)

The goal brief said: *"we send the last N raw messages straight into every LLM request."* That is **partially true, and the nuance matters**:

- **Default path (`sliding-window`)**: `ContextAssemblyService.assemble()` ([context-assembly.service.ts:78](../../apps/api/src/modules/ai/context-assembly.service.ts)) loads the newest `maxContextMessages` (default **20**, hard cap 100) and fits them into a **token budget** (`maxInputTokens`, default **8000**) using cheap char/4 estimates, always keeping ≥ 2 recent messages. So it's "last N raw messages *within a token budget*" — not unbounded, but no compression either.
- **A summarization strategy already exists** — `HybridContextStrategy` ([hybrid-context.strategy.ts:55](../../apps/api/src/modules/ai/strategies/hybrid-context.strategy.ts)) + `SummarizationService` — selectable per agent via `aiConfig.contextStrategy` ('summarize' | 'hybrid'). Default is `sliding-window` ([packages/validation/src/agent-ai-config.ts:122](../../packages/validation/src/agent-ai-config.ts)).
- **But the hybrid strategy is broken in three ways** (found by reading, confirmed statically):

### Bug A — the summary is generated, paid for, and silently discarded
`HybridContextStrategy.injectSummary()` appends the summary to `context.systemPrompt` (hybrid-context.strategy.ts:170-189). But `DirectChatService` **never reads `context.systemPrompt`** — both `send()` and `stream()` build their own system prompt from `systemPromptResolved` + knowledge + RAG block ([direct-chat.service.ts:344-356](../../apps/api/src/modules/ai/direct-chat.service.ts) and :602-613) and pass that to `LlmService`. Net effect for any agent configured with 'hybrid'/'summarize': **one extra blocking LLM call per cache-miss turn, whose output is thrown away.** Cost with zero benefit.

### Bug B — the summary is never persisted
`ChatSession.summary` (schema.prisma:598) has a comment claiming "DB persistence survives restarts". It is never written: `SummarizationService` explicitly says persisting is "the caller's job" (summarization.service.ts:69) and the caller (`HybridContextStrategy`) only writes an **in-process `Map`** capped at 500 entries (hybrid-context.strategy.ts:57, 141-151). Every deploy/restart/pod re-summarizes from scratch, and multi-instance deployments each keep their own divergent cache.

### Bug C — summarization blocks the hot path
On cache miss the summarize LLM call runs **inside** context assembly, before the user-facing LLM call starts. That's a full extra LLM round-trip (measured p50 ~1.4 s for our internal calls, §2) added to the turn — exactly when the conversation is long and the user is already waiting.

**Conclusion:** the strategy design intent (sliding window / summarize / hybrid, 70/30 budget split — see `ai-orchestration-implementation-plan.md` Epic 15) is right; the wiring is wrong. We fix the wiring rather than invent a new architecture.

---

## 2. Where the time actually goes — measured, not guessed

Production data (Supabase, last 60 days, n≈500 turns with metrics + 1,823 traces):

| Step | p50 | p95 | Source |
|---|---|---|---|
| **Full turn** (`responseLatencyMs`) | **2,481 ms** | **5,107 ms** | `chat_message_metrics` |
| Time to first token (felt latency) | 1,854 ms | 3,642 ms | `chat_message_metrics` |
| LLM generation (`llm.complete`) | 1,445 ms | 3,785 ms | `chat_traces.steps` |
| `knowledge.load` (agent extras cache) | **199 ms** | **1,328 ms** | `chat_traces.steps` |
| `context.load` (history assembly) | 0 ms | 167 ms | `chat_traces.steps` |
| Provider prompt-cache hit rate | 61% of turns | — | `chat_message_metrics` |
| Avg input tokens per turn | 3,305 (p95 6,089) | — | `chat_message_metrics` |

Conversation shape (all 7,608 sessions): **p50 = 8 messages, p95 = 15, only 18 sessions (0.24%) ever exceeded the 20-message window.** History truncation almost never fires today — so context-strategy work is about *correctness and readiness*, not an active fire.

**RAG has never run in production** — zero `llm_usage` rows with `feature='rag-query'` (it exists only on this branch). So RAG latency numbers must come from instrumentation we ship with it (§4), plus the design-doc budgets: query embedding < 200 ms, hybrid SQL < 80 ms, retrieval p99 alert at 200 ms. Note: the goal brief assumed a rerank step exists; **it does not** — retrieval is exactly (1) one OpenAI embedding call ([embedding.service.ts:74-92](../../apps/api/src/modules/rag/embedding.service.ts)) and (2) one Postgres statement (vector or hybrid RRF, single round-trip, [rag-retrieval.service.ts:96-102](../../apps/api/src/modules/rag/rag-retrieval.service.ts)), already run **in parallel** with context load (direct-chat.service.ts:314, :545).

### Reading of the numbers

1. **The LLM call dominates** (~85% of p50 turn time). The biggest levers there are model choice, prompt-cache hit rate, and input size — not our orchestration code.
2. **`knowledge.load` is the top fixable overhead**: documented as "Redis ~1-3 ms" (direct-chat.service.ts:506-510) but really **199 ms p50 / 1.3 s p95**, and it runs **serially before** the context+RAG parallel phase. Root causes: Upstash Redis over TLS is a network round-trip (tens of ms at best, worse cross-region), plus Postgres fallthrough on misses (the 1.3 s tail). ~200 ms of every single turn.
3. **`context.load` is already cheap** (p50 = 0 because the widget supplies `recentHistory` and the DB read is skipped; p95 167 ms on DB-read paths like WhatsApp).
4. **Prompt-cache misses (39%) are expensive** — a miss re-processes ~3.3K input tokens. Anything we inject into the system prompt must respect the stable-prefix rule the RAG block already follows (direct-chat.service.ts:350-355).

---

## 3. Recommended context/memory strategy

**Running summary + recent-turns window ("hybrid"), rebuilt asynchronously off the hot path, persisted on `ChatSession.summary`.** This becomes the default for all agents once fixed — safe because it costs nothing until a conversation actually outgrows the window (0.24% of sessions today).

### How it works per turn

1. **Hot path (unchanged cost):** assemble sliding window exactly as today. If `ChatSession.summary` is non-null, append it to the system prompt as a `[SUMMARY OF EARLIER CONVERSATION]` block — **placed after the static persona/knowledge sections, next to the RAG block**, so the provider prompt-cache prefix (persona + knowledge) stays byte-stable. Reading the summary is a column already fetched with the session — zero extra queries.
2. **Off hot path (after the reply is delivered):** if the turn's assembly reported `truncated || olderMessagesExist`, fire-and-forget a summary refresh: summarize the messages that fell outside the window (current `SummarizationService`, unchanged prompt), then `UPDATE chat_sessions SET summary = ...`. Debounced the same way data extraction already is (one refresh per settling conversation, not per message). The *next* turn picks up the fresh summary.
3. **Staleness tradeoff (explicit):** the summary can lag the conversation by one turn right at the moment messages first drop out of the window. The dropped message is the 21st-oldest — its content was already ~20 turns ago; a one-turn lag on compressing it is imperceptible. In exchange, the user-facing turn **never** waits on a summarize call (deletes Bug C), and the per-pod cache (Bug B) is deleted outright — Postgres is the cache, consistent across pods and restarts.

### Why not the alternatives

- **Pure sliding window (status quo):** free and fine for 99.8% of today's sessions, but the model amnesia on long conversations is exactly what the goal asks to fix, and lead-capture context (name given in turn 2, asked for in turn 30) is a real product failure mode. Rejected as the *only* mode, retained as the fallback when summarization fails (existing behavior, hybrid-context.strategy.ts:154-161).
- **Synchronous summarization (current 'hybrid' intent):** adds a blocking LLM call at the worst time. Rejected — async gives the same quality one turn later at zero felt latency.
- **Vector memory / cross-conversation store:** design docs already deferred it ("summarization covers most memory needs"); interview confirmed within-conversation only. The async summary design is the future seam: a later "visitor memory" feature can read `ChatSession.summary` rows for a returning visitor without touching the hot path. **Not built now.**
- **Aggressive window shrink to cut input tokens** (e.g. keep 6 turns + summary always): saves ~30-40% input cost but hurts fidelity on recent turns and breaks the prompt-cache prefix more often (summary churns every turn). Quality > cost per interview. Rejected for now; revisit if input-token spend becomes material.

### Cost impact (explicit)

- Summary refresh: one cheap-model call (~60-message cap, ~300 output tokens) *only* for conversations that exceed the window, debounced. At today's traffic: ~18 sessions total would ever have triggered it. Negligible.
- Turn input tokens: +~300 tokens (summary block) only on long conversations — *replacing* the raw messages it summarizes, which is strictly cheaper than raising `maxContextMessages`.

---

## 4. Latency findings and fixes

Ordered by measured impact; each states the tradeoff.

### Fix 1 — `knowledge.load`: add an in-process L1 cache in front of Upstash (~200 ms p50 off every turn)
`AgentCacheService.getAgentWithKnowledge()` ([agent-cache.service.ts:89](../../apps/api/src/common/cache/agent-cache.service.ts)) pays an Upstash network round-trip per turn for data that changes only on editor saves. Add a small in-memory LRU (e.g. 500 agents, **30–60 s TTL**) in front of the existing Redis layer; Redis stays as the cross-pod layer and the existing `invalidate()` also clears L1 locally. Tradeoff: another pod may serve a ≤60 s-stale agent config after an editor save — acceptable for chat (config edits are not safety-critical mid-conversation); if not, publish invalidations over the existing Socket.io Redis adapter later. **Expected: −200 ms p50, −1.3 s p95 on the serial prefix of every turn.**

### Fix 2 — stop serializing `knowledge.load` before context/RAG (~overlap the remaining cost)
`loadContext()` does not depend on agent extras at all (config comes from `req.agent`, already in hand). Restructure Phase 0/1 in `DirectChatService.stream()`/`send()` so `loadAgentExtras`, `loadContext`, and (once extras resolve, gate-check) `retrieveRag` run concurrently instead of extras-then-parallel. With Fix 1 this matters less (L1 hit ≈ 0 ms), but it removes the p95 tail from the serial path entirely. Tradeoff: the "Searching the knowledge base…" widget step may show ~a frame later; no cost.

### Fix 3 — RAG: instrument the split before optimizing (measure, don't guess)
Per-component numbers don't exist yet (never deployed). Ship with retrieval instrumented through the **existing** stack — no new metrics system:
- Inside `RagRetrievalService.retrieve()`: record `embedMs` and `sqlMs` separately into the existing `rag.retrieve` trace-step `data` (chat_traces.steps) — embedding latency is *also* already visible in `llm_usage` (`feature='rag-query'`) but not joined per-turn.
- Add `ragLatencyMs` + `ragChunks` columns to `ChatMessageMetrics` (typed, aggregatable — this table is exactly for that) written where the other per-turn metrics already are.
- Expected split, from design docs + provider realities: embedding call 50–200 ms (network-bound, ap-south-1 → OpenAI), hybrid SQL < 80 ms at current corpus sizes with the `iterative_scan` fix already merged. **The embedding call will dominate retrieval.**

Then, *only if the measurements say so*:
- **Embedding tail fix candidates** (in order): timeout + single retry on the embed call (protect the turn from provider tail latency; on failure degrade to text-only search arm — the hybrid SQL's keyword arm still works with no vector), and a short-TTL query-embedding cache keyed on normalized query text (design doc 18-4 expects 30–50% repeat-hit on FAQs). Both scoped by measurement, per the goal's discipline rule.
- **Do NOT add**: a reranker (goal assumed one exists; it doesn't; design docs gate it on corpus size/quality data), a new vector store, or semantic response caching — all premature until real retrieval quality/latency data exists.

### Fix 4 — protect the prompt-cache prefix (39% of turns miss today)
61% cache hit is decent but every injected block placed wrong resets it. Rules to enforce (mostly already followed): per-turn content (RAG block, summary block, extra instruction) goes **after** the stable persona/knowledge prefix; never interleave volatile text above stable text. The summary block (§3) churns at most once per refresh, not per turn. Measurable via the existing `cachedInputTokens` field. Expected: hit rate ↑ modestly; a hit is documented by providers as up to ~80% faster prompt processing on the cached prefix.

### Fix 5 — fix Bug A/B/C regardless of default (correctness)
Even if we kept `sliding-window` as default, the 'hybrid'/'summarize' options are today a pure money leak (Bug A). The strategy should return the summary as a **separate field** on `AssembledContext` (e.g. `summaryBlock`), and the orchestrator appends it cache-aware — never via hidden mutation of `systemPrompt` that callers ignore.

### Explicitly out of scope (per goal discipline)
New caching layers beyond L1-in-front-of-existing-Redis, new datastores, cross-conversation memory, streaming-STT/voice latency (separate epic), model/provider switching (product decision, though the data says it's the biggest lever — flag to the user, decide separately).

---

## 5. Phased build order

**Phase 0 — Instrument (ship with the RAG branch, before optimizing)**
`embedMs`/`sqlMs` in the `rag.retrieve` trace step; `ragLatencyMs`, `ragChunks` columns on `ChatMessageMetrics` (+ migration); verify `ttftMs` lands for all streaming turns. Exit: a SQL query can answer "where does retrieval time go" from prod data.

**Phase 1 — Quick latency wins**
L1 agent cache (Fix 1) + de-serialize Phase 0/1 (Fix 2). Exit: `knowledge.load` p50 < 5 ms on warm pods; turn p50 measurably down ~200 ms.

**Phase 2 — Context/memory correctness (the strategy)**
`summaryBlock` on `AssembledContext` (kills Bug A); async debounced summary refresh persisting to `ChatSession.summary` (kills Bug B/C; reuse the `extractionDueAt` debounce pattern); delete the in-memory summary cache; summary block placed cache-aware; flip default `contextStrategy` to `hybrid` after a soak on one agent. Unit tests for assembly with/without summary, refresh triggering, fallback on summarize failure. Exit: a 40-message conversation retains early facts with zero added hot-path latency.

**Phase 3 — RAG tuning from Phase 0 data (post-deploy)**
Read the numbers; apply only what they justify (embed timeout/retry/degrade first; query-embedding cache second). Exit: retrieval p95 within the 200 ms design budget, verified in `chat_traces`.

Each phase is independently shippable and PR-sized. Multi-tenancy: the only new persisted state is `ChatSession.summary` (existing column, session-scoped → org-scoped via agent) and two metrics columns — no new tables.

---

## 6. Tradeoff summary (the choices you're making)

| Decision | You gain | You pay |
|---|---|---|
| Async summary vs sync | Zero hot-path latency for memory | Summary lags one turn right when truncation starts |
| Hybrid default for all agents | Long-conversation memory everywhere | ~1 cheap LLM call per long conversation (rare today) |
| L1 agent cache (30–60 s TTL) | −200 ms p50 every turn | ≤60 s stale config cross-pod after editor saves |
| Measure-then-fix RAG | No premature infra | RAG latency fixes land one phase after RAG ships |
| No reranker now | −120–200 ms it would have cost | Possibly lower retrieval precision on large corpora — revisit with quality data |
