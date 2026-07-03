import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from '@ai-sdk/google';
import { createGroq, type GroqProvider } from '@ai-sdk/groq';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import {
  createOpenRouter,
  type OpenRouterProvider,
} from '@openrouter/ai-sdk-provider';
import type { EmbeddingModel, LanguageModel } from 'ai';

import { keepAliveFetch } from './keepalive-fetch';

/**
 * Supported AI providers. Each has its own API key, latency profile, and
 * pricing. Agents pick a provider indirectly via their `modelId` prefix (see
 * parseModelId) so adding a new provider is additive — no existing agent config
 * changes.
 */
export type AiProvider = 'openrouter' | 'groq' | 'openai' | 'gemini' | 'sarvam' | 'cerebras';

interface ParsedModelId {
  provider: AiProvider;
  /** The model name as the provider's SDK expects it (no prefix). */
  modelName: string;
  /** The original full model ID as the caller passed it — kept for logging. */
  original: string;
}

/**
 * Model ID prefix convention:
 *
 *   'groq:llama-3.3-70b-versatile'    → Groq direct
 *   'openai:gpt-4o-mini'              → OpenAI direct
 *   'gemini:gemini-2.5-flash'         → Google AI Studio direct
 *   'sarvam:sarvam-30b'               → Sarvam AI (India-hosted, Indic-native)
 *   'openrouter:anthropic/claude-4'   → OpenRouter (explicit)
 *   'anthropic/claude-4'              → OpenRouter (default, no prefix = backward-compat)
 *
 * Why colon for direct, slash for OpenRouter?
 *   - OpenRouter's native IDs use `vendor/model` with a slash, so `openai/gpt-4o`
 *     must keep meaning "via OpenRouter" to avoid breaking existing agents.
 *   - Colon is a URI-scheme convention ("this:that") that naturally reads as
 *     "use this provider for that model".
 *
 * Case-insensitive on the prefix; the model name is forwarded verbatim
 * (some providers are case-sensitive).
 */
export function parseModelId(modelId: string): ParsedModelId {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('groq:')) {
    return { provider: 'groq', modelName: trimmed.slice(5), original: trimmed };
  }
  if (lower.startsWith('openai:')) {
    return {
      provider: 'openai',
      modelName: trimmed.slice(7),
      original: trimmed,
    };
  }
  if (lower.startsWith('gemini:')) {
    return {
      provider: 'gemini',
      modelName: trimmed.slice(7),
      original: trimmed,
    };
  }
  if (lower.startsWith('sarvam:')) {
    return {
      provider: 'sarvam',
      modelName: trimmed.slice(7),
      original: trimmed,
    };
  }
  if (lower.startsWith('cerebras:')) {
    return {
      provider: 'cerebras',
      modelName: trimmed.slice(9),
      original: trimmed,
    };
  }
  if (lower.startsWith('openrouter:')) {
    return {
      provider: 'openrouter',
      modelName: trimmed.slice(11),
      original: trimmed,
    };
  }
  return { provider: 'openrouter', modelName: trimmed, original: trimmed };
}

/**
 * Thin facade over the AI SDK provider ecosystem. Routes to whichever provider
 * matches the requested model ID's prefix, lazy-initialising each provider on
 * first use so agents that never touch Groq don't force us to require a
 * GROQ_API_KEY at boot.
 *
 * One provider per instance per process — providers hold their own HTTP
 * connection pools internally, we don't want to re-create them on every call.
 */
