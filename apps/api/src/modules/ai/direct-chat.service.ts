import { Injectable, Logger } from "@nestjs/common";
import type { Agent, AgentDataField } from "@prisma/client";
import { agentAiConfigSchema, type AgentAiConfigDto } from "@repo/validation";
import type { ModelMessage } from "ai";

import { AgentCacheService } from "../../common/cache/agent-cache.service";
import { AppLogger } from "../../common/logger/app-logger";
import { PiiDetectionService } from "../pii/pii-detection.service";
import {
  PiiTokenizerService,
  type PiiSessionContext,
} from "../pii/pii-tokenizer.service";
import { StreamDetokenizer } from "../pii/stream-detokenizer";
import { DataExtractionService } from "../../services/data-extraction.service";
import { PrismaService } from "../../services/prisma.service";
import {
  GuardrailService,
  type GuardrailScope,
} from "../guardrails/guardrail.service";
import type { InjectionVerdict } from "../guardrails/injection-detector";
import {
  CLOSING_REMINDER,
  KNOWLEDGE_TAG,
  NEUTRALIZE_NOTICE,
  SUMMARY_TAG,
  inputBlockedReply,
  outputBlockedReply,
  wrapUntrusted,
} from "../guardrails/prompt-hardening";

import { AiSdkService } from "./ai-sdk.service";
import { ContextAssemblyService } from "./context-assembly.service";
import type {
  DirectChatRequest,
  DirectChatResult,
  DirectChatStreamChunk,
} from "./interfaces/direct-chat.interfaces";
import type { LlmStreamChunk } from "./interfaces/llm.interfaces";
import { LlmService } from "./llm.service";
import { PromptTemplateService } from "./prompt-template.service";
import { HybridContextStrategy } from "./strategies/hybrid-context.strategy";
import { SummaryRefreshService } from "./summary-refresh.service";
import type { TraceContext } from "./trace/ai-trace.interfaces";
import { AiTraceService } from "./trace/ai-trace.service";

/** Divider prepended before injected knowledge content in the system prompt. */
const KNOWLEDGE_DIVIDER = "\n\n---\n\n[REFERENCE KNOWLEDGE]\n";

/** Divider prepended before the data-collection instruction. */
const DATA_COLLECTION_DIVIDER = "\n\n---\n\n[DATA TO COLLECT]\n";

/**
 * Divider prepended before the running conversation summary (hybrid context
 * strategy). Placed AFTER the stable persona/knowledge/instructions prefix so
 * the per-conversation summary never breaks the provider prompt-cache prefix
 * for the static part.
 */
const SUMMARY_DIVIDER = "\n\n---\n\n[SUMMARY OF EARLIER CONVERSATION]\n";

/**
 * Features that represent a real end-user conversation turn — the only ones
 * eligible to trigger background data capture. Internal `send()` calls
 * (summarisation, title-generation, rag-*, embedding) must NEVER
 * enqueue extraction. `send()` is used by WhatsApp inbound (`feature: 'chat'`),
 * so we cover it here too — not just the streaming widget path.
 */
const CAPTURE_ELIGIBLE_FEATURES = new Set<string>([
  "chat",
  "chat-stream",
  "voice",
]);

/**
 * DirectChatService: the orchestrator for every AI reply. It composes:
 *
 *   1. ContextAssemblyService  → load message history from DB
 *   2. (Phase 3: RAG retrieval → inject into system prompt)
 *   3. LlmService              → the actual provider call
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
 *   - Rate limiting, permissions                             → Controllers + guards
 *   - Recording usage + cost                                 → LlmService meters every call (ADR-0012)
 */
@Injectable()
export class DirectChatService {
  private readonly log = new AppLogger(DirectChatService.name);

  constructor(
    private readonly aiSdk: AiSdkService,
    private readonly llmService: LlmService,
    private readonly contextService: ContextAssemblyService,
    private readonly hybridStrategy: HybridContextStrategy,
    private readonly promptTemplate: PromptTemplateService,
    private readonly traceService: AiTraceService,
    private readonly prisma: PrismaService,
    private readonly agentCache: AgentCacheService,
    private readonly dataExtractionService: DataExtractionService,
    private readonly piiDetection: PiiDetectionService,
    private readonly piiTokenizer: PiiTokenizerService,
    private readonly summaryRefresh: SummaryRefreshService,
    private readonly guardrails: GuardrailService,
  ) {}

