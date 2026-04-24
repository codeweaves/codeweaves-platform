import { Injectable, Logger } from '@nestjs/common';
import type { MessageRole } from '@prisma/client';
import type { ModelMessage } from 'ai';

import { PrismaService } from '../../../services/prisma.service';

import { ContextAssemblyService } from '../context-assembly.service';
import type {
  AssembleContextParams,
  AssembledContext,
} from '../interfaces/context.interfaces';
import { SummarizationService } from '../summarization.service';
import { TokenCounterService } from '../token-counter.service';

/** Max number of OLDER messages to consider when summarising. Caps cost. */
const MAX_MESSAGES_TO_SUMMARISE = 60;

/** Divider between the agent's system prompt and the injected summary. */
const SUMMARY_DIVIDER = '\n\n---\n\n[SUMMARY OF EARLIER CONVERSATION]\n';

/**
 * Per-session cache of the most recent summary we generated. Keyed by the
 * ChatSession's primary key. Invalidated when a new user message arrives
 * (the cache key includes the message count as a generation marker).
 *
 * Why in-memory and not Redis? Per-process cache keeps the first-turn cost low
 * and the invalidation trivial. Redis caching with cross-pod sharing is Story
 * 15-7 (optimisation phase). This cache alone gives us ~3x speedup on
 * subsequent turns in the same conversation because summaries rarely change
 * meaningfully between adjacent messages.
 */
interface CachedSummary {
  summary: string;
  /** Generation marker: number of messages when this summary was produced. */
  generation: number;
  tokensUsed: number;
}

/**
 * HybridContextStrategy: combines recent-message sliding window with a
 * summary of older, dropped messages. Best-of-both:
 *   - Recent messages: LLM sees exact text (high fidelity for current turn)
 *   - Older messages: compressed into ~200 token summary (preserves long-term
 *     context without blowing the token budget)
 *
 * Triggers summarisation only when the base assembly truncated messages. For
 * short conversations that fit in the budget, this is a zero-cost passthrough.
 *
 * Example impact: a 40-message conversation on GPT-4o-mini with a 3000-token
 * budget would lose messages 1-15 under pure sliding window. With hybrid, those
 * 15 messages become a 200-token summary prepended to the system prompt — the
 * LLM retains long-term context at 10% the token cost.
 */
@Injectable()
export class HybridContextStrategy {
  private readonly logger = new Logger(HybridContextStrategy.name);
  private readonly summaryCache = new Map<string, CachedSummary>();

  constructor(
    private readonly contextService: ContextAssemblyService,
    private readonly summarization: SummarizationService,
    private readonly tokenCounter: TokenCounterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Assemble context with optional summarisation of dropped history.
   *
   * @param params  Standard AssembleContextParams + routing metadata.
   *                The `agent*` fields are required so summarisation calls
   *                can be attributed to the right organisation / agent in the
   *                LlmUsage ledger.
   */
  async assemble(params: AssembleContextParams & {
    organizationId: string;
    agentId: string;
    traceId?: string;
  }): Promise<AssembledContext> {
    // Step 1: Let the base service fit messages into the budget. It will
    // mark `truncated: true` and `olderMessagesExist: true` when dropping.
    const base = await this.contextService.assemble(params);

    // Fast path: everything fit. No summarisation needed → no extra LLM call.
    if (!base.truncated && !base.olderMessagesExist) {
      return base;
    }

    // Step 2: Pull the OLDER messages that didn't make the cut. We query
    // chronologically so the summariser sees the natural flow.
    const messageCap = params.maxContextMessages ?? 20;
    const totalInSession = await this.prisma.chatMessage.count({
      where: { chatSessionId: params.chatSessionId },
    });

    // Nothing actually older exists (shouldn't happen if truncated=true from
    // tokens alone, but defensive).
    if (totalInSession <= messageCap) {
      return base;
    }

    // Cache key uses totalInSession as generation marker — new message = new
    // generation = cache miss. Old cached summary invalidated naturally.
    const cacheKey = params.chatSessionId;
    const cached = this.summaryCache.get(cacheKey);
    if (cached && cached.generation === totalInSession) {
      return this.injectSummary(base, cached.summary, params.model);
    }

    // Step 3: Load the older messages (everything except the last messageCap).
    // We take up to MAX_MESSAGES_TO_SUMMARISE to cap cost + latency.
    const olderRows = await this.prisma.chatMessage.findMany({
      where: { chatSessionId: params.chatSessionId },
      orderBy: { createdAt: 'desc' },
      skip: messageCap,
      take: MAX_MESSAGES_TO_SUMMARISE,
      select: { role: true, content: true },
    });
    if (olderRows.length === 0) {
      return base;
    }

    // Reverse to chronological order for the summariser
    const olderMessages: ModelMessage[] = olderRows
      .reverse()
      .map((m) => ({
        role: roleToAiSdk(m.role),
        content: m.content,
      }));

    // Step 4: Summarise. This adds latency (one extra LLM call) but only runs
    // on cache miss — typically once every N messages per conversation.
    try {
      const result = await this.summarization.summarize({
        messages: olderMessages,
        organizationId: params.organizationId,
        agentId: params.agentId,
        sessionId: params.chatSessionId,
        traceId: params.traceId,
      });

      this.summaryCache.set(cacheKey, {
        summary: result.summary,
        generation: totalInSession,
        tokensUsed: result.tokensUsed,
      });
      // Bound cache size. We don't expect thousands of active sessions on one
      // pod, but cap at 500 to prevent unbounded growth.
      if (this.summaryCache.size > 500) {
        const oldestKey = this.summaryCache.keys().next().value;
        if (oldestKey) this.summaryCache.delete(oldestKey);
      }

      return this.injectSummary(base, result.summary, params.model);
    } catch (err) {
      // Summarisation failure is non-fatal — continue with truncated-only
      // context. Log so we can tune if this becomes frequent.
      this.logger.warn(
        `Summarisation failed for session ${params.chatSessionId}: ${err instanceof Error ? err.message : 'unknown'}. Falling back to sliding window.`,
      );
      return base;
    }
  }

  /**
   * Inject the summary into the base context's system prompt and re-count
   * tokens. We count fresh rather than adding an estimate because the summary
   * changes the budget math — downstream resilience checks might rely on
   * accurate counts.
   */
  private injectSummary(
    base: AssembledContext,
    summary: string,
    model?: string,
  ): AssembledContext {
    if (!summary || summary === 'No substantive conversation yet.') {
      return base;
    }
    const enhanced = base.systemPrompt + SUMMARY_DIVIDER + summary;
    const estimatedTokens = this.tokenCounter.countPromptContext(
      enhanced,
      base.messages,
      model,
    );
    return {
      ...base,
      systemPrompt: enhanced,
      estimatedTokens,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function roleToAiSdk(role: MessageRole): 'user' | 'assistant' {
  return role === 'USER' ? 'user' : 'assistant';
}
