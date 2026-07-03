import { Injectable, Logger } from '@nestjs/common';
import type { MessageRole } from '@prisma/client';
import type { ModelMessage } from 'ai';

import { PrismaService } from '../../services/prisma.service';

import type {
  AssembleContextParams,
  AssembledContext,
} from './interfaces/context.interfaces';

/** Hard cap on message rows loaded from DB, regardless of agent config. */
const MAX_HISTORY_HARD_CAP = 100;

/** Default token budget when the caller doesn't specify. */
const DEFAULT_MAX_INPUT_TOKENS = 8000;

/**
 * Inline label prefixed to a human teammate's replies in the model context.
 * Both a human agent's and the bot's turns ride the AI-SDK 'assistant' role, so
 * this is how the model tells "a human wrote this" from "I wrote this". Keep in
 * sync with the widget's recentHistory builder (apps/widget useChat.ts).
 */
const HUMAN_AGENT_LABEL = '[Human teammate]: ';

/**
 * Inline label for handover status lines (SYSTEM rows: "a teammate took over",
 * "resolved — AI resumed", "auto-resolved (inactive)", …) so the model reads
 * them as automated events, not the assistant's own words. This is the handover
 * narrative — connected → what the human did → handed back. Keep in sync with
 * the widget's recentHistory builder (apps/widget useChat.ts).
 */
const SYSTEM_LABEL = '[System]: ';

/**
 * Floor on how many recent messages we keep even if the token budget would
 * force dropping them. Prevents pathological long-message scenarios (e.g. a
 * user pasting 10K tokens of code) from stripping conversation context down
 * to zero — we always include at least the last user message and ideally the
 * preceding assistant turn for continuity.
 */
const MIN_MESSAGES_TO_KEEP = 2;

/**
 * ContextAssemblyService: load the last N messages of a chat session from the
 * database, format them for the AI SDK, fit them into a token budget, and
 * append the new user turn.
 *
 * This is the service that REPLACES n8n's `memoryBufferWindow`. Instead of
 * n8n remembering conversations behind the scenes, we reconstruct from our
 * own persistent ChatMessage records on every call. Upsides:
 *
 *   - Memory survives restarts (Postgres is source of truth)
 *   - Conversations auditable / exportable / analytic-ready
 *   - RAG context layers in via systemPrompt append (Phase 3)
 *   - LLM sees exactly what analytics sees
 *
 * Phase 2 (Story 15-2) strategy: "sliding window with token budget".
 *   - Load up to `maxContextMessages` newest messages (hard ceiling)
 *   - Count tokens using the actual model's tokenizer
 *   - If total exceeds `maxInputTokens`, drop oldest messages until it fits
 *   - Always keep at least MIN_MESSAGES_TO_KEEP recent turns, even if a single
 *     message dwarfs the budget (callers can handle over-budget via Phase 2
 *     summarisation strategy if desired)
 *
 * Not responsible for:
 *   - Resolving the system prompt template (PromptTemplateService — 15-5)
 *   - Summarising dropped messages (SummarizationService / HybridStrategy — 15-3/15-4)
 *   - Injecting RAG retrieval results (HybridSearchService — Phase 3)
 *   - Emitting trace steps (the orchestrator wraps this in trace.measure)
 */
