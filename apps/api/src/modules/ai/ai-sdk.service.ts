import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppLogger } from "../../common/logger/app-logger";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";

import { keepAliveFetch } from "./keepalive-fetch";

/**
 * Supported AI providers (ADR-0011). Each has its own API key, latency profile,
 * and pricing. Agents pick a provider via their `modelId` prefix (see
 * parseModelId), so adding a provider is additive.
 */
export type AiProvider = "openai" | "gemini" | "sarvam";

const PROVIDER_PREFIXES: readonly AiProvider[] = ["openai", "gemini", "sarvam"];

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
 *   'openai:gpt-4.1-mini'       → OpenAI direct
 *   'gemini:gemini-2.5-flash'   → Google AI Studio direct
 *   'sarvam:sarvam-105b'        → Sarvam AI (India-hosted, Indic-native)
 *
 * Case-insensitive on the prefix; the model name is forwarded verbatim
 * (some providers are case-sensitive). Any other prefix, or none, is rejected:
 * the validation schema stops it at write time, and migration
 * 20261010000000_llm_provider_set moved every stored agent off removed ones.
 */
export function parseModelId(modelId: string): ParsedModelId {
  const trimmed = modelId.trim();
  const colon = trimmed.indexOf(":");
  const prefix = trimmed.slice(0, colon).toLowerCase();
  const provider = PROVIDER_PREFIXES.find((p) => p === prefix);
  if (colon <= 0 || !provider) {
    throw new ServiceUnavailableException({
      code: "UNSUPPORTED_MODEL_PROVIDER",
      message: `Model "${trimmed}" has no supported provider prefix. Use openai:, gemini: or sarvam:.`,
    });
  }
  return { provider, modelName: trimmed.slice(colon + 1), original: trimmed };
}

/**
 * Thin facade over the AI SDK provider ecosystem. Routes to whichever provider
 * matches the requested model ID's prefix, lazy-initialising each provider on
 * first use so a deploy without, say, SARVAM_API_KEY still boots.
 *
 * One provider per instance per process — providers hold their own HTTP
 * connection pools internally, we don't want to re-create them on every call.
 */
