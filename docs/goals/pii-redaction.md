# Goal: PII Redaction (from LLMs and from our logs)

> For Claude Fable 5. Paste the block below as the opening message in a fresh session. Set effort to `high`.
>
> This goal is written to produce a **plan**, not a build. Fable 5 should interview me first, then write the plan, then stop.

---

I want codeweaves-platform (our multi-tenant AI chatbot SaaS — apps/api: NestJS/Prisma/Postgres, apps/web, apps/widget) to be able to keep personally identifiable information (PII) out of the LLM's context and out of our stored logs, controlled by a toggle. This is both a security/compliance requirement and a genuine architecture question, and I don't have the strategy figured out — that's what I want from you.

**Why this matters, and why now:** we're moving into agentic tool-calling, where the AI can fetch real data mid-conversation (e.g. a customer record from a CRM). That record can contain PII the model never actually needed to see to do its job — but under the naive approach it lands in the model's context anyway, and then potentially in our logs. Separately, our current chat flow sends the last N conversation messages raw into every LLM request, so if a user types their own PII into the chat, it goes to the model too. As we take on more organizations across regulated contexts (GDPR, India's DPDP Act), "we send whatever we have to whatever LLM" is not a defensible position.

**The outcome I want:**
- A strategy to detect and redact/mask PII **before it reaches any LLM** — covering both tool-fetched data and user-typed message history.
- The same protection applied to what we persist in our logs, so PII isn't sitting in `event_logs`/traces either.
- A toggle to turn this on/off (you tell me the right granularity — per-organization, per-agent, per-category — as part of the plan).
- Your recommendation on detection approach. I know Microsoft Presidio is the common open-source choice (pattern + NER, self-hostable, no extra LLM round-trip) — evaluate whether that's right for us or whether something lighter/heavier fits better. Don't just default to it; justify the pick.

**Hard questions I need the plan to answer (these are the architecture-changing ones — raise them in the interview):**
- Redaction has to be reversible for some flows and not others. When a conversation is handed to a **human agent** (we have human handover), that person may legitimately need to see the real PII. So is this masking (irreversible) or tokenization (reversible via a vault)? That single choice changes the whole design.
- We serve **Indian-language and multilingual** conversations (we use Sarvam/Deepgram for voice). Does the detector work on PII in non-English text, or does redaction silently fail there — which would be worse than no redaction because it's a false sense of safety?
- What's the **latency cost** of the redaction step, and where does it sit relative to the separate latency work I'm doing on the RAG/context pipeline? It can't quietly undo that.
- What counts as PII **for us specifically** — and is there PII we legitimately must send (e.g. a name the bot needs to greet someone by)? Over-redaction breaks the product; under-redaction breaks compliance.

**Read first:** the LLM request path in apps/api (`direct-chat.service.ts`, `llm.service.ts`, whatever assembles message history), the tool-calling/tool-result path (where fetched third-party data enters context), the human-handover code (for the reversibility question), and the observability stack (`event_logs`, `TracerService`, domain loggers) for the logging side.

**Multi-tenancy:** any config, toggle state, or token vault you introduce must be scoped by `organizationId`.

**Process:**
1. First, interview me — one question at a time, architecture-changing ones first (the reversibility/handover question and the multilingual question above are the two I most need to think through; lead with those). Don't ask what you can learn from the code.
2. Then read the code paths listed above.
3. Then write an implementation plan to `docs/plans/pii-redaction-plan.md`: detection approach + justification, masking-vs-tokenization decision, toggle granularity, where in the request/log path the redaction hooks in, the multilingual and latency implications, and a phased build order.
4. Stop there. Do not write implementation code yet — I want to review the plan first.

Follow CLAUDE.md.
