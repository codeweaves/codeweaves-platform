# ADR-0011: LLM providers are OpenAI, Gemini and Sarvam

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Dhruv Khator

## Context

The API can call six LLM providers through the Vercel AI SDK: OpenAI, Gemini, Sarvam, Groq, Cerebras and OpenRouter (`apps/api/src/modules/ai/ai-sdk.service.ts`). Each provider has its own usage fields, cache rules and price list, and we now compute every call's cost ourselves (ADR-0012).

On 2026-10-10:

- **Groq** shut down `llama-3.3-70b-versatile` (the summary default) and `qwen/qwen3-32b` (in the model picker) for non-enterprise accounts. Its AI SDK provider also drops cached-token counts.
- **Cerebras** deprecated its configured model, and its provider is created without usage reporting.
- **OpenRouter** is the fallback when `DEFAULT_AI_MODEL` is unset, and the only route to Claude. It is also the only provider whose cost we read. We no longer want a gateway between us and the model vendor.

Each extra provider adds formulas, tests and failure modes to cost metering, for models nobody uses.

## The four questions

- **Blast radius:** agents set to a removed provider stop working unless they are migrated. The migration moves them to `openai:gpt-4.1-mini` and audit-logs each change.
- **One-way or two-way door:** two-way. Adding a provider back is one AI SDK package and a picker entry.
- **Couples us to:** OpenAI and Google for text LLMs, and Sarvam for Indian-language LLMs.
- **Cost of waiting:** summaries run on a shut-down model, and the picker offers a dead one. Cost metering would need formulas for providers we are dropping.

## Decision

- **Supported:**
  - `openai:` through `@ai-sdk/openai`
  - `gemini:` through `@ai-sdk/google`
  - `sarvam:` through `@ai-sdk/openai-compatible`, with `includeUsage: true`
- **Removed:** `groq:`, `cerebras:` and OpenRouter, with their packages (`@ai-sdk/groq`, `@openrouter/ai-sdk-provider`), their env vars and `aiConfig.fallbackModels`, which only OpenRouter supported.
- **Model picker:** OpenAI `gpt-4.1` and `gpt-4.1-mini`, Gemini `gemini-2.5-flash`, and the current Sarvam chat model.
- **Defaults:** the summary model and the `DEFAULT_AI_MODEL` fallback are `openai:gpt-4.1-mini`.
- **Migration:** existing agents on a removed provider move to `openai:gpt-4.1-mini`, with an audit row each.
- **Claude** comes later through `@ai-sdk/anthropic`, direct to Anthropic, never through a gateway.

## Options rejected

### Keep all six providers

**Good:** maximum choice, and Groq and Cerebras give the fastest time to first token.

**Rejected because:** two of them serve retired models, and each needs its own cost formula and usage fixes. Nobody uses them.

**Revisit if:** latency becomes the deciding factor for a client. Re-add the provider together with its cost formula.

### Route all models through OpenRouter

**Good:** one integration for every vendor, and an exact charged cost on each call.

**Rejected because:** Dhruv decided against a gateway. It adds a hop, a dependency, and about a 5.5% fee on credit purchases. We compute cost ourselves instead (ADR-0012).

### Add Claude now through `@ai-sdk/anthropic`

**Good:** keeps a strong model in the picker.

**Rejected because:** it is a new provider, with its own cache-write pricing, to build and test now. Nobody needs it yet.

**Revisit if:** a client asks for Claude.

## Consequences

- Fewer providers, so fewer cost formulas and failure modes.
- Agents on Groq or OpenRouter models change model. The PR lists them.
- We lose cross-provider fallback (`fallbackModels`). A provider outage now fails the turn until the agent's model is changed. The `llm-provider-outage` runbook covers switching models.