@Injectable()
export class ContextAssemblyService {
  private readonly logger = new Logger(ContextAssemblyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assemble(params: AssembleContextParams): Promise<AssembledContext> {
    const messageCap = Math.min(
      Math.max(params.maxContextMessages ?? 20, 1),
      MAX_HISTORY_HARD_CAP,
    );
    const tokenBudget = params.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;

    // Hot-path optimisation: when the caller supplies recentHistory (e.g. the
    // frontend's in-memory chat state), skip the DB lookup. Saves one Supabase
    // round-trip per call — typically 150-400ms depending on region.
    //
    // Trade-off: we lose the authoritative `olderMessagesExist` signal. Fine
    // for sliding-window (doesn't use it) and the hybrid strategy already
    // handles "unknown" gracefully. Analytics / audit still read from our own
    // persisted ChatMessage rows, so this never skips persistence — only the
    // read.
    let fullHistory: ModelMessage[];
    let olderMessagesExist = false;
    let loadedCount = 0;

    if (Array.isArray(params.recentHistory)) {
      fullHistory = params.recentHistory.slice(-messageCap).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      loadedCount = fullHistory.length;
    } else {
      // Query `desc` + LIMIT lets Postgres use the (chatSessionId, createdAt)
      // index to short-circuit. Select only the columns we need — ChatMessage.metadata
      // is a fat JSONB we don't want to drag across the wire for every chat turn.
      //
      // HUMAN_AGENT (a teammate's replies) and SYSTEM (handover status lines)
      // are both included and LABELLED (see labelHistoryContent) so the model
      // reads the full handover narrative — who joined, what they said, and when
      // the chat was handed back — without mistaking any of it for its own words.
      const recent = await this.prisma.chatMessage.findMany({
        where: { chatSessionId: params.chatSessionId },
        orderBy: { createdAt: 'desc' },
        take: messageCap,
        select: { role: true, content: true },
      });

      if (recent.length === messageCap) {
        const totalCount = await this.prisma.chatMessage.count({
          where: { chatSessionId: params.chatSessionId },
        });
        olderMessagesExist = totalCount > messageCap;
      }

      const chronological = recent.reverse();
      fullHistory = chronological.map((m) => ({
        role: roleToAiSdk(m.role),
        content: labelHistoryContent(m.role, m.content),
      }));
      loadedCount = chronological.length;
    }

    // Build the NEW user turn (never dropped — it's why the call is happening).
    const newTurn: ModelMessage | null =
      params.newUserMessage.length > 0
        ? { role: 'user', content: params.newUserMessage }
        : null;

    // --- PERFORMANCE PATH ---
    // Previously this method tokenised the FULL system prompt (up to ~20K
    // tokens when an agent has knowledge attached) THREE times per call:
    // once for `fixedTokens`, once per message in the fit loop (via
    // countMessages which re-encodes all content), and once for the final
    // `estimatedTokens`. Pure-JS tiktoken at 11K tokens ≈ 300-500ms each →
    // context assembly was eating ~1.5s. All that work to produce a single
    // integer.
    //
    // New approach:
    //   1. Use CHEAP char-based estimates for every budget-fit decision (10%
    //      margin is fine for dropping oldest messages — Prisma's ChatMessage
    //      content is typically short chat turns, char/4 is accurate enough).
    //   2. If a caller supplies `systemPromptTokens` (precomputed — e.g.
    //      AgentKnowledge.contentTokens + a tiny systemPrompt), we use that
    //      directly instead of re-encoding.
    //   3. Only do ONE real tiktoken pass at the end, on the message list
    //      only (the system prompt's token count is either supplied or
    //      estimated cheaply). The "estimatedTokens" in the trace remains
    //      meaningful for monitoring.
    const systemPromptTokens = charEstimate(params.systemPrompt);
    const newTurnTokens = newTurn ? charEstimate(asText(newTurn.content)) + CHAT_FRAMING_OVERHEAD : 0;
    const fixedTokens = systemPromptTokens + newTurnTokens;
    const historyBudget = Math.max(tokenBudget - fixedTokens, 0);

    // Fit history into the remaining budget using cheap estimates. ~10-15%
    // approximation is fine — the authoritative count comes from the LLM's
    // response.usage after generation.
    const kept: ModelMessage[] = [];
    let keptTokens = 0;
    let tokenDropped = 0;
    for (let i = fullHistory.length - 1; i >= 0; i--) {
      const msg = fullHistory[i]!;
      const msgTokens = charEstimate(asText(msg.content)) + CHAT_FRAMING_OVERHEAD;
      if (
        keptTokens + msgTokens <= historyBudget ||
        // Even if over budget, keep at least MIN_MESSAGES_TO_KEEP most recent
        // so the agent has some conversational context to work with.
        kept.length < MIN_MESSAGES_TO_KEEP
      ) {
        kept.unshift(msg);
        keptTokens += msgTokens;
      } else {
        tokenDropped++;
      }
    }

    // Assemble final message array: kept history + new user turn.
    const messages = [...kept];
    if (newTurn) messages.push(newTurn);

    const totalDropped =
      (olderMessagesExist ? loadedCount : 0) + tokenDropped;
    const truncated =
      tokenDropped > 0 || (olderMessagesExist && loadedCount > 0);

    // estimatedTokens is ONLY used for trace/monitoring. Originally we ran
    // tiktoken over the full message list here — ~50-200ms of CPU on a hot
    // path for a number the LLM itself returns authoritatively in
    // response.usage. Char estimate is within ~15%, good enough for a trace
    // field. The real count lives on the finish event.
    const estimatedTokens =
      systemPromptTokens +
      messages.reduce(
        (sum, m) => sum + charEstimate(asText(m.content)) + CHAT_FRAMING_OVERHEAD,
        0,
      );

    return {
      systemPrompt: params.systemPrompt,
      messages,
      historyCount: kept.length,
      estimatedTokens,
      truncated,
      droppedCount: totalDropped,
      olderMessagesExist,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Chat-format framing overhead per message (role tag + separators). Matches
 *  OpenAI's published guidance; close enough for other providers. */
const CHAT_FRAMING_OVERHEAD = 4;

/** Chars-per-token heuristic for English prose. Within ~10-15% of real for
 *  most content; safe upper bound for sliding-window budget decisions since
 *  slight overestimation → we drop a message we could have kept, not the
 *  other way around. */
const CHARS_PER_TOKEN = 4;

/**
 * Map a stored message role to an AI SDK role. USER → user; everything else
 * (ASSISTANT + HUMAN_AGENT + SYSTEM) → assistant. A human teammate's reply and
 * the handover status lines belong to the non-user side; they're labelled by
 * {@link labelHistoryContent} so the model can still tell them apart.
 */
function roleToAiSdk(role: MessageRole): 'user' | 'assistant' {
  return role === 'USER' ? 'user' : 'assistant';
}

/**
 * Prefix HUMAN_AGENT / SYSTEM turns with a label so the model can distinguish a
 * human teammate's reply and automated handover status lines from its own turns
 * (all three ride the 'assistant' role). USER / ASSISTANT pass through unchanged.
 */
function labelHistoryContent(role: MessageRole, content: string): string {
  if (role === 'HUMAN_AGENT') return `${HUMAN_AGENT_LABEL}${content}`;
  if (role === 'SYSTEM') return `${SYSTEM_LABEL}${content}`;
  return content;
}

/** Extract text length from a message content that may be string | Array. */
function asText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let buf = '';
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof (part as { text: unknown }).text === 'string'
      ) {
        buf += (part as { text: string }).text;
      }
    }
    return buf;
  }
  return '';
}

/** Fast char-based token estimate. O(1), no tokenizer loaded. */
function charEstimate(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
