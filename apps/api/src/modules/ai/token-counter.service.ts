import { Injectable } from '@nestjs/common';
import { encodingForModel, getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ModelMessage } from 'ai';

import { AppLogger } from '../../common/logger/app-logger';

/**
 * TokenCounterService: count tokens in strings and conversation message arrays.
 *
 * We use `js-tiktoken` (pure-JS port of OpenAI's tiktoken) rather than the
 * native `tiktoken` package because:
 *   - No native build step / platform-specific binaries (Windows dev happy)
 *   - 2-3x slower in raw throughput, but we're counting at most 100K chars
 *     per request — the difference is <5ms
 *   - Zero external runtime deps
 *
 * Accuracy notes:
 *   - tiktoken's `cl100k_base` encoding matches GPT-3.5 / GPT-4 family exactly
 *   - For Anthropic/Claude: ~5% over-estimate (close enough for budgeting)
 *   - For Llama/Mistral/Gemini: ~10-15% over-estimate (BPE variants differ)
 *   - For billing-critical workloads, trust the provider's response.usage
 *     instead — this service is for BUDGETING input context before sending
 *
 * Overhead per message: we add 4 tokens for OpenAI-style chat format framing
 * (role + separators). This matches OpenAI's published guidance for counting
 * chat messages. For other providers it's approximate.
 */

/** Tokens added by chat-format framing (role, separators) per message. */
const CHAT_MESSAGE_OVERHEAD = 4;
/** Default encoding — cl100k_base covers GPT-3.5/4 family. */
const DEFAULT_ENCODING = 'cl100k_base';

@Injectable()
export class TokenCounterService {
  private readonly log = new AppLogger(TokenCounterService.name);
  /**
   * Encoder instances are expensive to initialise (load BPE tables into
   * memory). Cache by encoding name and reuse across calls.
   */
  private readonly encoderCache = new Map<string, Tiktoken>();

  /**
   * Count tokens in a raw string for the given model.
   *
   * @param text   The text to tokenise.
   * @param model  Optional model ID (e.g. 'gpt-4o', 'openai/gpt-4o-mini').
   *               Prefixed IDs are normalised. If the model isn't recognised,
   *               falls back to cl100k_base with a one-time warning.
   */
  countTokens(text: string, model?: string): number {
    if (!text) return 0;
    const encoder = this.getEncoder(model);
    return encoder.encode(text).length;
  }

  /**
   * Count tokens in an AI SDK `ModelMessage[]` including per-message framing
   * overhead. Use this when budgeting conversation context.
   *
   * Returns the sum across: message content tokens + `CHAT_MESSAGE_OVERHEAD`
   * per message. Non-text content parts (tool results, images) contribute
   * their text representation where available; image parts count as 0 (use
   * provider-specific image-token rules if you need them).
   */
  countMessages(messages: ModelMessage[], model?: string): number {
    const encoder = this.getEncoder(model);
    let total = 0;
    for (const msg of messages) {
      total += CHAT_MESSAGE_OVERHEAD;
      total += this.messageContentTokens(msg, encoder);
    }
    return total;
  }

  /**
   * Combined count for a system prompt + messages array — the typical shape
   * of an LLM call. System prompt is counted as its own message (with framing).
   */
  countPromptContext(
    systemPrompt: string,
    messages: ModelMessage[],
    model?: string,
  ): number {
    const encoder = this.getEncoder(model);
    let total = 0;
    if (systemPrompt) {
      total += CHAT_MESSAGE_OVERHEAD + encoder.encode(systemPrompt).length;
    }
    for (const msg of messages) {
      total += CHAT_MESSAGE_OVERHEAD;
      total += this.messageContentTokens(msg, encoder);
    }
    return total;
  }

  private messageContentTokens(msg: ModelMessage, encoder: Tiktoken): number {
    const content = msg.content;
    if (typeof content === 'string') {
      return encoder.encode(content).length;
    }
    if (Array.isArray(content)) {
      let sum = 0;
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if ('text' in part && typeof part.text === 'string') {
          sum += encoder.encode(part.text).length;
        }
        // image / file / tool parts: ignored here. Provider-specific counting
        // rules would need dedicated handling.
      }
      return sum;
    }
    return 0;
  }

  /**
   * Resolve the encoder for a given model, with caching.
   *
   * `encodingForModel` only handles OpenAI model names. For other providers
   * (anthropic, groq, google, openrouter with prefixes), we strip the prefix
   * and try the model name; if still unknown, fall back to cl100k_base which
   * is a reasonable approximation for most BPE-based tokenizers.
   */
  private getEncoder(model?: string): Tiktoken {
    const cacheKey = model ?? DEFAULT_ENCODING;
    const cached = this.encoderCache.get(cacheKey);
    if (cached) return cached;

    let encoder: Tiktoken | null = null;
    if (model) {
      // Strip provider prefix: 'openai/gpt-4o-mini' → 'gpt-4o-mini', 'groq:llama...' stays
      const normalised = model.includes('/')
        ? model.split('/').slice(1).join('/')
        : model.includes(':')
          ? model.split(':').slice(1).join(':')
          : model;
      try {
        // encodingForModel throws on unknown models — guard with try/catch.
        encoder = encodingForModel(normalised as Parameters<typeof encodingForModel>[0]);
      } catch {
        // Fall through to default
      }
    }

    if (!encoder) {
      encoder = getEncoding(DEFAULT_ENCODING);
      if (model) {
        // Log once per unknown model to avoid warning spam
        this.log.debug(
          'getEncoder',
          `No exact tokenizer for model "${model}" — falling back to ${DEFAULT_ENCODING} (~10-15% over-estimate for non-OpenAI models)`,
        );
      }
    }

    this.encoderCache.set(cacheKey, encoder);
    return encoder;
  }
}
