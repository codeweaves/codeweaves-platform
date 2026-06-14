import { Injectable, Logger } from '@nestjs/common';
import type { Agent } from '@prisma/client';
import {
  agentAiConfigSchema,
  type AgentAiConfigDto,
} from '@repo/validation';

import { AgentCacheService } from '../../common/cache/agent-cache.service';
import { PrismaService } from '../../services/prisma.service';

import { AiSdkService } from './ai-sdk.service';
import { ContextAssemblyService } from './context-assembly.service';
import type {
  DirectChatRequest,
  DirectChatResult,
  DirectChatStreamChunk,
} from './interfaces/direct-chat.interfaces';
import type { LlmStreamChunk } from './interfaces/llm.interfaces';
import { LlmService } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { HybridContextStrategy } from './strategies/hybrid-context.strategy';
import { AiTraceService } from './trace/ai-trace.service';
import { UsageTrackingService } from './usage-tracking.service';

/** Divider prepended before injected knowledge content in the system prompt. */
const KNOWLEDGE_DIVIDER = '\n\n---\n\n[REFERENCE KNOWLEDGE]\n';

/**
 * DirectChatService: the orchestrator for direct-mode AI calls. This is what
 * replaces the "POST to n8n webhook" call in n8n mode. It composes:
 *
 *   1. ContextAssemblyService  → load message history from DB
 *   2. (Phase 3: RAG retrieval → inject into system prompt)
 *   3. LlmService              → the actual OpenRouter call
 *   4. AiTraceService          → log every step for visibility
 *
 * Two entry points:
 *
 *   send(req)   — non-streaming. Returns full DirectChatResult. Use for
 *                  internal calls (summarisation, title gen, eval) where
 *                  there's no UI streaming.
 *
 *   stream(req) — streaming async generator. Yields trace events as
 *                  orchestration progresses, then text-deltas as LLM tokens
 *                  arrive, then a final 'finish' event. Use for user-facing
 *                  chat. The SSE controller pipes this straight to the wire.
 *
 * Stream ordering (same order client sees over SSE):
 *
 *   → trace  { step: 'context.load',   durationMs: 12,  messagesLoaded: 8 }
 *   → trace  { step: 'llm.call_start', durationMs: 0,   model: '...' }
 *   → text-delta { content: 'Hello' }
 *   → text-delta { content: ' there' }
 *   → ...
 *   → trace  { step: 'llm.complete',   durationMs: 3420, tokens: 180, cost: 0.012 }
 *   → finish { result: DirectChatResult }
 *
 * On error, the generator yields a single `error` chunk then terminates.
 *
 * NOT responsible for:
 *   - Persisting the user/assistant message                  → ChatService
 *   - Updating ChatSession.lastMessageAt                     → ChatService
 *   - Routing between n8n and direct                         → ChatService
 *   - Rate limiting, permissions                             → Controllers + guards
 *   - Recording LlmUsage rows                                → UsageTrackingService (14-10)
 *     (we emit the data via trace + return result; UsageTrackingService
 *      observes)
 */
@Injectable()
export class DirectChatService {
  private readonly logger = new Logger(DirectChatService.name);

  constructor(
    private readonly aiSdk: AiSdkService,
    private readonly llmService: LlmService,
    private readonly contextService: ContextAssemblyService,
    private readonly hybridStrategy: HybridContextStrategy,
    private readonly promptTemplate: PromptTemplateService,
    private readonly traceService: AiTraceService,
    private readonly usageTracker: UsageTrackingService,
    private readonly prisma: PrismaService,
    private readonly agentCache: AgentCacheService,
  ) {}

  /**
   * Load an agent's static knowledge content (if any), from Redis cache when
   * available. Result is appended to the system prompt by the caller.
   *
   * Returns `null` when no knowledge record exists. Cache failures fall
   * through transparently to Postgres (see AgentCacheService for details).
   */
  private async loadKnowledge(
    agentId: string,
  ): Promise<{ content: string; tokens: number | null } | null> {
    const cached = await this.agentCache.getAgentWithKnowledge(agentId);
    const knowledge = cached?.knowledge;
    if (!knowledge || !knowledge.content.trim()) return null;
    return { content: knowledge.content, tokens: knowledge.contentTokens };
  }

