import { Injectable, Logger } from '@nestjs/common';
import type { Agent, AgentDataField } from '@prisma/client';
import { type AgentAiConfigDto } from '@repo/validation';

import { AgentCacheService } from '../../common/cache/agent-cache.service';
import { RagLoggerService } from '../../common/logger/rag.logger';
import { AgentToolsService, type AgentToolBundle } from '../integrations/agent-tools.service';
import {
  buildRagSystemBlock,
  describeRetrievedDocuments,
  extractCitations,
} from '../rag/rag-context';
import { RagRetrievalService, type RetrievedChunk } from '../rag/rag-retrieval.service';
import { DataExtractionService } from '../../services/data-extraction.service';
import { PrismaService } from '../../services/prisma.service';

import { AiSdkService } from './ai-sdk.service';
import { ContextAssemblyService } from './context-assembly.service';
import type {
  DirectChatRequest,
  DirectChatResult,
  DirectChatStreamChunk,
} from './interfaces/direct-chat.interfaces';
import type { LlmFeature, LlmStreamChunk } from './interfaces/llm.interfaces';
import { LlmService } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { resolveAiConfig } from './resolve-ai-config';
import { HybridContextStrategy } from './strategies/hybrid-context.strategy';
import { AiTraceService } from './trace/ai-trace.service';
import type { TraceContext } from './trace/ai-trace.interfaces';
import { UsageTrackingService } from './usage-tracking.service';

/** Divider prepended before injected knowledge content in the system prompt. */
const KNOWLEDGE_DIVIDER = '\n\n---\n\n[REFERENCE KNOWLEDGE]\n';

/** Divider prepended before the data-collection instruction. */
const DATA_COLLECTION_DIVIDER = '\n\n---\n\n[DATA TO COLLECT]\n';

/**
 * Features that represent a real end-user conversation turn — the only ones
 * eligible for background data capture, RAG retrieval and integration tools.
 * Internal `send()` calls (summarisation, title-generation, rag-*, embedding,
 * warmup) must NEVER enqueue extraction, retrieve documents or call tools.
 * `send()` is used by WhatsApp inbound (`feature: 'chat'`), so we cover it
 * here too — not just the streaming widget path.
 */
