import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APICallError,
  generateText,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type ProviderMetadata,
} from 'ai';

/** Default max agent-loop steps when a request supplies tools (call + reply). */
const DEFAULT_MAX_TOOL_STEPS = 3;

import { AiSdkService, parseModelId } from './ai-sdk.service';

/**
 * AI SDK uses this shape for provider-specific call-time options (Gemini's
 * thinkingConfig, OpenAI's store, etc.) but doesn't re-export the type. We
 * redeclare it here — matches @ai-sdk/provider-utils's ProviderOptions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderOptions = Record<string, Record<string, any>>;
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmStreamHandle,
  LlmTokenUsage,
} from './interfaces/llm.interfaces';

/**
 * Default streaming timeout. If no token arrives within this window the stream
 * is aborted and the caller sees an error. Configurable via
 * `AI_STREAM_TIMEOUT_MS`.
 *
 * Rationale: if OpenRouter or the upstream provider goes silent we don't want
 * client connections hanging forever. 60s is enough for even long RAG-grounded
 * responses on Llama 3.3 70B (which is the slowest model we recommend).
 */
const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

/**
 * LlmService: the single place where generateText() / streamText() from the
 * Vercel AI SDK are called. Every higher-level service (DirectChatService,
 * SummarizationService, RAG contextual chunker) goes through this.
 *
 * Responsibilities:
 *   - Translate our domain-typed LlmCompletionRequest into AI SDK call options
 *   - Normalise the AI SDK's `LanguageModelUsage` (fields may be undefined)
 *     into our always-populated `LlmTokenUsage`
 *   - Extract cost from OpenRouter's providerMetadata when present
 *   - Convert AI SDK errors into NestJS HTTP exceptions with useful codes
 *   - Measure latency (ttftMs for streaming, totalMs for both)
 *
 * Explicitly NOT responsible for (separation of concerns):
 *   - Message history assembly         → ContextAssemblyService (14-5)
 *   - RAG retrieval                    → HybridSearchService (Phase 3)
 *   - Trace emission                   → AiTraceService (callers decorate)
 *   - Circuit breaker / retry policy   → ResilienceService (14-9, wraps us)
 *   - DB persistence of usage records  → UsageTrackingService (14-10)
 *
 * Keeping this service thin makes it unit-testable by mocking AiSdkService
 * (which returns the LanguageModel), and keeps the AI SDK dependency
 * localised so it's easy to swap if Vercel ever makes a breaking change.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly aiSdk: AiSdkService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Non-streaming completion. Use when you need the full response before
   * doing anything with it (summarisation, title generation, evaluation).
   * For user-facing chat, always prefer `streamCompletion()`.
   */
  async generateCompletion(
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    const startedAt = performance.now();
    const modelSettings = buildModelSettings(request);
    const model = this.aiSdk.getModel(request.modelId, modelSettings);
    const providerOptions = buildProviderOptions(request);

    try {
      const result = await generateText({
        model,
        system: request.systemPrompt,
        messages: request.messages,
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        frequencyPenalty: request.frequencyPenalty,
        presencePenalty: request.presencePenalty,
        abortSignal: request.abortSignal,
        ...(providerOptions ? { providerOptions } : {}),
        // Tools: when present, let the AI SDK run the call→execute→reply loop.
        // `stopWhen` caps the loop; omitted entirely for tool-less calls so
        // normal completions keep their single-step behaviour unchanged.
        ...(request.tools
          ? {
              tools: request.tools,
              stopWhen: stepCountIs(request.maxSteps ?? DEFAULT_MAX_TOOL_STEPS),
            }
          : {}),
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      this.logProviderDiagnostics(request.modelId, result.providerMetadata, result.usage);
      return {
        text: result.text,
        usage: normaliseUsage(result.usage, result.providerMetadata),
        cost: extractCost(result.providerMetadata),
        model: extractActualModel(result.providerMetadata, request.modelId),
        finishReason: result.finishReason,
        latencyMs,
        retryCount: 0, // ResilienceService layer will overwrite this if it retried
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * Streaming completion. Returns immediately with an AsyncIterable of chunks
   * and a `completion` promise that resolves when the stream ends with the
   * final usage + cost.
   *
   * Flow:
   *   const handle = await streamCompletion(req);
   *   // Start writing SSE to the client as soon as chunks arrive:
   *   for await (const chunk of handle.stream) {
   *     if (chunk.type === 'text-delta') res.write(sse('chunk', chunk.content));
   *     if (chunk.type === 'finish')     res.write(sse('done', chunk));
   *   }
   *   // Caller can then persist the final result for usage tracking:
   *   const final = await handle.completion;
   *
   * Note: handle.completion resolves AFTER handle.stream ends. Don't await the
   * completion inside the stream loop — you'll deadlock.
   */
  async streamCompletion(
    request: LlmCompletionRequest,
  ): Promise<LlmStreamHandle> {
    const startedAt = performance.now();
    const timeoutMs = this.getStreamTimeout();
    const modelSettings = buildModelSettings(request);
    const model = this.aiSdk.getModel(request.modelId, modelSettings);
    const providerOptions = buildProviderOptions(request);

    // Abort signal that triggers on timeout (no token received within window).
    // We combine the caller's abort signal (client disconnect) with our own
    // timeout signal using AbortSignal.any — whichever fires first cancels.
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(
      () => timeoutController.abort(new Error('AI stream timeout')),
      timeoutMs,
    );
    const combinedSignal = request.abortSignal
      ? AbortSignal.any([request.abortSignal, timeoutController.signal])
      : timeoutController.signal;

    // `streamText` returns synchronously — the actual HTTP request starts lazily
    // when you begin iterating the textStream (or await one of the promises).
    const streamResult = streamText({
      model,
      system: request.systemPrompt,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      topP: request.topP,
      frequencyPenalty: request.frequencyPenalty,
      presencePenalty: request.presencePenalty,
      abortSignal: combinedSignal,
      ...(providerOptions ? { providerOptions } : {}),
      // See generateCompletion above — multi-step loop only when tools exist.
      ...(request.tools
        ? {
            tools: request.tools,
            stopWhen: stepCountIs(request.maxSteps ?? DEFAULT_MAX_TOOL_STEPS),
          }
        : {}),
    });

    // ttftMs = Time To First Token — we capture this by marking the timestamp
    // on the first text-delta we emit. This is the most important UX metric
    // for streaming: "how long until the user sees anything?"
    let firstTokenAt: number | null = null;

    // Resolver pair for the `completion` promise. Resolved inside the async
    // generator below once the stream finishes (or rejected on error).
    let resolveCompletion!: (value: LlmCompletionResult) => void;
    let rejectCompletion!: (err: unknown) => void;
    const completion = new Promise<LlmCompletionResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const requestedModel = request.modelId;
    // Capture a bound reference to wrapError so the generator below doesn't
    // need a `self = this` alias (avoids the eslint no-this-alias warning
    // while still routing errors through the same logging / typing logic).
    const wrapError = (err: unknown) => this.wrapError(err);
    // Same trick for the diagnostics logger — inner generator can't reach
    // `this` without the lint warning, so we hand it a bound logger.
    const diagnosticsLogger = this.logger;

    async function* streamChunks(): AsyncIterable<LlmStreamChunk> {
      try {
        // fullStream (not textStream) so tool activity is observable by the
        // caller — DirectChatService maps tool-call/tool-result parts to the
        // widget's live step indicators. Text behaviour is identical: every
        // text-delta part carries the same tokens textStream would.
        for await (const part of streamResult.fullStream) {
          if (part.type === 'text-delta') {
            if (firstTokenAt === null) {
              firstTokenAt = performance.now();
            }
            if (part.text.length > 0) {
              yield { type: 'text-delta', content: part.text };
            }
          } else if (part.type === 'tool-call') {
            yield {
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            };
          } else if (part.type === 'tool-result') {
            yield {
              type: 'tool-result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            };
          } else if (part.type === 'tool-error') {
            yield {
              type: 'tool-result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              errored: true,
            };
          } else if (part.type === 'error') {
            // Surface stream-level errors through the same wrap/reject path
            // the textStream iteration used to throw through.
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          } else if (part.type === 'abort') {
            // Distinguish OUR timeout from a client disconnect — the fullStream
            // 'abort' part carries no reason, but the signals do. A timeout
            // must surface as a real failure ('llm.failed' in traces, error to
            // the client), not be misfiled as a user-initiated abort.
            if (timeoutController.signal.aborted) {
              throw new Error('AI stream timeout');
            }
            const abortErr = new Error('Stream aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }
          // start/finish/step boundaries, reasoning + tool-input deltas, raw:
          // intentionally not surfaced.
        }

        // Stream drained without errors. Pull final metadata (these promises
        // resolve once the upstream sends the `finish` event).
        const [usage, finishReason, providerMetadata] = await Promise.all([
          streamResult.usage,
          streamResult.finishReason,
          streamResult.providerMetadata,
        ]);

        const totalMs = Math.round(performance.now() - startedAt);
        const ttftMs = firstTokenAt
          ? Math.round(firstTokenAt - startedAt)
          : null;
        logProviderDiagnosticsFree(
          diagnosticsLogger,
          requestedModel,
          providerMetadata,
          usage,
        );
        const normalisedUsage = normaliseUsage(usage, providerMetadata);
        const cost = extractCost(providerMetadata);
        const actualModel = extractActualModel(
          providerMetadata,
          requestedModel,
        );

        yield {
          type: 'finish',
          usage: normalisedUsage,
          cost,
          model: actualModel,
          finishReason,
          ttftMs,
          totalMs,
        };

        // Now resolve the completion promise so the caller can persist usage.
        // We need the full text too, so pull that (already resolved at this point).
        const text = await streamResult.text;
        resolveCompletion({
          text,
          usage: normalisedUsage,
          cost,
          model: actualModel,
          finishReason,
          latencyMs: totalMs,
          retryCount: 0,
        });
      } catch (err) {
        const wrapped = wrapError(err);
        // Emit an error chunk so SSE subscribers see the failure, then reject
        // the completion promise so awaiters unblock.
        yield {
          type: 'error',
          error: wrapped.message,
        };
        rejectCompletion(wrapped);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    return {
      stream: streamChunks(),
      completion,
    };
  }

  /**
   * Instance-method wrapper for the free diagnostic helper. Keeps call sites
   * tidy in `generateCompletion()` where `this` is accessible.
   */
  private logProviderDiagnostics(
    requestedModel: string,
    metadata: ProviderMetadata | undefined,
    usage: LanguageModelUsage,
  ): void {
    logProviderDiagnosticsFree(this.logger, requestedModel, metadata, usage);
  }

  private getStreamTimeout(): number {
    const raw = this.config.get<string>('AI_STREAM_TIMEOUT_MS');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_STREAM_TIMEOUT_MS;
  }

  /**
   * Translate AI SDK errors (which are opaque to our HTTP layer) into typed
   * NestJS exceptions the exception filter can handle consistently.
   *
   * We preserve status code + provider-specific error code when available so
   * the client can distinguish between e.g. "rate limited" and "bad input".
   */
  private wrapError(err: unknown): Error {
    if (err instanceof APICallError) {
      this.logger.warn(
        `LLM API error: status=${err.statusCode ?? 'n/a'} message=${err.message}`,
      );
      // We DO NOT throw a rich NestJS HttpException here because wrapError
      // can be called inside an async generator, where throwing yields a
      // rejection instead of an HTTP response. The caller (LlmService itself
      // or ResilienceService) inspects the error and decides retry policy.
      return err;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return err; // client disconnected or timeout — caller handles specially
    }
    if (err instanceof Error) {
      this.logger.error(`Unexpected LLM error: ${err.message}`, err.stack);
      return err;
    }
    return new InternalServerErrorException(
      'Unknown error from LLM service: ' + String(err),
    );
  }
}

// ============================================================================
// Helpers — kept as free functions so they're trivially testable.
// ============================================================================

/**
 * Build the `settings` object passed to `openrouter.chat(modelId, settings)`.
 *
 * OpenRouter-specific behaviour we bake in here:
 *   - Fallback routing is configured at MODEL-CREATION time, not per-call.
 *     Include the primary model as the first element so OpenRouter treats it
 *     as "try primary, then cascade". Passing this via AI SDK call-time
 *     `providerOptions` silently drops the field (verified against
 *     @openrouter/ai-sdk-provider v2.8.0 source).
 *   - OpenRouter's API caps the combined `models` array at 3 items. We trim
 *     defensively here so misconfigured agents can't ever send more than the
 *     hard limit (instead of getting an opaque 400 from OpenRouter). The
 *     validation schema also caps fallbackModels at 2, but this is belt-and-
 *     suspenders: a manually-set aiConfig JSONB or future schema change won't
 *     accidentally break chat.
 */
const OPENROUTER_MAX_MODELS = 3;

function buildModelSettings(
  request: LlmCompletionRequest,
): { models?: string[] } | undefined {
  if (!request.fallbackModels?.length) return undefined;
  const combined = [request.modelId, ...request.fallbackModels];
  const trimmed = combined.slice(0, OPENROUTER_MAX_MODELS);
  return { models: trimmed };
}

/**
 * Provider-specific request options that affect latency / output shape.
 *
 * GEMINI: 2.5 Flash / Pro ship with "thinking" enabled by default, which adds
 * 1-2s of TTFT on straightforward Q&A tasks (chatbot answers, summarisation)
 * for no quality gain. We disable it for every gemini:* call — if we later
 * add reasoning-heavy agents (math, coding) we can gate this on an
 * `aiConfig.reasoning` flag instead.
 *   - `thinkingBudget: 0` disables thinking on 2.5 Flash. On 2.5 Pro it's
 *     ignored (Pro requires >=128) — setting 0 there is a no-op, not an error.
 *   - 2.5 Flash-Lite already has thinking disabled by default; setting 0 is
 *     redundant but harmless.
 *   - OpenRouter-routed google/gemini-* models go through OpenRouter's
 *     provider and do NOT honour @ai-sdk/google's providerOptions — they
 *     must be configured via OpenRouter's extra-body. We skip them here.
 *
 * OPENAI: `promptCacheKey` forces routing stickiness so the same agent's
 * requests land on the same OpenAI backend, giving reliable prompt-cache
 * hits. Without this, OpenAI's automatic caching is best-effort and misses
 * frequently even with a stable system prompt — cached_tokens comes back 0.
 * The per-agent key scopes cache reuse correctly: agent A's hits won't
 * contaminate agent B's routing.
 *   - Requires @ai-sdk/openai >= 3.0.x (the fix for vercel/ai#7908 that was
 *     merged as #7964 which added the parameter passthrough). Confirmed
 *     present in our 3.0.53.
 *   - Max 64 chars. Agent UUIDs (36 chars) fit comfortably.
 *
 * `promptCacheRetention: '24h'` extends the cache TTL from the default 5-10
 * min (in_memory) to up to 24 hours, with the K/V tensors offloaded to
 * GPU-local storage. Critical for low-traffic widgets: without this, a visitor
 * who shows up 30 min after the last user pays the full cold-start tax on
 * their first message (~1500-2500ms LLM TTFT). With 24h retention, even the
 * day's first visitor hits a warm cache (~700-900ms TTFT).
 *   - Supported on gpt-4.1, gpt-4.1-mini, gpt-5*, and all future OpenAI
 *     models. Earlier models silently ignore unknown fields.
 *   - Pricing: cached tokens are still billed at the 50% cached discount.
 *     No extra cost for the 24h retention itself.
 *
 * GROQ: Qwen3 family ships with reasoning ON by default, which emits a
 * `<think>...</think>` chain-of-thought block in the response stream. For
 * chatbot use cases this both bloats TTFT (model spends 1-3s reasoning
 * before user-visible tokens) AND leaks the raw thoughts into the message
 * the user sees. We disable reasoning by default for Qwen3 via Groq's
 * `reasoning_effort: 'none'` — if we later add reasoning-heavy agents
 * (math, coding) we can gate this on an `aiConfig.reasoning` flag the same
 * way we'd gate Gemini's thinkingBudget.
 *   - Other reasoning models on Groq (DeepSeek-R1-Distill, GPT-OSS) emit
 *     reasoning via separate channels per their model cards, not in the
 *     text content, so they don't need this. Scoped to Qwen3 explicitly.
 */
function buildProviderOptions(
  request: LlmCompletionRequest,
): ProviderOptions | undefined {
  const parsed = parseModelId(request.modelId);

  if (parsed.provider === 'gemini') {
    return {
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
        },
      },
    };
  }

  if (parsed.provider === 'openai') {
    return {
      openai: {
        promptCacheKey: `agent-${request.agentId}`,
        promptCacheRetention: '24h',
      },
    };
  }

  if (parsed.provider === 'groq' && /^qwen[/-]/i.test(parsed.modelName)) {
    return {
      groq: {
        reasoningEffort: 'none',
      },
    };
  }

  return undefined;
}

/**
 * Normalise the AI SDK's `LanguageModelUsage` into our domain type where
 * every core field is guaranteed to be a number (AI SDK returns `undefined`
 * when the upstream provider omits a field, which is rare but real).
 *
 * We also surface cached + reasoning token counts in a flat shape so the
 * cost-tracking layer can distinguish cached vs non-cached tokens for
 * accurate billing. The cached-token extraction reads from multiple provider
 * metadata paths because AI SDK v6 doesn't normalise Anthropic/Gemini/OpenAI
 * cache hits into the same field — extractCachedTokens() does the fallback.
 */
function normaliseUsage(
  usage: LanguageModelUsage,
  providerMetadata?: ProviderMetadata,
): LlmTokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens:
      usage.totalTokens ??
      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    cachedInputTokens: extractCachedTokens(usage, providerMetadata),
    reasoningTokens:
      usage.outputTokenDetails?.reasoningTokens ??
      usage.reasoningTokens ??
      undefined,
  };
}

/**
 * Log a structured diagnostic line summarising what the provider actually
 * returned in its metadata. Primary purpose: figure out whether OpenAI /
 * Gemini automatic prompt caching is firing (and if so, where AI SDK is
 * surfacing the count). Grep `LLM_DIAGNOSTICS` in logs to see hit rates.
 *
 * Only logs once per LLM call. Noisy at scale, so gate via env var before
 * enabling in production — today this is dev-only.
 */
function logProviderDiagnosticsFree(
  logger: Logger,
  requestedModel: string,
  metadata: ProviderMetadata | undefined,
  usage: LanguageModelUsage,
): void {
  const openai = metadata?.openai as Record<string, unknown> | undefined;
  const google = metadata?.google as Record<string, unknown> | undefined;
  const openrouter = metadata?.openrouter as Record<string, unknown> | undefined;

  // A compact summary that keeps the interesting fields + redacts noise.
  const summary = {
    model: requestedModel,
    usage: {
      input: usage.inputTokens,
      output: usage.outputTokens,
      total: usage.totalTokens,
      sdkCacheRead: usage.inputTokenDetails?.cacheReadTokens,
      sdkCachedInput: usage.cachedInputTokens,
      sdkReasoning:
        usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
    },
    openai: openai
      ? {
          cachedPromptTokens: openai.cachedPromptTokens,
          usage: openai.usage,
        }
      : undefined,
    google: google
      ? {
          cachedContentTokenCount: google.cachedContentTokenCount,
          usageMetadata: google.usageMetadata,
        }
      : undefined,
    openrouter: openrouter ? { usage: openrouter.usage } : undefined,
  };

  // Verified: extractCachedTokens() correctly surfaces sdkCacheRead /
  // sdkCachedInput for OpenAI 24h-retention cache hits. Trace's
  // cachedInputTokens field is reliable. Leaving at .debug() so prod is quiet
  // but devs can flip log level to see hit rates if cache health regresses.
  logger.debug(`LLM_DIAGNOSTICS ${JSON.stringify(summary)}`);
}

/**
 * Extract cached input token count from whichever provider-specific metadata
 * path carries it. AI SDK v6 normalises this UNEVENLY across providers:
 *
 *   - Anthropic: `usage.inputTokenDetails.cacheReadTokens` (well-supported)
 *   - OpenAI:    `providerMetadata.openai.cachedPromptTokens` (legacy field)
 *                OR `providerMetadata.openai.usage.prompt_tokens_details.cached_tokens`
 *                   (raw OpenAI passthrough — current standard shape)
 *                OR `providerMetadata.openai.promptTokensDetails.cachedTokens`
 *                   (camelCase variant some AI SDK versions emit)
 *   - Google:    `providerMetadata.google.cachedContentTokenCount`
 *   - OpenRouter: varies by upstream model
 *
 * We try each path; whichever is a number wins. Missing on every path → return
 * undefined so downstream code / trace can distinguish "not populated" from
 * "zero (cache definitively missed)".
 *
 * NB: With `prompt_cache_retention: '24h'`, OpenAI still reports cache hits via
 * the same `prompt_tokens_details.cached_tokens` field — the storage tier is
 * different (GPU-local KV offload) but the response shape is unchanged.
 */
function extractCachedTokens(
  usage: LanguageModelUsage,
  metadata: ProviderMetadata | undefined,
): number | undefined {
  // 1. AI SDK normalised shape (primary source when available).
  const normalised =
    usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens;
  if (typeof normalised === 'number') return normalised;

  if (!metadata) return undefined;

  // 2. OpenAI providerMetadata — multiple possible shapes depending on AI SDK
  // version and whether the call went through chat.completions vs responses
  // endpoint vs how the AI SDK normalises camelCase/snake_case.
  const openai = metadata.openai as
    | {
        cachedPromptTokens?: number;
        promptTokensDetails?: { cachedTokens?: number; cached_tokens?: number };
        prompt_tokens_details?: { cached_tokens?: number; cachedTokens?: number };
        usage?: {
          prompt_tokens_details?: { cached_tokens?: number; cachedTokens?: number };
          promptTokensDetails?: { cachedTokens?: number; cached_tokens?: number };
          cachedPromptTokens?: number;
        };
      }
    | undefined;
  if (typeof openai?.cachedPromptTokens === 'number') {
    return openai.cachedPromptTokens;
  }
  // camelCase top-level (AI SDK v6 normalisation in some paths)
  const camelTop =
    openai?.promptTokensDetails?.cachedTokens ??
    openai?.promptTokensDetails?.cached_tokens;
  if (typeof camelTop === 'number') return camelTop;
  // snake_case top-level (raw OpenAI passthrough)
  const snakeTop =
    openai?.prompt_tokens_details?.cached_tokens ??
    openai?.prompt_tokens_details?.cachedTokens;
  if (typeof snakeTop === 'number') return snakeTop;
  // nested under usage (older AI SDK shape)
  const nestedSnake =
    openai?.usage?.prompt_tokens_details?.cached_tokens ??
    openai?.usage?.prompt_tokens_details?.cachedTokens;
  if (typeof nestedSnake === 'number') return nestedSnake;
  const nestedCamel =
    openai?.usage?.promptTokensDetails?.cachedTokens ??
    openai?.usage?.promptTokensDetails?.cached_tokens;
  if (typeof nestedCamel === 'number') return nestedCamel;
  if (typeof openai?.usage?.cachedPromptTokens === 'number') {
    return openai.usage.cachedPromptTokens;
  }

  // 3. Google Gemini providerMetadata — implicit + explicit context caching.
  const google = metadata.google as
    | { cachedContentTokenCount?: number }
    | undefined;
  if (typeof google?.cachedContentTokenCount === 'number') {
    return google.cachedContentTokenCount;
  }

  return undefined;
}

/**
 * OpenRouter returns the USD cost of each call in its response metadata. The
 * exact key path depends on how `@openrouter/ai-sdk-provider` forwards it.
 * Current shape (as of v2.8.0):
 *   providerMetadata.openrouter.usage.cost (USD as number)
 *
 * We guard against it being missing (non-OpenRouter providers, edge cases)
 * and return null rather than 0 so downstream analytics can distinguish
 * "we didn't get cost info" from "it was free".
 */
function extractCost(metadata: ProviderMetadata | undefined): number | null {
  if (!metadata) return null;
  const openrouter = metadata.openrouter as
    | { usage?: { cost?: number } }
    | undefined;
  const cost = openrouter?.usage?.cost;
  return typeof cost === 'number' ? cost : null;
}

/**
 * When OpenRouter uses a fallback model (primary errored), the response
 * metadata includes the model that actually served the request. If we can't
 * determine it, fall back to the requested model ID.
 *
 * This matters for cost tracking: fallback models may be priced very
 * differently from the primary (e.g. falling back from gpt-4o to gpt-4o-mini
 * is 10x cheaper — the usage record should reflect what actually ran).
 */
function extractActualModel(
  metadata: ProviderMetadata | undefined,
  requestedModel: string,
): string {
  if (!metadata) return requestedModel;
  const openrouter = metadata.openrouter as { model?: string } | undefined;
  return openrouter?.model ?? requestedModel;
}
