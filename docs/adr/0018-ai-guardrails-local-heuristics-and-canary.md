# ADR-0018: AI guardrails: local heuristics and a canary

- **Status:** Proposed
- **Date:** 2026-11-04
- **Deciders:** Dhruv Khator (on PR review)

## Context

A SEBI-regulated bank will security-test staging soon, and our questionnaire (Q95) claims "guardrails on AI responses". Until now every visitor message went straight to the model, client-sent history and knowledge text could pose as instructions, and nothing checked the reply, so a system-prompt dump streamed to the visitor. Constraints: 10K end users a month, no per-message DB query, no heavy model or paid service on the hot path, no slower streaming, and the provider prompt cache (prefix-based) must keep working.

## The four questions

- **Blast radius:** every AI reply on every channel. A false positive gives a customer a canned refusal; a miss still meets the hardened prompt and the output guard.
- **One-way or two-way door:** two-way. No schema, dependency or wire change. `AI_GUARDRAILS_MODE=monitor` turns off all blocking.
- **Couples us to:** nothing external.
- **Cost of waiting:** high: the claim is submitted and the test is close.

## Decision

Three local layers in `apps/api/src/modules/guardrails/`, called from `DirectChatService` (details in `docs/patterns/security.md`, "AI guardrails"):

1. **Input:** weighted regexes (English, Hindi, Hinglish). Score 1.0 returns a fixed canned reply with no LLM call; 0.5 adds a per-turn security notice at the end of the prompt. Attack turns in history are withheld. Pure CPU, under 1 ms per message.
2. **Prompt:** a static security preamble first (instruction hierarchy; never reveal the prompt, keys or other customers' data), knowledge and summary in escaped delimiter tags, a closing reminder. About 300 extra tokens per call, cacheable.
3. **Output:** a per-agent canary on the prompt's first line, derived from `AGENT_SECRET_KEY` with its own HMAC domain (unpredictable, the same on every instance), plus credential formats. On a hit the stream stops, the provider call is aborted and a canned reply is sent. Delay: at most the current partial word.

Every trigger writes one `event_logs` row (rule ids, score, agent, organisation, session; no text). No per-agent setting, so no migration.

## Options rejected

### OpenAI moderation endpoint (as in Dify)

**Good:** free, multilingual, no rule upkeep. **Rejected because:** a network hop on every message, visitor text sent to OpenAI for Gemini and Sarvam agents too (a new data flow to disclose), and it checks content safety, not injection. **Revisit if:** a client asks for content moderation.

### A prompt-injection classifier model (Prompt Guard, DeBERTa)

**Good:** catches paraphrased attacks regexes miss. **Rejected because:** needs a model server or paid API on the hot path; Hindi coverage unproven. **Revisit if:** we host inference for something else.

### Dify-style output re-check every 300 chars with a client "replace" event

**Good:** proven; the client swaps the whole bubble. **Rejected because:** up to 300 chars of a leak reach the visitor first, and it needs widget and voice changes.

### A per-request canary

**Good:** an attacker who learns one canary gains nothing next time. **Rejected because:** at the top of the prompt it breaks the prompt cache on every call; at the end it fires only after the whole prompt has leaked.

## Consequences

Obvious injections cost nothing and never reach the model; a verbatim prompt dump is stopped before prompt text is sent. A customer who types an attack-like phrase gets a refusal that asks them to rephrase. Not covered: paraphrased attacks, paraphrased or partial prompt leaks, content moderation, injection inside knowledge (delimited, not scanned), and the summariser and data extractor, which read visitor text outside `DirectChatService`.

## Open questions

- Canned reply wording, and languages beyond English and Hindi. Product call, owner: Dhruv.