const CAPTURE_ELIGIBLE_FEATURES = new Set<string>([
  'chat',
  'chat-stream',
  'voice',
]);

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
    private readonly dataExtractionService: DataExtractionService,
    private readonly ragRetrieval: RagRetrievalService,
    private readonly agentTools: AgentToolsService,
    private readonly ragLogger: RagLoggerService,
  ) {}

  /**
   * RAG runs when the agent enables it, the turn is a real conversation (not
   * warmup/summarisation), AND the agent actually has indexed documents. The
   * existence check is one fast indexed query — it runs BEFORE the parallel
   * load phase so stream() can emit the "Searching…" step only for agents
   * that truly have a knowledge base. Fails open to "no RAG".
   */
  private async ragAvailable(
    req: DirectChatRequest,
    config: AgentAiConfigDto,
    feature: LlmFeature,
  ): Promise<boolean> {
    if (!config.ragEnabled || !CAPTURE_ELIGIBLE_FEATURES.has(feature)) {
      return false;
    }
    try {
      return await this.ragRetrieval.hasReadyDocuments(
        req.agent.id,
        req.agent.organizationId,
      );
    } catch (err) {
      this.logger.warn(
        `RAG availability check failed for agent ${req.agent.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Retrieve knowledge chunks for this turn. Never throws — retrieval
   * problems degrade to "answer without RAG" and are surfaced via trace +
   * audit log (RAG_RETRIEVAL_FAILED), not to the visitor.
   */
  private async retrieveRag(
    req: DirectChatRequest,
    config: AgentAiConfigDto,
    trace: TraceContext,
  ): Promise<{ chunks: RetrievedChunk[]; latencyMs: number } | null> {
    const start = performance.now();
    try {
      const chunks = await this.ragRetrieval.retrieve({
        agentId: req.agent.id,
        organizationId: req.agent.organizationId,
        query: req.newUserMessage,
        strategy: config.ragRetrievalStrategy,
        topK: config.ragTopK,
        similarityThreshold: config.ragSimilarityThreshold,
        sessionId: req.externalSessionId,
      });
      const latencyMs = Math.round(performance.now() - start);
      trace.step(
        'rag.retrieve',
        {
          strategy: config.ragRetrievalStrategy,
          chunksRetrieved: chunks.length,
          documents: [...new Set(chunks.map((c) => c.documentName))],
        },
        latencyMs,
      );
      return { chunks, latencyMs };
    } catch (err) {
      trace.error(
        'rag.failed',
        err instanceof Error ? err : new Error(String(err)),
      );
      void this.ragLogger.logRetrievalFailed(req.agent.id, err, {
        sessionId: req.externalSessionId,
        strategy: config.ragRetrievalStrategy,
      });
      return null;
    }
  }

  /**
   * Load the agent's integration tools (HubSpot, Slack, …) for this turn.
   * Never throws — a broken integration must not take chat down.
   */
  private async loadIntegrationTools(
    req: DirectChatRequest,
    feature: LlmFeature,
    traceId: string,
  ): Promise<AgentToolBundle | null> {
    if (!CAPTURE_ELIGIBLE_FEATURES.has(feature)) return null;
    try {
      return await this.agentTools.buildToolsForAgent(req.agent.id, {
        sessionId: req.externalSessionId,
        traceId,
      });
    } catch (err) {
      this.logger.error(
        `Integration tool load failed for agent ${req.agent.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Load an agent's static knowledge content AND its data-capture field
   * definitions in a single cached read. Both ride the same Redis entry
   * (AgentCacheService), so this is one round-trip, not two. Results are
   * appended to the system prompt by the caller.
   *
   * `knowledge` is `null` when no knowledge record exists; `dataFields` is an
   * empty array when the agent collects nothing. Cache failures fall through
   * transparently to Postgres (see AgentCacheService for details).
   */
  private async loadAgentExtras(agentId: string): Promise<{
    knowledge: { content: string; tokens: number | null } | null;
    dataFields: AgentDataField[];
  }> {
    const cached = await this.agentCache.getAgentWithKnowledge(agentId);
    const knowledge =
      cached?.knowledge && cached.knowledge.content.trim()
        ? {
            content: cached.knowledge.content,
            tokens: cached.knowledge.contentTokens,
          }
        : null;
    return { knowledge, dataFields: cached?.dataFields ?? [] };
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
    const feature = req.feature ?? 'chat';

    try {
      const ragEligible = await this.ragAvailable(req, config, feature);

      // Knowledge load (Redis→Postgres for AgentKnowledge), context load
      // (Postgres findMany on ChatMessage), RAG retrieval (embed + pgvector)
      // and integration-tool load hit different tables/APIs and have no data
      // dependency — running them serially would waste round-trips.
      //
      // Context assembly DOES use the system prompt for its token-budget
      // charEstimate, but the estimate is cheap and we account for the
      // knowledge tokens by pre-seeding the budget. See contextWithKnowledge()
      // below for the reconciliation.
      const knowledgeStart = performance.now();
      const contextStart = performance.now();
      const [extras, context, rag, toolBundle] = await Promise.all([
        this.loadAgentExtras(req.agent.id).then((e) => {
          const knowledgeMs = Math.round(performance.now() - knowledgeStart);
          trace.step(
            'knowledge.load',
            {
              hasKnowledge: e.knowledge !== null,
              knowledgeTokens: e.knowledge?.tokens ?? 0,
              dataFieldCount: e.dataFields.length,
            },
            knowledgeMs,
          );
          return e;
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
        ragEligible
          ? this.retrieveRag(req, config, trace)
          : Promise.resolve(null),
        this.loadIntegrationTools(req, feature, trace.traceId),
      ]);
      const { knowledge, dataFields } = extras;
      const ragChunks = rag?.chunks ?? [];
      const systemPrompt =
        (knowledge
          ? systemPromptResolved + KNOWLEDGE_DIVIDER + knowledge.content
          : systemPromptResolved) +
        buildCollectionInstruction(dataFields) +
        buildFallbackInstruction(req.agent) +
        // RAG block goes AFTER the static sections so the per-turn retrieved
        // text never breaks the provider prompt-cache prefix for the stable
        // persona/knowledge/instructions part.
        buildRagSystemBlock(ragChunks) +
        buildExtraInstruction(req.extraSystemInstruction);

      // Integration tools + caller-supplied tools (e.g. handover's
      // connect_to_human). Caller tools win on name collisions.
      const mergedTools = {
        ...(toolBundle?.tools ?? {}),
        ...(req.tools ?? {}),
      };
      const hasTools = Object.keys(mergedTools).length > 0;
      const maxSteps = hasTools
        ? Math.max(req.maxSteps ?? 0, toolBundle ? 5 : 3)
        : undefined;

      trace.step('llm.call_start', {
        model: modelId,
        streaming: false,
        feature,
        toolCount: Object.keys(mergedTools).length,
        ragChunks: ragChunks.length,
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
            feature,
            // Integration tools + caller tools (e.g. WhatsApp buffered turns
            // escalating via connect_to_human) — parity with streaming.
            tools: hasTools ? mergedTools : undefined,
            maxSteps,
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
        citations: extractCitations(result.text, ragChunks),
        ragLatencyMs: rag?.latencyMs ?? null,
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
        feature,
        latencyMs: result.latencyMs,
        retryCount: result.retryCount,
        finishReason: result.finishReason,
      });

      void trace.end({
        success: true,
        response: result.text,
        model: result.model,
      });

      // Off-hot-path data capture for BUFFERED turns (e.g. WhatsApp inbound,
      // which uses send()). Same debounced, gated behaviour as stream(): only
      // when the agent collects something AND this is a real user-facing turn
      // (never internal send() calls like summarisation/title-gen).
      if (dataFields.length > 0 && CAPTURE_ELIGIBLE_FEATURES.has(feature)) {
        void this.dataExtractionService.scheduleExtraction(req.chatSessionId);
      }

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
    const feature = req.feature ?? 'chat-stream';

    try {
      // ----- Phase 0: RAG availability (one fast indexed query) -----
      // Runs first so the widget's "Searching the knowledge base…" step only
      // appears for agents that actually have indexed documents.
      const ragEligible = await this.ragAvailable(req, config, feature);
      if (ragEligible) {
        yield {
          type: 'step',
          step: {
            id: 'rag',
            kind: 'rag',
            label: 'Searching the knowledge base…',
            status: 'active',
          },
        };
      }

      // ----- Phase 1: Knowledge + Context + RAG + Tools (in parallel) -----
      //
      // Independent reads (AgentKnowledge via Redis→Postgres; ChatMessage via
      // Postgres OR skipped entirely if the caller supplied recentHistory;
      // RAG = embedding API + pgvector; tools = one indexed SELECT). Each
      // records its OWN wall time via a per-promise timestamp so the trace
      // shows which is actually slow.
      const parallelStart = performance.now();
      const knowledgeStart = parallelStart;
      const contextStart = parallelStart;
      let knowledgeMs = 0;
      let contextMs = 0;

      const [extras, context, rag, toolBundle] = await Promise.all([
        this.loadAgentExtras(req.agent.id).then((e) => {
          knowledgeMs = Math.round(performance.now() - knowledgeStart);
          return e;
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
        ragEligible
          ? this.retrieveRag(req, config, trace)
          : Promise.resolve(null),
        this.loadIntegrationTools(req, feature, trace.traceId),
      ]);
      const { knowledge, dataFields } = extras;
      const ragChunks = rag?.chunks ?? [];

      // Settle the knowledge-search step now that retrieval finished.
      if (ragEligible) {
        yield {
          type: 'step',
          step:
            rag === null
              ? {
                  id: 'rag',
                  kind: 'rag',
                  label: 'Knowledge search failed',
                  status: 'error',
                }
              : {
                  id: 'rag',
                  kind: 'rag',
                  label:
                    ragChunks.length > 0
                      ? `Read ${describeRetrievedDocuments(ragChunks)}`
                      : 'Searched the knowledge base',
                  status: 'done',
                },
        };
      }

      const knowledgeData = {
        hasKnowledge: knowledge !== null,
        knowledgeTokens: knowledge?.tokens ?? 0,
        dataFieldCount: dataFields.length,
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
          : systemPromptResolved) +
        buildCollectionInstruction(dataFields) +
        buildFallbackInstruction(req.agent) +
        // RAG block goes AFTER the static sections so the per-turn retrieved
        // text never breaks the provider prompt-cache prefix for the stable
        // persona/knowledge/instructions part.
        buildRagSystemBlock(ragChunks) +
        buildExtraInstruction(req.extraSystemInstruction);

      // Integration tools + caller-supplied tools (e.g. handover's
      // connect_to_human). Caller tools win on name collisions.
      const mergedTools = {
        ...(toolBundle?.tools ?? {}),
        ...(req.tools ?? {}),
      };
      const hasTools = Object.keys(mergedTools).length > 0;
      const maxSteps = hasTools
        ? Math.max(req.maxSteps ?? 0, toolBundle ? 5 : 3)
        : undefined;
      const toolStepMeta = toolBundle?.stepMeta ?? {};

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
        feature,
        toolCount: Object.keys(mergedTools).length,
        ragChunks: ragChunks.length,
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
        feature,
        // Integration tools (HubSpot/Slack) + caller tools (human-handover's
        // connect_to_human). The AI SDK runs the tool loop; text deltas still
        // stream through unchanged.
        tools: hasTools ? mergedTools : undefined,
        maxSteps,
      });

      let finishChunk:
        | Extract<LlmStreamChunk, { type: 'finish' }>
        | null = null;
      // toolCallId → start time, for the tool.result trace duration.
      const pendingToolCalls = new Map<string, number>();

      for await (const chunk of handle.stream) {
        if (chunk.type === 'text-delta') {
          finalTextBuffer += chunk.content;
          yield { type: 'text-delta', content: chunk.content };
        } else if (chunk.type === 'tool-call') {
          trace.step('tool.call', {
            tool: chunk.toolName,
            toolCallId: chunk.toolCallId,
          });
          pendingToolCalls.set(chunk.toolCallId, performance.now());
          // Only tools with step metadata surface to the widget — internal
          // tools (connect_to_human) have their own dedicated UX.
          const meta = toolStepMeta[chunk.toolName];
          if (meta) {
            yield {
              type: 'step',
              step: {
                id: `tool-${chunk.toolCallId}`,
                kind: 'tool',
                label: meta.activeLabel,
                status: 'active',
              },
            };
          }
        } else if (chunk.type === 'tool-result') {
          const startedAt = pendingToolCalls.get(chunk.toolCallId);
          pendingToolCalls.delete(chunk.toolCallId);
          trace.step(
            'tool.result',
            { tool: chunk.toolName, errored: chunk.errored ?? false },
            startedAt ? Math.round(performance.now() - startedAt) : 0,
          );
          const meta = toolStepMeta[chunk.toolName];
          if (meta) {
            yield {
              type: 'step',
              step: {
                id: `tool-${chunk.toolCallId}`,
                kind: 'tool',
                label: chunk.errored ? meta.errorLabel : meta.doneLabel,
                status: chunk.errored ? 'error' : 'done',
              },
            };
          }
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

      // Map inline [N] markers back to knowledge-base documents. Cheap regex
      // pass; empty when RAG didn't run or the model cited nothing.
      const citations = extractCitations(finalTextBuffer, ragChunks);
      if (citations.length > 0) {
        trace.step('rag.citations', {
          cited: citations.length,
          documents: citations.map((c) => c.documentName),
        });
      }

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
        citations,
        ragLatencyMs: rag?.latencyMs ?? null,
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
        feature,
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

      // Debounced, off-hot-path data capture. Only when the agent actually
      // collects something (agents without fields never enqueue) AND this is a
      // real user-facing turn. Runs ~60s after the conversation settles (once
      // per conversation), so it adds ZERO latency to the reply just delivered.
      // See docs/plans/agent-data-and-integrations-plan.md.
      if (dataFields.length > 0 && CAPTURE_ELIGIBLE_FEATURES.has(feature)) {
        void this.dataExtractionService.scheduleExtraction(req.chatSessionId);
      }
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
 * Parse the agent's stored aiConfig (JSONB) through the shared resolver so
 * defaults populate consistently. See resolve-ai-config.ts.
 */
function resolveConfig(agent: Agent): AgentAiConfigDto {
  return resolveAiConfig(agent.aiConfig, `resolveAiConfig:${agent.id}`);
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
/**
 * Build the in-band data-collection instruction appended to the system prompt.
 * Returns '' when the agent collects nothing, so zero tokens are added.
 *
 * This is the "asking" half of data capture and costs NOTHING extra — it's just
 * text the model already reads in the single inference it's doing anyway. The
 * "storing" half (pulling values out) happens out of band in the background
 * extractor, never on the reply path. See
 * docs/plans/agent-data-and-integrations-plan.md.
 *
 * Framing matters: the model must NEVER block answering the user's question to
 * collect data, and must not interrogate. It captures what's volunteered and
 * politely asks for REQUIRED items only when it fits the flow.
 */
function buildCollectionInstruction(fields: AgentDataField[]): string {
  if (!fields || fields.length === 0) return '';
  const lines = fields.map((f) => {
    const parts = [`- ${f.label} (key: ${f.key})`];
    if (f.required) parts.push('[required]');
    if (f.description) parts.push(`— ${f.description}`);
    return parts.join(' ');
  });
  const hasRequired = fields.some((f) => f.required);
  const requiredNote = hasRequired
    ? ' For items marked [required], if the user has not provided them and it is a natural moment, politely ask — at most one missing item at a time, and only when it fits the conversation.'
    : '';
  return (
    DATA_COLLECTION_DIVIDER +
    'While helping the user, naturally note the following details if they come up. ' +
    'Do not announce that you are collecting information, and NEVER delay or withhold ' +
    'an answer in order to ask for it — answering the user always comes first.' +
    requiredNote +
    '\n' +
    lines.join('\n')
  );
}

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

/**
 * Per-turn extra instruction (e.g. the human-handover "stall" hint). Appended
 * last so it takes precedence over the base prompt for this turn only.
 */
function buildExtraInstruction(instruction?: string): string {
  if (!instruction || !instruction.trim()) return '';
  return '\n\n---\n\n[ACTIVE INSTRUCTION]\n' + instruction.trim();
}
