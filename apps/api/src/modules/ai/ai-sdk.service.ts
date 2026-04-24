import {
  Injectable,
  Logger,
  ServiceUnavailableException,
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
export type AiProvider = 'openrouter' | 'groq' | 'openai' | 'gemini' | 'sarvam';

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
export class AiSdkService implements OnModuleInit {
  private readonly logger = new Logger(AiSdkService.name);

  private openrouter: OpenRouterProvider | null = null;
  private groq: GroqProvider | null = null;
  private openai: OpenAIProvider | null = null;
  private google: GoogleGenerativeAIProvider | null = null;
  private sarvam: OpenAICompatibleProvider | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Pre-warm the keep-alive TCP pool to each configured provider at boot.
   *
   * Without this, the first user request of a process lifecycle pays the full
   * cold-connection tax to the provider's origin: DNS + TCP handshake + TLS
   * negotiation ≈ 300-1500ms depending on region. On a long-haul link (India
   * → OpenAI us-east via undici) we've measured cold spikes in the 10+s range,
   * whereas subsequent requests reuse the pooled connection in ~100ms.
   *
   * By firing a cheap GET to each provider's public models listing at module
   * init, we pay that tax ONCE during process boot (invisible to users) and
   * the first user chat lands on an already-warm socket.
   *
   * Fire-and-forget + Promise.allSettled: if a provider is down or the key is
   * bad, we log and carry on. Pre-warm failure must NEVER block the process
   * from starting.
   */
  onModuleInit(): void {
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

    if (warmups.length === 0) {
      this.logger.warn('No AI providers configured — skipping connection pre-warm.');
      return;
    }

    void Promise.allSettled(
      warmups.map(async ({ name, url }) => {
        const t0 = performance.now();
        try {
          await keepAliveFetch(url, { method: 'GET' });
          this.logger.log(
            `Pre-warmed ${name} connection in ${Math.round(performance.now() - t0)}ms (${url})`,
          );
        } catch (err) {
          // 401/403 is fine — the TLS handshake + pool entry still happened.
          // Only log if the network itself failed.
          this.logger.warn(
            `Pre-warm of ${name} failed (${url}): ${err instanceof Error ? err.message : String(err)}. First user request will pay the cold-start tax.`,
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
        this.config.get<string>('SARVAM_API_KEY'),
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
    }
  }

  getDefaultModel(): string {
    return (
      this.config.get<string>('DEFAULT_AI_MODEL') ?? 'anthropic/claude-sonnet-4'
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
}
