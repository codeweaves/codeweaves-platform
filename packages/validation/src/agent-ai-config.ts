/**
 * Agent AI configuration schemas
 * Per-agent settings for the AI orchestration layer: routing mode (n8n vs
 * native direct LLM calls), model selection, sampling parameters, context
 * strategy, RAG behaviour.
 *
 * Stored as a JSONB column on the `agents` table (`Agent.aiConfig`). Null/absent
 * = defaults to `routingMode: 'n8n'` so existing agents are unaffected.
 */
import { z } from 'zod';

// ============================================
// Routing Mode
// ============================================

/**
 * 'n8n'    — legacy: chat messages proxied to the agent's n8n webhook URL
 *            (existing behaviour, default for all agents pre-Phase 1).
 * 'direct' — native: NestJS calls OpenRouter directly with the configured
 *            model. Unlocks streaming, RAG, tool use, per-message tracing.
 */
export const aiRoutingModeEnum = z.enum(['n8n', 'direct']);
export type AiRoutingMode = z.infer<typeof aiRoutingModeEnum>;

// ============================================
// Context Strategy
// ============================================

/**
 * Strategy for building the LLM input context from past conversation messages:
 *
 *   'sliding-window' — take the last N messages up to a token budget. Cheapest
 *                       and most predictable. Good default for short chats.
 *   'summarize'      — when conversation exceeds threshold, summarise older
 *                       messages into a dense block via a cheap model.
 *                       Preserves continuity for long chats.
 *   'hybrid'         — 70% recent messages + 30% summary of earlier context.
 *                       Best overall quality; marginally more expensive.
 */
export const aiContextStrategyEnum = z.enum([
  'sliding-window',
  'summarize',
  'hybrid',
]);
export type AiContextStrategy = z.infer<typeof aiContextStrategyEnum>;

// ============================================
// AgentAiConfig
// ============================================

/**
 * Accepted model ID formats:
 *
 *   'anthropic/claude-sonnet-4'                — OpenRouter (default)
 *   'meta-llama/llama-3.3-70b-instruct:free'   — OpenRouter free-tier model
 *   'openrouter:anthropic/claude-sonnet-4'     — OpenRouter (explicit prefix)
 *   'openai:gpt-4o-mini'                       — OpenAI direct
 *   'gemini:gemini-2.5-flash'                  — Google AI Studio direct
 *   'groq:llama-3.3-70b-versatile'             — Groq direct
 *
 * We enforce a minimal shape (non-empty, contains `:` or `/` separator) rather
 * than a hard allow-list — providers add new models weekly and we don't want
 * to block agents from using them without a deploy.
 */
const openRouterModelId = z
  .string()
  .min(3, 'Model ID is required')
  .max(128, 'Model ID is too long')
  .regex(
    /^[a-z0-9._-]+[:/][a-z0-9.:/_-]+$/i,
    'Model ID must include a provider prefix, e.g. "openai/gpt-4o-mini" (OpenRouter) or "groq:llama-3.3-70b-versatile" (Groq direct)',
  );

export const agentAiConfigSchema = z
  .object({
    // ----- Routing -----
    routingMode: aiRoutingModeEnum.default('n8n'),

    // ----- Model selection -----
    /** Override per agent; falls back to `DEFAULT_AI_MODEL` env var if absent. */
    modelId: openRouterModelId.optional(),
    /**
     * Models to try in order if the primary model fails. OpenRouter's API
     * caps the combined `models` array (primary + fallbacks) at 3 items, so
     * we allow at most 2 fallbacks here. Trimmed silently at request time
     * if over — see LlmService.
     */
    fallbackModels: z.array(openRouterModelId).max(2).optional(),

    // ----- Sampling parameters -----
    /** Randomness. 0 = deterministic, 1 = balanced, 2 = creative. */
    temperature: z.number().min(0).max(2).default(0.7),
    /** Max tokens the model can emit per response. */
    maxTokens: z.number().int().min(1).max(32_000).default(4096),
    /** Nucleus sampling cutoff. Skip unless tuning for specific outputs. */
    topP: z.number().min(0).max(1).optional(),
    /** Discourage token repetition (-2 to 2). */
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    /** Encourage topic diversity (-2 to 2). */
    presencePenalty: z.number().min(-2).max(2).optional(),

    // ----- Prompt -----
    /**
     * Override for the system prompt. If absent, `Agent.systemPrompt` is used.
     * Supports template variables: {{agent.name}}, {{date}}, {{time}}, etc.
     */
    systemPromptTemplate: z.string().max(50_000).optional(),

    // ----- Context management -----
    /** Max number of past messages to include in the LLM context window. */
    maxContextMessages: z.number().int().min(1).max(100).default(20),
    /**
     * Total INPUT token budget (system prompt + knowledge base + conversation
     * history + new user message). Context assembly drops oldest messages to
     * fit within this budget. Set higher (e.g. 200000) for agents that stuff
     * large reference documents into the system prompt. Set up to 1,000,000
     * for Gemini 2.5 Flash (1M context window). Leave at 8000 for most bots —
     * fits comfortably in every model and keeps per-message cost low.
     */
    maxInputTokens: z.number().int().min(500).max(1_000_000).default(8000),
    /** Which context-building strategy to use. */
    contextStrategy: aiContextStrategyEnum.default('sliding-window'),

    // ----- RAG (Phase 3, fields included now to avoid later migrations) -----
    /** Automatically retrieve from the agent's knowledge base before answering. */
    ragEnabled: z.boolean().default(true),
    /** Number of chunks to retrieve from the knowledge base. */
    ragTopK: z.number().int().min(1).max(20).default(5),
    /** Minimum cosine similarity (0-1) for a chunk to be considered relevant. */
    ragSimilarityThreshold: z.number().min(0).max(1).default(0.7),
    /** Apply cross-encoder reranking after vector+BM25 retrieval. */
    ragRerankEnabled: z.boolean().default(true),
    /** Use Anthropic contextual-retrieval chunking at ingestion time. */
    ragContextualChunking: z.boolean().default(false),

    // ----- Caching (Phase 5) -----
    /** Enable semantic response caching for this agent. */
    cachingEnabled: z.boolean().default(true),
  })
  .strict();

export type AgentAiConfigDto = z.infer<typeof agentAiConfigSchema>;

/**
 * Partial variant for PATCH updates. All fields optional, validation on
 * supplied fields still enforced.
 */
export const agentAiConfigUpdateSchema = agentAiConfigSchema.partial();
export type AgentAiConfigUpdateDto = z.infer<typeof agentAiConfigUpdateSchema>;

/**
 * Resolve the effective routing mode for an agent, given possibly-null config.
 * Centralises the 'unset means n8n' rule so every caller agrees.
 */
export function resolveRoutingMode(
  aiConfig: unknown,
): AiRoutingMode {
  if (
    aiConfig &&
    typeof aiConfig === 'object' &&
    'routingMode' in aiConfig &&
    (aiConfig as { routingMode: unknown }).routingMode === 'direct'
  ) {
    return 'direct';
  }
  return 'n8n';
}