  /**
   * Select the right context assembler based on the agent's configured
   * strategy. Extracted as a helper so `send()` and `stream()` share logic.
   *
   *   'sliding-window' (default) → pure last-N-messages, no summarisation
   *   'summarize' | 'hybrid'     → sliding window + summary of dropped msgs
   *                                (uses HybridContextStrategy)
   */
  private async loadContext(
    req: DirectChatRequest,
    strategy: 'sliding-window' | 'summarize' | 'hybrid' | undefined,
    systemPrompt: string,
    modelId: string,
    config: { maxContextMessages?: number; maxInputTokens?: number },
    traceId: string,
  ) {
    const params = {
      chatSessionId: req.chatSessionId,
      systemPrompt,
      newUserMessage: req.newUserMessage,
      maxContextMessages: config.maxContextMessages,
      maxInputTokens: config.maxInputTokens,
      model: modelId,
      recentHistory: req.recentHistory,
    };
    if (strategy === 'hybrid' || strategy === 'summarize') {
      return this.hybridStrategy.assemble({
        ...params,
        organizationId: req.agent.organizationId,
        agentId: req.agent.id,
        traceId,
      });
    }
    return this.contextService.assemble(params);
  }

  /**
   * Non-streaming send. Awaits the full response before returning. Reserved
   * for internal use (summarisation, etc.); user-facing chat should always
   * use `stream()`.
   */
  async send(req: DirectChatRequest): Promise<DirectChatResult> {
    const config = resolveConfig(req.agent);
    const systemPromptRaw = resolveSystemPromptTemplate(req.agent, config);
    const systemPromptResolved = this.promptTemplate.resolve(systemPromptRaw, {
      agent: req.agent,
    });

    const trace = this.traceService.startTrace({
      agentId: req.agent.id,
      sessionId: req.externalSessionId,
      userMessage: req.newUserMessage,
    });

    const modelId = config.modelId ?? this.aiSdk.getDefaultModel();

    try {
      // Knowledge load (Redis→Postgres for AgentKnowledge) and context load
      // (Postgres findMany on ChatMessage) hit different tables and have no
      // data dependency — running them serially wastes one DB round-trip.
      //
      // Context assembly DOES use the system prompt for its token-budget
      // charEstimate, but the estimate is cheap and we account for the
      // knowledge tokens by pre-seeding the budget. See contextWithKnowledge()
      // below for the reconciliation.
      const knowledgeStart = performance.now();
      const contextStart = performance.now();
      const [knowledge, context] = await Promise.all([
        this.loadKnowledge(req.agent.id).then((k) => {
          const knowledgeMs = Math.round(performance.now() - knowledgeStart);
          trace.step(
            'knowledge.load',
            { hasKnowledge: k !== null, knowledgeTokens: k?.tokens ?? 0 },
            knowledgeMs,
          );
          return k;
        }),
        this.loadContext(
          req,
          config.contextStrategy,
          systemPromptResolved,
          modelId,
          config,
          trace.traceId,
        ).then((ctx) => {
          const contextMs = Math.round(performance.now() - contextStart);
          trace.step(
            'context.load',
            {
              strategy: config.contextStrategy ?? 'sliding-window',
              messagesLoaded: ctx.historyCount,
              estimatedInputTokens: ctx.estimatedTokens,
              truncated: ctx.truncated,
              droppedCount: ctx.droppedCount,
              olderMessagesExist: ctx.olderMessagesExist,
            },
            contextMs,
          );
          return ctx;
        }),
      ]);
      const systemPrompt =
        (knowledge
          ? systemPromptResolved + KNOWLEDGE_DIVIDER + knowledge.content
          : systemPromptResolved) + buildFallbackInstruction(req.agent);

      trace.step('llm.call_start', {
        model: modelId,
        streaming: false,
        feature: req.feature ?? 'chat',
      });

      const result = await trace.measure(
        'llm.complete',
        () =>
          this.llmService.generateCompletion({
            modelId,
            systemPrompt,
            messages: context.messages,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            topP: config.topP,
            frequencyPenalty: config.frequencyPenalty,
            presencePenalty: config.presencePenalty,
            fallbackModels: config.fallbackModels,
            abortSignal: req.abortSignal,
            organizationId: req.agent.organizationId,
            agentId: req.agent.id,
            sessionId: req.externalSessionId,
            traceId: trace.traceId,
            feature: req.feature ?? 'chat',
          }),
        (r) => ({
          model: r.model,
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          totalTokens: r.usage.totalTokens,
          cachedInputTokens: r.usage.cachedInputTokens ?? 0,
          reasoningTokens: r.usage.reasoningTokens ?? 0,
          cost: r.cost,
          finishReason: r.finishReason,
        }),
      );

      const finalResult: DirectChatResult = {
        text: result.text,
        traceId: trace.traceId,
        usage: result.usage,
        cost: result.cost,
        model: result.model,
        finishReason: result.finishReason,
        latencyMs: result.latencyMs,
        ttftMs: null, // non-streaming
        historyCount: context.historyCount,
        estimatedInputTokens: context.estimatedTokens,
        historyTruncated: context.truncated,
      };

      this.usageTracker.record({
        organizationId: req.agent.organizationId,
        agentId: req.agent.id,
        sessionId: req.externalSessionId,
        traceId: trace.traceId,
        model: result.model,
        requestedModel: modelId,
        usage: result.usage,
        cost: result.cost,
        feature: req.feature ?? 'chat',
        latencyMs: result.latencyMs,
        retryCount: result.retryCount,
        finishReason: result.finishReason,
      });

      void trace.end({
        success: true,
        response: result.text,
        model: result.model,
      });

      return finalResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      void trace.end({ success: false, error: errorMsg });
      throw err;
    }
  }