@Injectable()
export class AiSdkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiSdkService.name);

  private openrouter: OpenRouterProvider | null = null;
  private groq: GroqProvider | null = null;
  private openai: OpenAIProvider | null = null;
  private google: GoogleGenerativeAIProvider | null = null;
  private sarvam: OpenAICompatibleProvider | null = null;
  private cerebras: OpenAICompatibleProvider | null = null;

  /** Default heartbeat interval. Tuned to undici's default keep-alive timeout
   *  of ~30s — refreshing every 25s ensures the socket never goes idle long
   *  enough to be closed by either side. */
  private static readonly DEFAULT_HEARTBEAT_MS = 25_000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Pre-warm + heartbeat the keep-alive TCP pool to each configured provider.
   *
   * THE COLD-START PROBLEM:
   * Without warm sockets, the first user request of a process lifecycle pays
   * the full cold-connection tax to the provider's origin: DNS + TCP handshake
   * + TLS negotiation ≈ 300-1500ms depending on region. On a long-haul link
   * (India → OpenAI us-east via undici) we've measured cold spikes in the
   * 10+s range, whereas subsequent requests reuse the pooled connection in
   * ~100ms.
   *
   * Two-part fix:
   *   1. ONE-SHOT PREWARM at module init pays the handshake cost during boot
   *      (invisible to users) so the first user chat lands on an already-warm
   *      socket.
   *   2. PERIODIC HEARTBEAT every 25s keeps the socket alive forever. Undici's
   *      default keep-alive timeout is ~30s, so a 25s heartbeat ensures the
   *      socket never goes idle long enough to be closed. Without this, a 30s
   *      lull between user messages re-pays the cold-start tax — measured in
   *      practice as a 3076ms TTFT spike on gpt-4.1 (vs ~1.5s warm).
   *
   * Cost of the heartbeat: 5-6 lightweight HTTPS GETs every 25s = ~12k req/h
   * per provider, which is trivial against any provider's rate limits and adds
   * zero per-token billing (these are unauth/models endpoint calls, not LLM
   * calls).
   *
   * Set `AI_KEEPALIVE_HEARTBEAT_MS=0` to disable the heartbeat (initial prewarm
   * always runs). Set a custom number to override the 25000ms default.
   *
   * Fire-and-forget + Promise.allSettled throughout: if a provider is down or
   * the key is bad, we log and carry on. Pre-warm/heartbeat failure must NEVER
   * block the process from starting.
   */
  onModuleInit(): void {
    const warmups = this.buildWarmupTargets();
    if (warmups.length === 0) {
      this.logger.warn('No AI providers configured — skipping connection pre-warm.');
      return;
    }

    // Initial pre-warm. Log each result so operators see which providers
    // resolved at boot.
    void this.pingWarmupTargets(warmups, { logSuccess: true });

    const heartbeatMs = this.resolveHeartbeatMs();
    if (heartbeatMs > 0) {
      this.heartbeatInterval = setInterval(() => {
        void this.pingWarmupTargets(warmups, { logSuccess: false });
      }, heartbeatMs);
      // Don't keep the event loop alive just for the heartbeat — let the
      // process exit cleanly during shutdown without us forcing a holding pin.
      this.heartbeatInterval.unref?.();
      this.logger.log(
        `Keep-alive heartbeat scheduled every ${heartbeatMs}ms across ${warmups.length} provider(s).`,
      );
    } else {
      this.logger.log(
        'Keep-alive heartbeat disabled via AI_KEEPALIVE_HEARTBEAT_MS=0 — first request after idle may pay cold-start tax.',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private resolveHeartbeatMs(): number {
    const raw = this.config.get<string | number>('AI_KEEPALIVE_HEARTBEAT_MS');
    if (raw === undefined || raw === null || raw === '') {
      return AiSdkService.DEFAULT_HEARTBEAT_MS;
    }
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `Invalid AI_KEEPALIVE_HEARTBEAT_MS=${String(raw)} — falling back to default ${AiSdkService.DEFAULT_HEARTBEAT_MS}ms.`,
      );
      return AiSdkService.DEFAULT_HEARTBEAT_MS;
    }
    return Math.floor(parsed);
  }

  private buildWarmupTargets(): Array<{ name: AiProvider; url: string }> {
    const warmups: Array<{ name: AiProvider; url: string }> = [];

    if (this.isProviderConfigured('openai')) {
      warmups.push({ name: 'openai', url: 'https://api.openai.com/v1/models' });
    }
    if (this.isProviderConfigured('gemini')) {
      // Gemini models list is auth-free at the root; hitting it still opens
      // the same TLS session AI SDK will reuse for generateContent calls.
      warmups.push({
        name: 'gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
      });
    }
    if (this.isProviderConfigured('groq')) {
      warmups.push({ name: 'groq', url: 'https://api.groq.com/openai/v1/models' });
    }
    if (this.isProviderConfigured('openrouter')) {
      warmups.push({ name: 'openrouter', url: 'https://openrouter.ai/api/v1/models' });
    }
    if (this.isProviderConfigured('sarvam')) {
      // Sarvam's models list is a simple GET that accepts the auth header;
      // pinging it warms the TLS pool to api.sarvam.ai for real chat calls.
      warmups.push({ name: 'sarvam', url: 'https://api.sarvam.ai/v1/models' });
    }
    if (this.isProviderConfigured('cerebras')) {
      // Cerebras Cloud is OpenAI-compatible at api.cerebras.ai. /v1/models is
      // a cheap GET that pre-opens the TLS pool used by chat completions.
      warmups.push({ name: 'cerebras', url: 'https://api.cerebras.ai/v1/models' });
    }

    return warmups;
  }

  private async pingWarmupTargets(
    warmups: Array<{ name: AiProvider; url: string }>,
    opts: { logSuccess: boolean },
  ): Promise<void> {
    await Promise.allSettled(
      warmups.map(async ({ name, url }) => {
        const t0 = performance.now();
        try {
          await keepAliveFetch(url, { method: 'GET' });
          if (opts.logSuccess) {
            this.logger.log(
              `Pre-warmed ${name} connection in ${Math.round(performance.now() - t0)}ms (${url})`,
            );
          }
        } catch (err) {
          // 401/403 is fine — the TLS handshake + pool entry still happened.
          // Only log if the network itself failed.
          // Heartbeat failures matter (they'll cost cold-start latency on next
          // chat) so we log them at warn level regardless of opts.logSuccess.
          this.logger.warn(
            `${opts.logSuccess ? 'Pre-warm' : 'Heartbeat'} of ${name} failed (${url}): ${err instanceof Error ? err.message : String(err)}.`,
          );
        }
      }),
    );
  }

  /**
   * True if AT LEAST ONE provider is configured. Callers (e.g. migration
   * endpoint) should validate per-provider via `isProviderConfigured()`.
   */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('OPENROUTER_API_KEY') ||
        this.config.get<string>('GROQ_API_KEY') ||
        this.config.get<string>('OPENAI_API_KEY') ||
        this.config.get<string>('GOOGLE_API_KEY') ||
        this.config.get<string>('SARVAM_API_KEY') ||
        this.config.get<string>('CEREBRAS_API_KEY'),
    );
  }

  isProviderConfigured(provider: AiProvider): boolean {
    switch (provider) {
      case 'openrouter':
        return Boolean(this.config.get<string>('OPENROUTER_API_KEY'));
      case 'groq':
        return Boolean(this.config.get<string>('GROQ_API_KEY'));
      case 'openai':
        return Boolean(this.config.get<string>('OPENAI_API_KEY'));
      case 'gemini':
        return Boolean(this.config.get<string>('GOOGLE_API_KEY'));
      case 'sarvam':
        return Boolean(this.config.get<string>('SARVAM_API_KEY'));
      case 'cerebras':
        return Boolean(this.config.get<string>('CEREBRAS_API_KEY'));
    }
  }

  getDefaultModel(): string {
    // Fallback when DEFAULT_AI_MODEL is unset. gpt-4.1-mini: cheap, fast, and
    // reliable tool calling (we don't run Claude). Override via env per deploy.
    return (
      this.config.get<string>('DEFAULT_AI_MODEL') ?? 'openai/gpt-4.1-mini'
    );
  }

  /**
   * Return an AI SDK LanguageModel routed to the correct provider.
   *
   * @param modelId  Full model ID, possibly prefixed. See parseModelId().
   * @param settings Provider-specific model-level settings. Currently only
   *                  OpenRouter honours `models: [...]` (native fallback
   *                  routing). Other providers ignore it.
   *
   * @throws ServiceUnavailableException if the resolved provider isn't configured.
   */
  getModel(
    modelId: string,
    settings?: { models?: string[] },
  ): LanguageModel {
    const parsed = parseModelId(modelId);
    switch (parsed.provider) {
      case 'groq':
        return this.getGroqProvider()(parsed.modelName);
      case 'openai':
        return this.getOpenAIProvider()(parsed.modelName);
      case 'gemini':
        return this.getGoogleProvider()(parsed.modelName);
      case 'sarvam':
        return this.getSarvamProvider()(parsed.modelName);
      case 'cerebras':
        return this.getCerebrasProvider()(parsed.modelName);
      case 'openrouter':
        return this.getOpenRouterProvider().chat(parsed.modelName, settings);
    }
  }

  /**
   * Return an AI SDK EmbeddingModel. Groq doesn't offer embeddings, so
   * `groq:*` IDs aren't valid here. Default to OpenAI for bare model names.
   */
  getEmbeddingModel(modelId: string): EmbeddingModel {
    const parsed = parseModelId(modelId);
    switch (parsed.provider) {
      case 'openrouter':
        return this.getOpenRouterProvider().textEmbeddingModel(
          parsed.modelName,
        );
      case 'openai':
        return this.getOpenAIProvider().textEmbeddingModel(parsed.modelName);
      case 'gemini':
        return this.getGoogleProvider().textEmbeddingModel(parsed.modelName);
      case 'groq':
        throw new ServiceUnavailableException({
          code: 'PROVIDER_NO_EMBEDDINGS',
          message:
            'Groq does not offer embedding models. Use an OpenAI, Google, or OpenRouter embedding model.',
        });
      case 'sarvam':
        throw new ServiceUnavailableException({
          code: 'PROVIDER_NO_EMBEDDINGS',
          message:
            'Sarvam does not currently expose embedding models via the chat API. Use an OpenAI, Google, or OpenRouter embedding model.',
        });
      case 'cerebras':
        throw new ServiceUnavailableException({
          code: 'PROVIDER_NO_EMBEDDINGS',
          message:
            'Cerebras does not offer embedding models. Use an OpenAI, Google, or OpenRouter embedding model.',
        });
    }
  }

  // ==========================================================================
  // Provider lazy initialisers. Each throws a ServiceUnavailableException with
  // a provider-specific code so the error message tells the operator exactly
  // which env var is missing.
  // ==========================================================================

  private getOpenRouterProvider(): OpenRouterProvider {
    if (this.openrouter) return this.openrouter;

    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'OPENROUTER_NOT_CONFIGURED',
        message:
          'OpenRouter is not configured. Set OPENROUTER_API_KEY to use OpenRouter-routed models.',
      });
    }

    const referer =
      this.config.get<string>('OPENROUTER_REFERER') ??
      this.config.get<string>('DASHBOARD_URL') ??
      'https://codeweaves.com';

    this.openrouter = createOpenRouter({
      apiKey,
      fetch: keepAliveFetch,
      headers: {
        'HTTP-Referer': referer,
        'X-Title': 'CodeWeaves Platform',
      },
    });

    this.logger.log(
      `OpenRouter provider initialised (referer=${referer}, default=${this.getDefaultModel()})`,
    );
    return this.openrouter;
  }

  private getGroqProvider(): GroqProvider {
    if (this.groq) return this.groq;

    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'GROQ_NOT_CONFIGURED',
        message:
          'Groq is not configured. Set GROQ_API_KEY to use groq:* models. Get one at https://console.groq.com/keys',
      });
    }

    this.groq = createGroq({ apiKey, fetch: keepAliveFetch });
    this.logger.log('Groq provider initialised');
    return this.groq;
  }

  private getOpenAIProvider(): OpenAIProvider {
    if (this.openai) return this.openai;

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'OPENAI_NOT_CONFIGURED',
        message:
          'OpenAI is not configured. Set OPENAI_API_KEY to use openai:* (direct) models.',
      });
    }

    // Optional: organisation for billing attribution.
    const organization = this.config.get<string>('OPENAI_ORGANIZATION');

    this.openai = createOpenAI({
      apiKey,
      fetch: keepAliveFetch,
      ...(organization ? { organization } : {}),
    });
    this.logger.log(
      `OpenAI provider initialised${organization ? ` (org=${organization})` : ''}`,
    );
    return this.openai;
  }

  private getGoogleProvider(): GoogleGenerativeAIProvider {
    if (this.google) return this.google;

    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message:
          'Google Gemini is not configured. Set GOOGLE_API_KEY to use gemini:* (direct) models. Get one at https://aistudio.google.com/apikey',
      });
    }

    this.google = createGoogleGenerativeAI({ apiKey, fetch: keepAliveFetch });
    this.logger.log('Google Gemini provider initialised');
    return this.google;
  }

  /**
   * Sarvam AI — India-hosted Indic-native LLMs. OpenAI-compatible chat API
   * (POST /v1/chat/completions with standard messages/stream fields) so we use
   * `@ai-sdk/openai-compatible` rather than maintaining a custom provider.
   *
   * Why this is a first-class provider and not routed through OpenRouter:
   *   - Billing isolation: Sarvam has its own credits, we want usage tracked
   *     separately (their free tier is generous, worth preserving).
   *   - Geographic benefit: api.sarvam.ai is hosted in India. Calling them
   *     through OpenRouter would route via OpenRouter's origin (likely US/EU),
   *     erasing the whole reason to use Sarvam.
   *   - Indic language support: we may want per-agent routing rules that
   *     prefer Sarvam for Hindi/Marathi/etc. conversations down the line;
   *     having it as its own provider makes that clean.
   */
  private getSarvamProvider(): OpenAICompatibleProvider {
    if (this.sarvam) return this.sarvam;

    const apiKey = this.config.get<string>('SARVAM_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'SARVAM_NOT_CONFIGURED',
        message:
          'Sarvam AI is not configured. Set SARVAM_API_KEY to use sarvam:* models. Get one at https://dashboard.sarvam.ai/',
      });
    }

    this.sarvam = createOpenAICompatible({
      name: 'sarvam',
      baseURL: 'https://api.sarvam.ai/v1',
      apiKey,
      fetch: keepAliveFetch,
    });
    this.logger.log('Sarvam AI provider initialised');
    return this.sarvam;
  }

  /**
   * Cerebras Cloud — wafer-scale-chip inference. Headline feature is raw
   * throughput: gpt-oss-120b runs at ~3000 tok/s, zai-glm-4.7 at ~1000 tok/s
   * (vs typical 100-300 tok/s elsewhere). For chat UX this masks transpacific
   * latency — even with 200ms RTT to US, the bot finishes a 200-token reply
   * in under a second of generation time.
   *
   * OpenAI-compatible chat-completions surface at api.cerebras.ai/v1 with
   * standard Bearer auth, so `@ai-sdk/openai-compatible` works without any
   * custom adapter.
   *
   * Public/free-tier model lineup (as of May 2026): `gpt-oss-120b`,
   * `zai-glm-4.7`. Qwen and Llama families are dedicated-endpoint only —
   * use Groq's `qwen-3-32b` if you need Qwen on a free public tier.
   */
  private getCerebrasProvider(): OpenAICompatibleProvider {
    if (this.cerebras) return this.cerebras;

    const apiKey = this.config.get<string>('CEREBRAS_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'CEREBRAS_NOT_CONFIGURED',
        message:
          'Cerebras is not configured. Set CEREBRAS_API_KEY to use cerebras:* models. Get one at https://cloud.cerebras.ai',
      });
    }

    this.cerebras = createOpenAICompatible({
      name: 'cerebras',
      baseURL: 'https://api.cerebras.ai/v1',
      apiKey,
      fetch: keepAliveFetch,
    });
    this.logger.log('Cerebras provider initialised');
    return this.cerebras;
  }
}
