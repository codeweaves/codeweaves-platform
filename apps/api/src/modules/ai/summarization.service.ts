import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage } from 'ai';

import type { LlmFeature } from './interfaces/llm.interfaces';
import { LlmService } from './llm.service';

/**
 * Default summarisation model. Chosen for: fast, free, decent quality at
 * compression tasks. Groq Llama 3.3 70B returns first token in ~300ms, which
 * keeps the overall chat latency acceptable when summarisation runs inline.
 *
 * Override per call via params.model, or globally via SUMMARIZATION_MODEL env.
 */
const DEFAULT_SUMMARIZATION_MODEL = 'groq:llama-3.3-70b-versatile';
const DEFAULT_MAX_SUMMARY_TOKENS = 300;

const SUMMARISATION_SYSTEM_PROMPT = `You are a conversation summariser. Produce a concise, factual summary of the prior exchange between a user and an AI assistant.

Rules:
- Output 2-5 short sentences. No preamble, no headers, no bullet points.
- Preserve concrete facts: names, dates, numbers, decisions made, user preferences, action items, and any information the assistant committed to remembering.
- Drop pleasantries, small talk, and reasoning about reasoning.
- Write in third person, present tense ("The user asked about X. The assistant confirmed Y.").
- Never invent details that aren't in the messages.
- If the conversation has no substantive content yet, say exactly: "No substantive conversation yet."`;

export interface SummarizeParams {
  /** Messages to summarise, in chronological order. */
  messages: ModelMessage[];

  /** Used to tag the usage record for cost attribution. */
  organizationId: string;
  agentId: string;
  sessionId?: string;
  traceId?: string;

  /** Optional override. Defaults to env SUMMARIZATION_MODEL or the constant. */
  model?: string;
  /** Max output tokens for the summary. Defaults to 300 (~2-5 sentences). */
  maxTokens?: number;
}

export interface SummarizeResult {
  summary: string;
  tokensUsed: number;
  cost: number | null;
  model: string;
  latencyMs: number;
}

/**
 * SummarizationService: compress a conversation fragment into a short
 * factual summary suitable for injection into a system prompt.
 *
 * Typical use (via Hybrid context strategy — Story 15-4):
 *   - Conversation has 30+ messages, token budget can't fit them all
 *   - Pick the OLDEST messages that won't fit → pass them here
 *   - Get a 2-5 sentence summary → inject into system prompt as context
 *   - Keep the NEWEST messages verbatim → natural recent-turn context
 *
 * Why a separate service (not inlined in context assembly)?
 *   - Testable independently (mock LLM, verify prompt compliance)
 *   - Multiple callers (hybrid strategy, title generation, eval) share logic
 *   - Clear cost attribution: summarisation calls tagged `feature: 'summarization'`
 *
 * Not responsible for:
 *   - Caching summaries (future: Redis-by-message-id-hash — Story 15-7)
 *   - Persisting summaries to ChatSession.summary column (caller's job)
 *   - Deciding WHEN to summarise (HybridContextStrategy's job)
 */
@Injectable()
export class SummarizationService {
  private readonly logger = new Logger(SummarizationService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Summarise a list of messages. Returns an empty summary if `messages` is
   * empty (not an error — simplifies callers in the hybrid strategy).
   */
  async summarize(params: SummarizeParams): Promise<SummarizeResult> {
    if (params.messages.length === 0) {
      return {
        summary: '',
        tokensUsed: 0,
        cost: null,
        model: params.model ?? this.defaultModel(),
        latencyMs: 0,
      };
    }

    const model = params.model ?? this.defaultModel();
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_SUMMARY_TOKENS;

    // Serialise messages into a single prompt input. We hand them as a
    // conversation transcript rather than a messages[] array so the
    // summariser sees them as historical data to compress, not a live chat
    // it should continue. This prevents the model from "replying to" the last
    // message or trying to continue the conversation.
    const transcript = params.messages
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) =>
                  typeof p === 'object' && p && 'text' in p && typeof p.text === 'string'
                    ? p.text
                    : '',
                )
                .join(' ')
            : '';
        return `${role}: ${content}`;
      })
      .join('\n\n');

    const userMessage: ModelMessage = {
      role: 'user',
      content: `Summarise the following conversation:\n\n${transcript}`,
    };

    const result = await this.llmService.generateCompletion({
      modelId: model,
      systemPrompt: SUMMARISATION_SYSTEM_PROMPT,
      messages: [userMessage],
      temperature: 0.2, // low — we want factual compression, not creativity
      maxTokens,
      organizationId: params.organizationId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      traceId: params.traceId,
      feature: 'summarization' satisfies LlmFeature,
    });

    const summary = result.text.trim();
    this.logger.debug(
      `Summarised ${params.messages.length} messages → ${summary.length} chars (${result.usage.outputTokens} tokens, ${result.latencyMs}ms)`,
    );

    return {
      summary,
      tokensUsed: result.usage.totalTokens,
      cost: result.cost,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }

  /**
   * Generate a short (5-8 word) conversation title from the first few
   * exchanges. Designed for conversation-list UIs, analytics, and admin
   * views. Fire-and-forget friendly — never throws (returns fallback title).
   *
   * Trigger heuristic: call after the 2nd assistant reply when session.title
   * is still null. DirectChatService invokes this as a background task
   * without awaiting.
   */
  async generateTitle(params: {
    messages: ModelMessage[];
    organizationId: string;
    agentId: string;
    sessionId?: string;
    traceId?: string;
  }): Promise<string> {
    if (params.messages.length === 0) return 'New Conversation';

    // Only need the first 2-4 turns to nail the topic
    const relevantMessages = params.messages.slice(0, 4);
    const transcript = relevantMessages
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = typeof m.content === 'string' ? m.content : '';
        // Cap each message at 500 chars — we don't need the full text to
        // generate a good title, and shorter prompt = lower cost + latency.
        return `${role}: ${content.slice(0, 500)}`;
      })
      .join('\n');

    try {
      const result = await this.llmService.generateCompletion({
        modelId: this.defaultModel(),
        systemPrompt:
          'You generate short, specific titles for conversations. Output ONLY the title — no quotes, no preamble, no punctuation at the end. Maximum 8 words. Focus on the topic, not generic phrases like "User asks about".',
        messages: [
          {
            role: 'user',
            content: `Generate a 5-8 word title for this conversation:\n\n${transcript}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 32, // Plenty for 8 words
        organizationId: params.organizationId,
        agentId: params.agentId,
        sessionId: params.sessionId,
        traceId: params.traceId,
        feature: 'title-generation' satisfies LlmFeature,
      });
      // Clean up: strip quotes, trailing punctuation, hard-cap length.
      return (
        result.text
          .trim()
          .replace(/^["'"`]|["'"`]$/g, '')
          .replace(/[.!?]+$/, '')
          .slice(0, 200) || 'New Conversation'
      );
    } catch (err) {
      this.logger.warn(
        `Title generation failed for session ${params.sessionId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      return 'New Conversation';
    }
  }

  private defaultModel(): string {
    return (
      this.config.get<string>('SUMMARIZATION_MODEL') ??
      DEFAULT_SUMMARIZATION_MODEL
    );
  }
}