  /**
   * Streaming send. Yields an interleaved stream of trace events and text
   * deltas. The consumer (SSE controller) pipes each chunk to an SSE event.
   *
   * Generator contract:
   *   - Exactly one 'finish' OR 'error' chunk is yielded (not both)
   *   - No chunks are yielded after 'finish' or 'error'
   *   - Trace is always ended (trace.end() called) before returning
   *   - Client disconnect (req.abortSignal) bubbles as AbortError; consumer
   *     should catch and treat as normal termination
   */
  async *stream(
    req: DirectChatRequest,
  ): AsyncGenerator<DirectChatStreamChunk, void, undefined> {
    const config = resolveConfig(req.agent);
    const systemPromptRaw = resolveSystemPromptTemplate(req.agent, config);
    const systemPromptResolved = this.promptTemplate.resolve(systemPromptRaw, {
      agent: req.agent,
    });

    const trace = this.traceService.startTrace({
      agentId: req.agent.id,
      sessionId: req.externalSessionId,
      userMessage: req.newUserMessage,
    });

    let finalTextBuffer = '';
    let finalModel: string | null = null;
    let finalUsage: DirectChatResult['usage'] | null = null;
    let finalCost: number | null = null;
    let finalFinishReason: string | null = null;
    let finalTtftMs: number | null = null;
    let finalTotalMs = 0;

    const modelId = config.modelId ?? this.aiSdk.getDefaultModel();

    try {
      // ----- Phase 0+1: Knowledge + Context (run in parallel) -----
      //
      // Independent reads (AgentKnowledge via Redis→Postgres; ChatMessage via
      // Postgres OR skipped entirely if the caller supplied recentHistory).
      // Each records its OWN wall time via a per-promise timestamp so the
      // trace shows which of the two is actually slow.
      const parallelStart = performance.now();
      const knowledgeStart = parallelStart;
      const contextStart = parallelStart;
      let knowledgeMs = 0;
      let contextMs = 0;

      const [knowledge, context] = await Promise.all([
        this.loadKnowledge(req.agent.id).then((k) => {
          knowledgeMs = Math.round(performance.now() - knowledgeStart);
          return k;
        }),
        this.loadContext(
          req,
          config.contextStrategy,
          systemPromptResolved,
          modelId,
          config,
          trace.traceId,
        ).then((ctx) => {
          contextMs = Math.round(performance.now() - contextStart);
          return ctx;
        }),
      ]);

      const knowledgeData = {
        hasKnowledge: knowledge !== null,
        knowledgeTokens: knowledge?.tokens ?? 0,
      };
      trace.step('knowledge.load', knowledgeData, knowledgeMs);
      yield {
        type: 'trace',
        step: 'knowledge.load',
        durationMs: knowledgeMs,
        data: knowledgeData,
      };
      const systemPrompt =
        (knowledge
          ? systemPromptResolved + KNOWLEDGE_DIVIDER + knowledge.content
          : systemPromptResolved) + buildFallbackInstruction(req.agent);

      const contextData = {
        strategy: config.contextStrategy ?? 'sliding-window',
        messagesLoaded: context.historyCount,
        estimatedInputTokens: context.estimatedTokens,
        truncated: context.truncated,
        droppedCount: context.droppedCount,
        olderMessagesExist: context.olderMessagesExist,
        clientSuppliedHistory: Array.isArray(req.recentHistory),
      };
      trace.step('context.load', contextData, contextMs);
      yield {
        type: 'trace',
        step: 'context.load',
        durationMs: contextMs,
        data: contextData,
      };

      // ----- Phase 2: LLM streaming call -----
      trace.step('llm.call_start', {
        model: modelId,
        streaming: true,
        feature: req.feature ?? 'chat-stream',
      });
      yield {
        type: 'trace',
        step: 'llm.call_start',
        durationMs: 0,
        data: { model: modelId, streaming: true },
      };

      const handle = await this.llmService.streamCompletion({
        modelId,
        systemPrompt,
        messages: context.messages,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        fallbackModels: config.fallbackModels,
        abortSignal: req.abortSignal,
        organizationId: req.agent.organizationId,
        agentId: req.agent.id,
        sessionId: req.externalSessionId,
        traceId: trace.traceId,
        feature: req.feature ?? 'chat-stream',
      });

      let finishChunk:
        | Extract<LlmStreamChunk, { type: 'finish' }>
        | null = null;

      for await (const chunk of handle.stream) {
        if (chunk.type === 'text-delta') {
          finalTextBuffer += chunk.content;
          yield { type: 'text-delta', content: chunk.content };
        } else if (chunk.type === 'finish') {
          finishChunk = chunk;
          // Keep looping in case there are follow-up events; in practice
          // the LLM stream ends here but being defensive.
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }

      if (!finishChunk) {
        throw new Error('LLM stream ended without a finish event');
      }

      finalModel = finishChunk.model;
      finalUsage = finishChunk.usage;
      finalCost = finishChunk.cost;
      finalFinishReason = finishChunk.finishReason;
      finalTtftMs = finishChunk.ttftMs;
      finalTotalMs = finishChunk.totalMs;

      const completeData = {
        model: finishChunk.model,
        inputTokens: finishChunk.usage.inputTokens,
        outputTokens: finishChunk.usage.outputTokens,
        totalTokens: finishChunk.usage.totalTokens,
        // Cache hit signal: OpenAI sets cached_tokens on automatic prompt cache
        // hits (80% latency, 50% cost reduction when firing). Gemini surfaces
        // cachedContentTokenCount the same way. 0 / undefined means NOT cached
        // — worth investigating if your prefix is stable.
        cachedInputTokens: finishChunk.usage.cachedInputTokens ?? 0,
        // Reasoning tokens: Gemini 2.5's "thinking" budget consumption. If
        // thinkingBudget=0 is honoured this is 0. Non-zero = thinking is still
        // happening despite config, which is a known AI SDK bug we'd need to
        // work around.
        reasoningTokens: finishChunk.usage.reasoningTokens ?? 0,
        cost: finishChunk.cost,
        finishReason: finishChunk.finishReason,
        ttftMs: finishChunk.ttftMs,
      };
      trace.step('llm.complete', completeData, finishChunk.totalMs);
      yield {
        type: 'trace',
        step: 'llm.complete',
        durationMs: finishChunk.totalMs,
        data: completeData,
      };

      const result: DirectChatResult = {
        text: finalTextBuffer,
        traceId: trace.traceId,
        usage: finalUsage,
        cost: finalCost,
        model: finalModel,
        finishReason: finalFinishReason,
        latencyMs: finalTotalMs,
        ttftMs: finalTtftMs,
        historyCount: context.historyCount,
        estimatedInputTokens: context.estimatedTokens,
        historyTruncated: context.truncated,
      };

      this.usageTracker.record({
        organizationId: req.agent.organizationId,
        agentId: req.agent.id,
        sessionId: req.externalSessionId,
        traceId: trace.traceId,
        model: finalModel,
        requestedModel: modelId,
        usage: finalUsage,
        cost: finalCost,
        feature: req.feature ?? 'chat-stream',
        latencyMs: finalTotalMs,
        finishReason: finalFinishReason,
      });

      yield { type: 'finish', result };

      // Fire-and-forget: response is already delivered to the user. Blocking
      // on the trace DB write would extend the SSE connection and delay the
      // client's `done` event for no benefit. Errors are logged by trace.end
      // itself via pino — they won't surface here.
      void trace.end({
        success: true,
        response: finalTextBuffer,
        model: finalModel ?? modelId,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Abort is not really an error from the orchestration's POV — it's a
      // user action (client disconnected). We still end the trace but mark
      // success=false so analytics can distinguish from happy-path.
      trace.error(
        isAbort ? 'llm.aborted' : 'llm.failed',
        err instanceof Error ? err : new Error(errorMsg),
      );
      yield {
        type: 'error',
        error: errorMsg,
        code: isAbort ? 'ABORTED' : undefined,
      };

      void trace.end({
        success: false,
        error: errorMsg,
        response: finalTextBuffer || undefined,
        model: finalModel ?? undefined,
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse the agent's stored aiConfig (JSONB) through the Zod schema so that
 * defaults are populated consistently. If the stored config is invalid (e.g.
 * old shape from a deploy that landed before the schema updated), log a
 * warning and fall back to schema defaults rather than failing the chat call.
 *
 * The WARNING is intentionally loud — silently falling back to defaults once
 * cost us ~2 debug cycles (fallback models were being dropped because a Zod
 * max was too low and the error was swallowed).
 */
function resolveConfig(agent: Agent): AgentAiConfigDto {
  const raw = agent.aiConfig ?? {};
  const parsed = agentAiConfigSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const logger = new Logger('resolveAiConfig');
  logger.warn(
    `Agent ${agent.id} has an invalid aiConfig — falling back to schema defaults. Issues: ${parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`,
  );
  return agentAiConfigSchema.parse({});
}

/**
 * Determine the effective system prompt TEMPLATE for this turn. Precedence:
 *   1. aiConfig.systemPromptTemplate (agent override)
 *   2. agent.systemPrompt (legacy column, still the primary source of truth)
 *   3. Empty string (pure vanilla model behaviour)
 *
 * Returns the RAW template — `{{variable}}` placeholders unresolved. The
 * caller is expected to run it through PromptTemplateService with a context.
 */
function resolveSystemPromptTemplate(
  agent: Agent,
  config: AgentAiConfigDto,
): string {
  return config.systemPromptTemplate ?? agent.systemPrompt ?? '';
}

/**
 * Instruction appended to the END of the system prompt telling the agent what
 * to say when it has nothing useful to offer. Returns '' when the agent
 * configured no phrases, so nothing is added to the prompt at all.
 *
 * Deliberately framed as a LAST RESORT: the model should still give helpful
 * partial/general answers (e.g. "it varies — contact us for specifics") for
 * anything it can speak to. The canned phrase is only for genuine dead-ends
 * (question entirely outside its knowledge). An earlier, more aggressive
 * wording turned good soft answers into robotic give-ups.
 */
function buildFallbackInstruction(agent: Agent): string {
  const phrases = (agent.fallbackPhrases ?? []).filter((p) => p.trim().length > 0);
  if (phrases.length === 0) return '';
  const list = phrases.map((p) => `- ${p}`).join('\n');
  return (
    '\n\n---\n\nAlways try to help first. If you have any relevant information — even ' +
    'partial or general — give a useful answer, and point the user to the team for ' +
    'specifics you do not have. Only when the question is entirely outside what you ' +
    'know and you have nothing useful to offer at all, reply with exactly one of the ' +
    'following phrases, word for word and nothing else:\n' +
    list
  );
}
