# Goal: Context/Memory Management + RAG Latency

> For Claude Fable 5. Paste the block below as the opening message in a fresh session on branch `feature/rag-agentic-integrations` (where RAG is already built). Set effort to `high`.
>
> This goal is written to produce a **plan**, not a build. Fable 5 should interview me first, then write the plan, then stop.

---

I want the chat pipeline in codeweaves-platform (our multi-tenant AI chatbot SaaS — apps/api: NestJS/Prisma/Postgres) to be smart about what it keeps in an LLM's context, and as fast as it can reasonably be on retrieval. Two entangled problems, one goal.

**Why this matters:** conversations get long, and today our strategy is naive — we send the last N raw messages straight into every LLM request. So context grows unbounded, cost and latency climb, and if a conversation runs long the model's attention gets diluted. On top of that, RAG (already built on this branch) adds real latency per turn: embedding call, vector search, hybrid/full-text search, rerank. This has to hold up at real B2B scale — thousands of organizations, many concurrent conversations — not just on a dev machine with one chat open. Context strategy and retrieval speed are two sides of the same coin: how much you keep and inject drives both cost and how fast the whole thing feels.

**The outcome I want:**
- A real context/memory strategy for long conversations — summarization, sliding window, hybrid, running summary + recent turns, whatever you judge correct. Not "send N raw messages."
- RAG retrieval that's as fast as it reasonably can be. Find where the time actually goes — measure it, don't guess — and fix the slow parts.
- Clear reasoning on the cost/completeness/latency tradeoffs, with your recommendation for each, so I understand what I'm choosing.

**How you'll know the plan is good:** it's grounded in what the code actually does today (read it first — verify my "N raw messages" claim rather than trusting it), it names concrete latency numbers or a way to get them, and every decision that changes cost or user-perceived speed is called out explicitly rather than buried.

**Read first:** the current chat pipeline in apps/api (`direct-chat.service.ts`, `llm.service.ts`, and whatever assembles conversation history and injects retrieved context), plus `docs/plans/ai-orchestration-implementation-plan.md` and `docs/plans/rag-pipeline-deep-research.md` for the design intent behind what's already built.

**Instrumentation constraint:** measure through our existing observability stack (`event_logs` table, `TracerService`, domain loggers) — do not introduce a new logging/metrics system.

**Scope discipline:** don't build a caching layer, a new datastore, or a cross-conversation "user memory" feature unless you can show from the measurements that it's actually the bottleneck. Solve the problem in front of you, not a hypothetical one.

**Multi-tenancy:** any new table or persisted state must be scoped by `organizationId`, like everything else in this codebase.

**Process:**
1. First, interview me. Ask your questions one at a time, hardest-hitting first — prioritize the ones whose answers would change the architecture (e.g. do we need cross-conversation memory of a returning user, or just within-conversation? what's my acceptable p95 latency? is cost or speed the harder constraint right now?). Don't ask things you can answer by reading the code.
2. Then read the code and the plan docs.
3. Then write an implementation plan to `docs/plans/context-memory-rag-latency-plan.md` covering: the context/memory strategy you recommend and why, the latency findings and fixes, the tradeoffs, and a phased build order.
4. Stop there. Do not write implementation code yet — I want to review the plan first.

Follow CLAUDE.md.