  /**
   * After a reply is delivered: if this turn's context assembly truncated
   * history and the agent uses a summarising strategy, rebuild the running
   * summary in the background so the NEXT turn has it. Fire-and-forget —
   * adds zero latency to the reply just delivered. Gated to real user-facing
   * turns so internal send() calls (title-gen, the summariser itself) can
   * never recurse.
   */
  private maybeScheduleSummaryRefresh(
    req: DirectChatRequest,
    config: AgentAiConfigDto,
    context: { truncated: boolean; olderMessagesExist: boolean },
    feature: string,
    traceId: string,
  ): void {
    const strategy = config.contextStrategy ?? "sliding-window";
    if (strategy !== "hybrid" && strategy !== "summarize") return;
    if (!context.truncated && !context.olderMessagesExist) return;
    if (!CAPTURE_ELIGIBLE_FEATURES.has(feature)) return;
    this.summaryRefresh.schedule({
      chatSessionId: req.chatSessionId,
      organizationId: req.agent.organizationId,
      agentId: req.agent.id,
      maxContextMessages: config.maxContextMessages,
      piiRedactionEnabled: config.piiRedactionEnabled,
      traceId,
    });
  }

  /**
   * Format the running summary for the system prompt ('' when absent). It is
   * written from visitor messages, so it is delimited as untrusted data.
   */
  private static buildSummaryBlock(summary?: string): string {
    if (!summary) return "";
    return SUMMARY_DIVIDER + wrapUntrusted(SUMMARY_TAG, summary);
  }

  /**
   * The full system prompt, in prompt-cache order (ADR-0018):
   *
   *   security preamble (+ canary)   stable per agent per process
   *   operator prompt                stable per agent
   *   knowledge (delimited)          stable per agent
   *   data collection, fallback      stable per agent
   *   ---- everything below may change per conversation or per turn ----
   *   running summary (delimited), active instruction, security notice,
   *   closing reminder
   */
  private buildSystemPrompt(p: {
    agent: Agent;
    operatorPrompt: string;
    knowledge: { content: string } | null;
    dataFields: AgentDataField[];
    summary?: string;
    extraInstruction?: string;
    neutralize: boolean;
  }): string {
    return (
      this.guardrails.preambleFor(p.agent.id) +
      p.operatorPrompt +
      (p.knowledge
        ? KNOWLEDGE_DIVIDER + wrapUntrusted(KNOWLEDGE_TAG, p.knowledge.content)
        : "") +
      buildCollectionInstruction(p.dataFields) +
      buildFallbackInstruction(p.agent) +
      CONDUCT_RULES +
      DirectChatService.buildSummaryBlock(p.summary) +
      buildExtraInstruction(p.extraInstruction) +
      (p.neutralize ? NEUTRALIZE_NOTICE : "") +
      CLOSING_REMINDER
    );
  }

  /** Event-log scope for this turn's guardrail triggers. */
  private static guardScope(
    req: DirectChatRequest,
    feature: string,
  ): GuardrailScope {
    return {
      agentId: req.agent.id,
      organizationId: req.agent.organizationId,
      chatSessionId: req.chatSessionId,
      channel:
        req.channel ??
        (feature === "voice"
          ? "VOICE"
          : feature === "chat" || feature === "chat-stream"
            ? "WIDGET"
            : "INTERNAL"),
      feature,
    };
  }

  /**
   * Input guardrail for the new visitor message. Pure CPU, runs before any DB
   * read or LLM call. Logs and traces anything that is not "allow".
   */
  private inspectInput(
    req: DirectChatRequest,
    scope: GuardrailScope,
    trace: TraceContext,
  ): InjectionVerdict {
    const start = performance.now();
    const verdict = this.guardrails.inspectInput(req.newUserMessage);
    if (verdict.action !== "allow") {
      this.guardrails.reportInput(scope, verdict, req.newUserMessage);
      trace.step(
        "guardrail.input",
        { action: verdict.action, rules: verdict.rules, score: verdict.score },
        Math.round(performance.now() - start),
      );
    }
    return verdict;
  }