@Injectable()
export class AiSdkService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new AppLogger(AiSdkService.name);

  private openai: OpenAIProvider | null = null;
  private google: GoogleGenerativeAIProvider | null = null;
  private sarvam: OpenAICompatibleProvider | null = null;

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
    this.assertConfiguredModelIds();
    const warmups = this.buildWarmupTargets();
    if (warmups.length === 0) {
      this.log.warn(
        "onModuleInit",
        "No AI providers configured — skipping connection pre-warm.",
      );
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
      this.log.info(
        "onModuleInit",
        `Keep-alive heartbeat scheduled every ${heartbeatMs}ms across ${warmups.length} provider(s).`,
      );
    } else {
      this.log.info(
        "onModuleInit",
        "Keep-alive heartbeat disabled via AI_KEEPALIVE_HEARTBEAT_MS=0 — first request after idle may pay cold-start tax.",
      );
    }
  }

  /**
   * Fail the boot, not the first chat, on a model id from env that no longer
   * parses (e.g. a leftover `groq:` or bare OpenRouter id, ADR-0011). A failed
   * deploy is visible and the previous release keeps serving; a bad default
   * would instead fail every chat and summary until someone noticed.
   */
  private assertConfiguredModelIds(): void {
    const fromEnv: Array<[string, string | undefined]> = [
      ["DEFAULT_AI_MODEL", this.config.get<string>("DEFAULT_AI_MODEL")],
      ["SUMMARIZATION_MODEL", this.config.get<string>("SUMMARIZATION_MODEL")],
    ];
    for (const [name, value] of fromEnv) {
      if (!value) continue;
      try {
        parseModelId(value);
      } catch {
        throw new Error(
          `${name}="${value}" is not a supported model id. Use an openai:, gemini: or sarvam: model (ADR-0011).`,
        );
      }
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private resolveHeartbeatMs(): number {
    const raw = this.config.get<string | number>("AI_KEEPALIVE_HEARTBEAT_MS");
    if (raw === undefined || raw === null || raw === "") {
      return AiSdkService.DEFAULT_HEARTBEAT_MS;
    }
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.log.warn(
        "resolveHeartbeatMs",
        `Invalid AI_KEEPALIVE_HEARTBEAT_MS=${String(raw)} — falling back to default ${AiSdkService.DEFAULT_HEARTBEAT_MS}ms.`,
      );
      return AiSdkService.DEFAULT_HEARTBEAT_MS;
    }
    return Math.floor(parsed);
  }

  private buildWarmupTargets(): Array<{ name: AiProvider; url: string }> {
    const warmups: Array<{ name: AiProvider; url: string }> = [];

    if (this.isProviderConfigured("openai")) {
      warmups.push({ name: "openai", url: "https://api.openai.com/v1/models" });
    }
    if (this.isProviderConfigured("gemini")) {
      // Gemini models list is auth-free at the root; hitting it still opens
      // the same TLS session AI SDK will reuse for generateContent calls.
      warmups.push({
        name: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/models",
      });
    }
    if (this.isProviderConfigured("sarvam")) {
      // Sarvam's models list is a simple GET that accepts the auth header;
      // pinging it warms the TLS pool to api.sarvam.ai for real chat calls.
      warmups.push({ name: "sarvam", url: "https://api.sarvam.ai/v1/models" });
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
          await keepAliveFetch(url, { method: "GET" });
          if (opts.logSuccess) {
            this.log.info(
              "pingWarmupTargets",
              `Pre-warmed ${name} connection in ${Math.round(performance.now() - t0)}ms (${url})`,
            );
          }
        } catch (err) {
          // 401/403 is fine — the TLS handshake + pool entry still happened.
          // Only log if the network itself failed.
          // Heartbeat failures matter (they'll cost cold-start latency on next
          // chat) so we log them at warn level regardless of opts.logSuccess.
          this.log.warn(
            "pingWarmupTargets",
            `${opts.logSuccess ? "Pre-warm" : "Heartbeat"} of ${name} failed (${url}): ${err instanceof Error ? err.message : String(err)}.`,
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
    return PROVIDER_PREFIXES.some((p) => this.isProviderConfigured(p));
  }

  isProviderConfigured(provider: AiProvider): boolean {
    switch (provider) {
      case "openai":
        return Boolean(this.config.get<string>("OPENAI_API_KEY"));
      case "gemini":
        return Boolean(this.config.get<string>("GOOGLE_API_KEY"));
      case "sarvam":
        return Boolean(this.config.get<string>("SARVAM_API_KEY"));
    }
  }

  getDefaultModel(): string {
    // Fallback when DEFAULT_AI_MODEL is unset. gpt-4.1-mini: cheap, fast, and
    // reliable tool calling. Override via env per deploy.
    return this.config.get<string>("DEFAULT_AI_MODEL") ?? "openai:gpt-4.1-mini";
  }

  /**
   * Return an AI SDK LanguageModel routed to the correct provider.
   *
   * @param modelId  Full prefixed model ID. See parseModelId().
   * @throws ServiceUnavailableException if the provider is unsupported or not configured.
   */
  getModel(modelId: string): LanguageModel {
    const parsed = parseModelId(modelId);
    switch (parsed.provider) {
      case "openai":
        return this.getOpenAIProvider()(parsed.modelName);
      case "gemini":
        return this.getGoogleProvider()(parsed.modelName);
      case "sarvam":
        return this.getSarvamProvider()(parsed.modelName);
    }
  }

  /** Return an AI SDK EmbeddingModel. Sarvam offers none through this API. */
  getEmbeddingModel(modelId: string): EmbeddingModel {
    const parsed = parseModelId(modelId);
    switch (parsed.provider) {
      case "openai":
        return this.getOpenAIProvider().textEmbeddingModel(parsed.modelName);
      case "gemini":
        return this.getGoogleProvider().textEmbeddingModel(parsed.modelName);
      case "sarvam":
        throw new ServiceUnavailableException({
          code: "PROVIDER_NO_EMBEDDINGS",
          message:
            "Sarvam does not expose embedding models via the chat API. Use an OpenAI or Google embedding model.",
        });
    }
  }

  // ==========================================================================
  // Provider lazy initialisers. Each throws a ServiceUnavailableException with
  // a provider-specific code so the error message tells the operator exactly
  // which env var is missing.
  // ==========================================================================

  private getOpenAIProvider(): OpenAIProvider {
    if (this.openai) return this.openai;

    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: "OPENAI_NOT_CONFIGURED",
        message:
          "OpenAI is not configured. Set OPENAI_API_KEY to use openai:* (direct) models.",
      });
    }

    // Optional: organisation for billing attribution.
    const organization = this.config.get<string>("OPENAI_ORGANIZATION");

    this.openai = createOpenAI({
      apiKey,
      fetch: keepAliveFetch,
      ...(organization ? { organization } : {}),
    });
    this.log.info(
      "getOpenAIProvider",
      `OpenAI provider initialised${organization ? ` (org=${organization})` : ""}`,
    );
    return this.openai;
  }

  private getGoogleProvider(): GoogleGenerativeAIProvider {
    if (this.google) return this.google;

    const apiKey = this.config.get<string>("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: "GOOGLE_NOT_CONFIGURED",
        message:
          "Google Gemini is not configured. Set GOOGLE_API_KEY to use gemini:* (direct) models. Get one at https://aistudio.google.com/apikey",
      });
    }

    this.google = createGoogleGenerativeAI({ apiKey, fetch: keepAliveFetch });
    this.log.info("getGoogleProvider", "Google Gemini provider initialised");
    return this.google;
  }

  /**
   * Sarvam AI — India-hosted Indic-native LLMs. OpenAI-compatible chat API
   * (POST /v1/chat/completions with standard messages/stream fields) so we use
   * `@ai-sdk/openai-compatible` rather than maintaining a custom provider.
   * api.sarvam.ai is hosted in India, close to our users.
   */
  private getSarvamProvider(): OpenAICompatibleProvider {
    if (this.sarvam) return this.sarvam;

    const apiKey = this.config.get<string>("SARVAM_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: "SARVAM_NOT_CONFIGURED",
        message:
          "Sarvam AI is not configured. Set SARVAM_API_KEY to use sarvam:* models. Get one at https://dashboard.sarvam.ai/",
      });
    }

    this.sarvam = createOpenAICompatible({
      name: "sarvam",
      baseURL: "https://api.sarvam.ai/v1",
      apiKey,
      fetch: keepAliveFetch,
      // Without this a streamed response carries no usage, so the call could
      // not be metered (ADR-0012).
      includeUsage: true,
    });
    this.log.info("getSarvamProvider", "Sarvam AI provider initialised");
    return this.sarvam;
  }
}