  /**
   * Withhold history turns that score a block (see
   * GuardrailService.neutralizeHistory). The new user turn is the last
   * message; it was already checked by inspectInput.
   */
  private neutralizeHistory(
    messages: ModelMessage[],
    req: DirectChatRequest,
    scope: GuardrailScope,
    trace: TraceContext,
  ): ModelMessage[] {
    const last = messages.length - 1;
    const lastMsg = messages[last];
    const skipIndex =
      lastMsg?.role === "user" && lastMsg.content === req.newUserMessage
        ? last
        : -1;
    const out = this.guardrails.neutralizeHistory(messages, skipIndex);
    if (out.withheld > 0) {
      this.guardrails.reportHistory(scope, out.withheld, out.rules);
      trace.step("guardrail.history", {
        withheldTurns: out.withheld,
        rules: out.rules,
      });
    }
    return out.messages;
  }

  /** Result for a turn the guardrails answered without (or instead of) the model. */
  private static guardrailResult(
    text: string,
    traceId: string,
    model: string,
    latencyMs: number,
    cost: number | null,
  ): DirectChatResult {
    return {
      text,
      traceId,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost,
      model,
      finishReason: "guardrail",
      latencyMs,
      ttftMs: null,
      historyCount: 0,
      estimatedInputTokens: 0,
      historyTruncated: false,
    };
  }

  /**
   * PII compliance floor, applied to EVERY request before anything reads it
   * (trace preview, context assembly, LLM): destroy HARD_DROP-tier identifiers
   * (Aadhaar/PAN/cards/…) in the new user turn and any client-supplied
   * history. Toggle-independent by design — see docs/plans/pii-redaction-plan.md.
   * Returns a shallow copy; the caller's DTO is not mutated.
   */
  private maskHardDropInRequest(req: DirectChatRequest): DirectChatRequest {
    return {
      ...req,
      newUserMessage: this.piiDetection.maskHardDrop(req.newUserMessage),
      recentHistory: req.recentHistory?.map((m) => ({
        ...m,
        content: this.piiDetection.maskHardDrop(m.content),
      })),
    };
  }

  /**
   * Load the session token map when the agent has PII redaction on; null
   * otherwise. Runs in parallel with knowledge/context loading — one indexed
   * query, never on the critical path alone.
   */
  private loadPiiContext(
    req: DirectChatRequest,
    config: AgentAiConfigDto,
  ): Promise<PiiSessionContext | null> {
    if (!config.piiRedactionEnabled) return Promise.resolve(null);
    return this.piiTokenizer.forSession(
      req.agent.organizationId,
      req.chatSessionId,
    );
  }

  /**
   * What actually goes to the LLM: HARD_DROP-masked always (legacy DB rows may
   * predate ingestion masking), TOKENIZE-tier replaced with placeholders when
   * the agent's toggle is on. Records a `pii.redact` trace step when anything
   * changed. Pure CPU (<1ms for a 20-message window).
   */
  private applyPiiToMessages(
    messages: ModelMessage[],
    piiCtx: PiiSessionContext | null,
    trace: TraceContext,
  ): ModelMessage[] {
    const start = performance.now();
    let changed = 0;
    const out = messages.map((m): ModelMessage => {
      // Only user/assistant text turns carry conversation content; tool and
      // system parts pass through untouched.
      if (m.role !== "user" && m.role !== "assistant") return m;
      if (typeof m.content !== "string") return m;
      let content = this.piiDetection.maskHardDrop(m.content);
      if (piiCtx) content = piiCtx.tokenize(content);
      if (content === m.content) return m;
      changed++;
      return { ...m, content };
    });
    if (changed > 0) {
      trace.step(
        "pii.redact",
        { messagesChanged: changed, tokenized: piiCtx !== null },
        Math.round(performance.now() - start),
      );
    }
    return out;
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
    strategy: "sliding-window" | "summarize" | "hybrid" | undefined,
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
    if (strategy === "hybrid" || strategy === "summarize") {
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
    this.log.debug("send", "starting non-streaming send", {
      agentId: req.agent.id,
      sessionId: req.externalSessionId,
      feature: req.feature ?? "chat",
    });
    // Compliance floor first: Aadhaar/PAN/cards/… never survive past this
    // line, so everything below (trace, context, LLM) only ever sees masks.
    req = this.maskHardDropInRequest(req);
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
    const feature = req.feature ?? "chat";
    const scope = DirectChatService.guardScope(req, feature);

    // Input guardrail: a likely injection gets the canned reply and no LLM call.
    const verdict = this.inspectInput(req, scope, trace);
    if (verdict.action === "block") {
      const reply = inputBlockedReply(req.newUserMessage);
      void trace.end({ success: true, response: reply, model: modelId });
      return DirectChatService.guardrailResult(
        reply,
        trace.traceId,
        modelId,
        0,
        0,
      );
    }

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
      const [extras, context, piiCtx] = await Promise.all([
        this.loadAgentExtras(req.agent.id).then((e) => {
          const knowledgeMs = Math.round(performance.now() - knowledgeStart);
          trace.step(
            "knowledge.load",
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
            "context.load",
            {
              strategy: config.contextStrategy ?? "sliding-window",
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
        this.loadPiiContext(req, config),
      ]);
      const { knowledge, dataFields } = extras;
      // What the LLM sees: attack turns in history withheld, hard-drop-masked
      // always, tokenized when toggled on.
      const llmMessages = this.applyPiiToMessages(
        this.neutralizeHistory(context.messages, req, scope, trace),
        piiCtx,
        trace,
      );
      const systemPrompt = this.buildSystemPrompt({
        agent: req.agent,
        operatorPrompt: systemPromptResolved,
        knowledge,
        dataFields,
        summary: context.summaryBlock,
        extraInstruction: req.extraSystemInstruction,
        neutralize: verdict.action === "neutralize",
      });

      trace.step("llm.call_start", {
        model: modelId,
        streaming: false,
        feature: req.feature ?? "chat",
      });

      const result = await trace.measure(
        "llm.complete",
        () =>
          this.llmService.generateCompletion({
            modelId,
            systemPrompt,
            messages: llmMessages,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            topP: config.topP,
            frequencyPenalty: config.frequencyPenalty,
            presencePenalty: config.presencePenalty,
            abortSignal: req.abortSignal,
            organizationId: req.agent.organizationId,
            agentId: req.agent.id,
            sessionId: req.externalSessionId,
            chatSessionId: req.chatSessionId,
            traceId: trace.traceId,
            feature: req.feature ?? "chat",
            channel: req.channel,
            // Forward tools so buffered turns (WhatsApp) can escalate via the
            // connect_to_human tool too — parity with the streaming path.
            tools: req.tools,
            maxSteps: req.maxSteps,
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

      // Output guardrail over the whole raw reply (placeholders intact), the
      // same check the streaming path runs chunk by chunk.
      const outGuard = this.guardrails.createOutputGuard(req.agent.id);
      outGuard.push(result.text);
      outGuard.end();
      if (outGuard.violation) {
        this.guardrails.reportOutput(scope, outGuard.violation);
        trace.step("guardrail.output", {
          rule: outGuard.violation.rule,
          stopped: outGuard.blocked,
        });
      }

      // The model replies over placeholders; the visitor (and the persisted
      // assistant message) must see real values again. Raw model output keeps
      // the placeholders — that's exactly what we want in the trace log.
      const visibleText = outGuard.blocked
        ? outputBlockedReply(req.newUserMessage)
        : piiCtx
          ? piiCtx.detokenize(result.text)
          : result.text;

      const finalResult: DirectChatResult = {
        text: visibleText,
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

      // Always the tokenised forms when redaction is on (no separate log switch).
      const redactTraceLog = piiCtx !== null;
      void trace.end({
        success: true,
        // Log redaction: persist the tokenized forms (raw model output already
        // contains placeholders); otherwise the re-hydrated text. A blocked
        // reply persists only the safe text: the raw one may hold the system
        // prompt or a credential.
        response:
          redactTraceLog && !outGuard.blocked ? result.text : visibleText,
        ...(redactTraceLog
          ? { userMessage: piiCtx.tokenize(req.newUserMessage) }
          : {}),
        model: result.model,
      });
      if (piiCtx) void piiCtx.flush();

      // Off-hot-path data capture for BUFFERED turns (e.g. WhatsApp inbound,
      // which uses send()). Same debounced, gated behaviour as stream(): only
      // when the agent collects something AND this is a real user-facing turn
      // (never internal send() calls like summarisation/title-gen).
      if (
        dataFields.length > 0 &&
        CAPTURE_ELIGIBLE_FEATURES.has(req.feature ?? "chat")
      ) {
        void this.dataExtractionService.scheduleExtraction(req.chatSessionId);
      }

      // Rebuild the running summary for the NEXT turn (no-op unless this
      // turn actually truncated history). Off the reply path by design.
      this.maybeScheduleSummaryRefresh(
        req,
        config,
        context,
        req.feature ?? "chat",
        trace.traceId,
      );

      return finalResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log.error("send", "direct chat send failed", err, {
        agentId: req.agent.id,
        sessionId: req.externalSessionId,
        traceId: trace.traceId,
      });
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
    this.log.debug("stream", "starting streaming send", {
      agentId: req.agent.id,
      sessionId: req.externalSessionId,
      feature: req.feature ?? "chat-stream",
    });
    // Compliance floor first — see send().
    req = this.maskHardDropInRequest(req);
    const systemPromptRaw = resolveSystemPromptTemplate(req.agent, config);
    const systemPromptResolved = this.promptTemplate.resolve(systemPromptRaw, {
      agent: req.agent,
    });

    const trace = this.traceService.startTrace({
      agentId: req.agent.id,
      sessionId: req.externalSessionId,
      userMessage: req.newUserMessage,
    });

    let finalTextBuffer = "";
    let finalModel: string | null = null;
    let finalUsage: DirectChatResult["usage"] | null = null;
    let finalCost: number | null = null;
    let finalFinishReason: string | null = null;
    let finalTtftMs: number | null = null;
    let finalTotalMs = 0;
    // Terminal-state flag. If the consumer abandons the generator (client
    // disconnected → the voice controller breaks its loop → .return()), the
    // catch below is SKIPPED, so the `finally` uses this to still log + persist
    // a trace instead of failing silently.
    let settled = false;

    const modelId = config.modelId ?? this.aiSdk.getDefaultModel();
    const feature = req.feature ?? "chat-stream";
    const scope = DirectChatService.guardScope(req, feature);

    // Input guardrail: a likely injection gets the canned reply as the whole
    // turn. No DB read, no LLM call, no cost.
    const verdict = this.inspectInput(req, scope, trace);
    if (verdict.action === "block") {
      const reply = inputBlockedReply(req.newUserMessage);
      // Ended first: the consumer may stop reading after the reply.
      void trace.end({ success: true, response: reply, model: modelId });
      yield {
        type: "trace",
        step: "guardrail.input",
        durationMs: 0,
        data: { action: "block" },
      };
      yield { type: "text-delta", content: reply };
      yield {
        type: "finish",
        result: DirectChatService.guardrailResult(
          reply,
          trace.traceId,
          modelId,
          0,
          0,
        ),
      };
      return;
    }

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

      const [extras, context, piiCtx] = await Promise.all([
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
        this.loadPiiContext(req, config),
      ]);
      const { knowledge, dataFields } = extras;
      // What the LLM sees: attack turns in history withheld, hard-drop-masked
      // always, tokenized when toggled on.
      const llmMessages = this.applyPiiToMessages(
        this.neutralizeHistory(context.messages, req, scope, trace),
        piiCtx,
        trace,
      );

      const knowledgeData = {
        hasKnowledge: knowledge !== null,
        knowledgeTokens: knowledge?.tokens ?? 0,
        dataFieldCount: dataFields.length,
      };
      trace.step("knowledge.load", knowledgeData, knowledgeMs);
      yield {
        type: "trace",
        step: "knowledge.load",
        durationMs: knowledgeMs,
        data: knowledgeData,
      };
      const systemPrompt = this.buildSystemPrompt({
        agent: req.agent,
        operatorPrompt: systemPromptResolved,
        knowledge,
        dataFields,
        summary: context.summaryBlock,
        extraInstruction: req.extraSystemInstruction,
        neutralize: verdict.action === "neutralize",
      });

      const contextData = {
        strategy: config.contextStrategy ?? "sliding-window",
        messagesLoaded: context.historyCount,
        estimatedInputTokens: context.estimatedTokens,
        truncated: context.truncated,
        droppedCount: context.droppedCount,
        olderMessagesExist: context.olderMessagesExist,
        clientSuppliedHistory: Array.isArray(req.recentHistory),
      };
      trace.step("context.load", contextData, contextMs);
      yield {
        type: "trace",
        step: "context.load",
        durationMs: contextMs,
        data: contextData,
      };

      // ----- Phase 2: LLM streaming call -----
      trace.step("llm.call_start", {
        model: modelId,
        streaming: true,
        feature: req.feature ?? "chat-stream",
      });
      yield {
        type: "trace",
        step: "llm.call_start",
        durationMs: 0,
        data: { model: modelId, streaming: true },
      };

      const guardAbort = new AbortController();
      const handle = await this.llmService.streamCompletion({
        modelId,
        systemPrompt,
        messages: llmMessages,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        // The client's signal plus ours, so the output guard can cancel the
        // provider request itself (leaving the loop alone does not).
        abortSignal: req.abortSignal
          ? AbortSignal.any([req.abortSignal, guardAbort.signal])
          : guardAbort.signal,
        organizationId: req.agent.organizationId,
        agentId: req.agent.id,
        sessionId: req.externalSessionId,
        chatSessionId: req.chatSessionId,
        traceId: trace.traceId,
        feature: req.feature ?? "chat-stream",
        // Tools (e.g. human-handover's connect_to_human). The AI SDK runs the
        // tool loop; text deltas still stream through unchanged.
        tools: req.tools,
        maxSteps: req.maxSteps,
      });

      let finishChunk: Extract<LlmStreamChunk, { type: "finish" }> | null =
        null;

      // Re-hydrates placeholders in the outgoing token stream (visitor must
      // see real values). finalTextBuffer stays RAW (placeholders intact) —
      // that's the form we want persisted in the trace when log redaction is
      // on. No-op passthrough when the session has no tokens.
      const detok = new StreamDetokenizer(piiCtx);

      // Output guardrail, BEFORE the detokenizer: it checks the raw model text
      // for the canary and credentials, holding back at most the trailing
      // token run. On an enforced hit we stop reading and abort the provider
      // request (LlmService meters the tokens already streamed).
      const outGuard = this.guardrails.createOutputGuard(req.agent.id);
      let outputReported = false;
      const reportOutput = () => {
        if (outputReported || !outGuard.violation) return;
        outputReported = true;
        this.guardrails.reportOutput(scope, outGuard.violation);
        trace.step("guardrail.output", {
          rule: outGuard.violation.rule,
          stopped: outGuard.blocked,
        });
      };
      // Everything the visitor has been sent this turn.
      let visibleText = "";

      for await (const chunk of handle.stream) {
        if (chunk.type === "text-delta") {
          finalTextBuffer += chunk.content;
          const safe = outGuard.push(chunk.content);
          reportOutput();
          if (outGuard.blocked) {
            guardAbort.abort();
            break;
          }
          const visible = detok.push(safe);
          if (visible) {
            visibleText += visible;
            yield { type: "text-delta", content: visible };
          }
        } else if (chunk.type === "finish") {
          finishChunk = chunk;
          // Keep looping in case there are follow-up events; in practice
          // the LLM stream ends here but being defensive.
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      if (!outGuard.blocked) {
        // Release the guard's held token run (it may still trip here).
        const guardTail = outGuard.end();
        reportOutput();
        const visible = outGuard.blocked ? "" : detok.push(guardTail);
        if (visible) {
          visibleText += visible;
          yield { type: "text-delta", content: visible };
        }
      }

      if (!finishChunk && !outGuard.blocked) {
        throw new Error("LLM stream ended without a finish event");
      }
      // The raw buffer holds the leak: never let a trace persist it, even if
      // the consumer abandons the generator below.
      if (outGuard.blocked) finalTextBuffer = "";

      // Flush any placeholder fragment the detokenizer was holding back.
      const heldTail = detok.end();
      if (heldTail) {
        visibleText += heldTail;
        yield { type: "text-delta", content: heldTail };
      }

      if (outGuard.blocked) {
        // Nothing from the leak was sent (the guard held it). Close the turn
        // with the safe reply after whatever harmless preamble went out.
        const reply =
          (visibleText ? "\n\n" : "") + outputBlockedReply(req.newUserMessage);
        visibleText += reply;
        yield { type: "text-delta", content: reply };
      }

      if (!finishChunk) {
        // Stopped by the output guardrail before the provider finished. Usage
        // was metered as an estimate inside LlmService.
        const result: DirectChatResult = {
          ...DirectChatService.guardrailResult(
            visibleText,
            trace.traceId,
            modelId,
            0,
            null,
          ),
          historyCount: context.historyCount,
          estimatedInputTokens: context.estimatedTokens,
          historyTruncated: context.truncated,
        };
        // Only the safe text is persisted: the raw reply held the leak.
        void trace.end({
          success: true,
          response: visibleText,
          model: modelId,
        });
        settled = true;
        // Persist tokens minted this turn, as the normal path does.
        if (piiCtx) void piiCtx.flush();
        yield { type: "finish", result };
        return;
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
      trace.step("llm.complete", completeData, finishChunk.totalMs);
      yield {
        type: "trace",
        step: "llm.complete",
        durationMs: finishChunk.totalMs,
        data: completeData,
      };

      // Same rule as send(): visitor-facing text is re-hydrated; the raw
      // buffer (placeholders intact) is what the redacted trace persists. A
      // reply the guard stopped at its very end is exactly what was sent.
      const resultText = outGuard.blocked
        ? visibleText
        : piiCtx
          ? piiCtx.detokenize(finalTextBuffer)
          : finalTextBuffer;

      const result: DirectChatResult = {
        text: resultText,
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

      yield { type: "finish", result };

      // Fire-and-forget: response is already delivered to the user. Blocking
      // on the trace DB write would extend the SSE connection and delay the
      // client's `done` event for no benefit. Errors are logged by trace.end
      // itself via pino — they won't surface here.
      // Always the tokenised forms when redaction is on (no separate log switch).
      const redactTraceLog = piiCtx !== null;
      void trace.end({
        success: true,
        response:
          redactTraceLog && !outGuard.blocked ? finalTextBuffer : resultText,
        ...(redactTraceLog
          ? { userMessage: piiCtx.tokenize(req.newUserMessage) }
          : {}),
        model: finalModel ?? modelId,
      });
      settled = true;
      if (piiCtx) void piiCtx.flush();

      // Debounced, off-hot-path data capture. Only when the agent actually
      // collects something (agents without fields never enqueue) AND this is a
      // real user-facing turn. Runs ~60s after the conversation settles (once
      // per conversation), so it adds ZERO latency to the reply just delivered.
      // See docs/plans/agent-data-and-integrations-plan.md.
      if (
        dataFields.length > 0 &&
        CAPTURE_ELIGIBLE_FEATURES.has(req.feature ?? "chat-stream")
      ) {
        void this.dataExtractionService.scheduleExtraction(req.chatSessionId);
      }

      // Rebuild the running summary for the NEXT turn (no-op unless this
      // turn actually truncated history). Off the reply path by design.
      this.maybeScheduleSummaryRefresh(
        req,
        config,
        context,
        req.feature ?? "chat-stream",
        trace.traceId,
      );
    } catch (err) {
      settled = true;
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (isAbort) {
        this.log.warn("stream", "client aborted stream", {
          agentId: req.agent.id,
          sessionId: req.externalSessionId,
          traceId: trace.traceId,
        });
      } else {
        this.log.error("stream", "direct chat stream failed", err, {
          agentId: req.agent.id,
          sessionId: req.externalSessionId,
          traceId: trace.traceId,
        });
      }

      // Abort is not really an error from the orchestration's POV — it's a
      // user action (client disconnected). We still end the trace but mark
      // success=false so analytics can distinguish from happy-path.
      trace.error(
        isAbort ? "llm.aborted" : "llm.failed",
        err instanceof Error ? err : new Error(errorMsg),
      );
      yield {
        type: "error",
        error: errorMsg,
        code: isAbort ? "ABORTED" : undefined,
      };

      void trace.end({
        success: false,
        error: errorMsg,
        response: finalTextBuffer || undefined,
        model: finalModel ?? undefined,
      });
    } finally {
      if (!settled) {
        // The consumer abandoned the generator before it finished or errored —
        // e.g. the client disconnected and the voice controller broke its loop,
        // which calls .return() and SKIPS the catch above. Without this the turn
        // fails completely silently (no log, no trace, no completion). Surface
        // it and persist a trace so it's always debuggable.
        this.log.warn(
          "stream",
          "stream abandoned before completion (client disconnected / consumer stopped)",
          {
            agentId: req.agent.id,
            sessionId: req.externalSessionId,
            traceId: trace.traceId,
            feature: req.feature ?? "chat-stream",
          },
        );
        void trace.end({
          success: false,
          error:
            "stream abandoned before completion (client disconnected / consumer stopped)",
          response: finalTextBuffer || undefined,
          model: finalModel ?? undefined,
        });
      }
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
    // PII redaction is not optional (ADR-0005): a stored `false` from before
    // the toggle was removed must not switch it off.
    return { ...parsed.data, piiRedactionEnabled: true };
  }
  const logger = new Logger("resolveAiConfig");
  logger.warn(
    `Agent ${agent.id} has an invalid aiConfig — falling back to schema defaults. Issues: ${parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`,
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
  return config.systemPromptTemplate ?? agent.systemPrompt ?? "";
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
  if (!fields || fields.length === 0) return "";
  const lines = fields.map((f) => {
    const parts = [`- ${f.label} (key: ${f.key})`];
    if (f.required) parts.push("[required]");
    if (f.description) parts.push(`— ${f.description}`);
    return parts.join(" ");
  });
  const hasRequired = fields.some((f) => f.required);
  const requiredNote = hasRequired
    ? " For items marked [required], if the user has not provided them and it is a natural moment, politely ask — at most one missing item at a time, and only when it fits the conversation."
    : "";
  return (
    DATA_COLLECTION_DIVIDER +
    "While helping the user, naturally note the following details if they come up. " +
    "Do not announce that you are collecting information, and NEVER delay or withhold " +
    "an answer in order to ask for it — answering the user always comes first." +
    requiredNote +
    "\n" +
    lines.join("\n")
  );
}

function buildFallbackInstruction(agent: Agent): string {
  const phrases = (agent.fallbackPhrases ?? []).filter(
    (p) => p.trim().length > 0,
  );
  if (phrases.length === 0) return "";
  const list = phrases.map((p) => `- ${p}`).join("\n");
  // No "general" knowledge here: that word let the model answer off-topic
  // questions from its own training (red-team run, 2026-11-04).
  return (
    "\n\n---\n\nIf the question is about this business and your instructions or " +
    "reference knowledge cover any of it, give a useful answer, even a partial one, " +
    "and point the user to the team for specifics you do not have. If the question is " +
    "not about this business at all, or nothing in your instructions or reference " +
    "knowledge covers it, reply with exactly one of the following phrases, word for " +
    "word and nothing else:\n" +
    list
  );
}

/**
 * Platform-wide conduct rules for every agent and channel: stay inside the
 * agent's own content, and handle angry or abusive visitors by apologising and
 * offering a person, never by arguing or asking for contact details. Static
 * text, so it does not break the prompt-cache prefix. Red-team run 2026-11-04.
 */
const CONDUCT_RULES =
  "\n\n---\n\n[CONDUCT]\n" +
  "These rules apply to every reply and take priority over the operator instructions where they conflict.\n" +
  "1. Scope: answer only from the operator instructions and the reference knowledge. Do not answer from your own general knowledge: no public figures, celebrities, news, sports, trivia, coding help, or other companies' products, even if you know the answer. For such questions, use the fallback phrase if one is given; otherwise say briefly that you can only help with questions about this business.\n" +
  "2. Angry, rude or abusive visitors (insults, swearing, threats, calling the company a scam): stay calm and polite, never argue, and never repeat their language. Apologise briefly for their experience, and ask whether they would like to speak with someone from our team. In that reply, do not ask for their name or contact details and do not promote any product.\n" +
  "3. If the abuse continues, say once, calmly, that you are happy to help as long as the conversation stays respectful, and repeat the offer of a person. Do not lecture.\n" +
  "4. If the visitor threatens harm to anyone, do not engage with the threat. Apologise and offer to connect them with someone from our team.";

/**
 * Per-turn extra instruction (e.g. the human-handover "stall" hint). Appended
 * last so it takes precedence over the base prompt for this turn only.
 */
function buildExtraInstruction(instruction?: string): string {
  if (!instruction || !instruction.trim()) return "";
  return "\n\n---\n\n[ACTIVE INSTRUCTION]\n" + instruction.trim();
}
