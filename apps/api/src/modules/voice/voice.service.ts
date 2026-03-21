import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import {
  type VoiceProvider,
  type STTRequest,
  type STTResponse,
  type TTSRequest,
  type TTSResponse,
  type LanguageDetectionResponse,
  type SupportedLanguage,
  VOICE_PROVIDERS,
  UnsupportedLanguageError,
  VoiceProviderError,
} from './providers/voice-provider.interface';
import { PrismaService } from '../../services/prisma.service';
import { type VoiceConfigDto, voiceConfigSchema } from '@repo/validation';

const DEFAULT_VOICE_CONFIG: VoiceConfigDto = Object.freeze(
  voiceConfigSchema.parse({}),
) as VoiceConfigDto;

/** Providers that should only be used in routing when no real provider is available */
const NON_ROUTABLE_PROVIDERS = new Set(['stub']);

/** Providers that do not support TTS */
const NO_TTS_PROVIDERS = new Set(['deepgram']);

/** Cache TTL: 60 seconds — balances freshness with DB load */
const VOICE_CONFIG_CACHE_TTL_MS = 60_000;

interface CachedVoiceConfig {
  config: VoiceConfigDto;
  expiresAt: number;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly registry = new Map<string, VoiceProvider>();
  private readonly sttProviders = new Map<string, VoiceProvider>();
  private readonly ttsProviders = new Map<string, VoiceProvider>();

  private readonly INDIAN_LANGUAGES = new Set<string>([
    'hi',
    'mr',
    'bn',
    'ta',
    'te',
    'gu',
    'kn',
    'ml',
    'pa',
    'or',
    'hinglish',
  ]);

  private readonly voiceConfigCache = new Map<string, CachedVoiceConfig>();

  constructor(
    @Inject(VOICE_PROVIDERS) providers: VoiceProvider[],
    private readonly prisma: PrismaService,
  ) {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  private registerProvider(provider: VoiceProvider): void {
    if (this.registry.has(provider.name)) {
      this.logger.warn(
        `Provider "${provider.name}" is already registered — overwriting`,
      );
    }
    this.registry.set(provider.name, provider);

    if (NON_ROUTABLE_PROVIDERS.has(provider.name)) {
      this.logger.log(
        `Registered voice provider: ${provider.name} (non-routable)`,
      );
      return;
    }

    // Register in STT map
    this.sttProviders.set(provider.name, provider);

    // Register in TTS map — exclude providers that don't support TTS
    if (!NO_TTS_PROVIDERS.has(provider.name)) {
      this.ttsProviders.set(provider.name, provider);
    }

    this.logger.log(`Registered voice provider: ${provider.name}`);
  }

  getProvider(name: string): VoiceProvider {
    const provider = this.registry.get(name);
    if (!provider) {
      throw new BadRequestException(`Unknown voice provider: "${name}"`);
    }
    return provider;
  }

  getRegisteredProviders(): string[] {
    return Array.from(this.registry.keys());
  }

  getProvidersInfo(): {
    name: string;
    stt: boolean;
    tts: boolean;
    languages: string[];
  }[] {
    return Array.from(this.registry.entries())
      .filter(([name]) => !NON_ROUTABLE_PROVIDERS.has(name))
      .map(([name, provider]) => ({
        name,
        stt: this.sttProviders.has(name),
        tts: this.ttsProviders.has(name),
        languages: [...provider.supportedLanguages],
      }));
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveSTTProvider(
      config,
      request.languageHint ?? 'en',
    );
    const hasOverride = !!config.sttProvider;
    this.logger.log(
      `STT routing: language=${request.languageHint ?? 'en'}, provider=${provider.name}, override=${hasOverride}`,
    );

    const startTime = Date.now();
    const result = await provider.transcribe(request);
    const latencyMs = Date.now() - startTime;
    this.logger.log(
      `STT completed: provider=${provider.name}, latency=${latencyMs}ms`,
    );

    return result;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveTTSProvider(config, request.language);
    const hasOverride = !!config.ttsProvider;
    this.logger.log(
      `TTS routing: language=${request.language}, provider=${provider.name}, override=${hasOverride}`,
    );

    const startTime = Date.now();
    try {
      const result = await provider.synthesize(request);
      const latencyMs = Date.now() - startTime;
      this.logger.log(
        `TTS completed: provider=${provider.name}, latency=${latencyMs}ms`,
      );
      return result;
    } catch (error) {
      if (
        error instanceof UnsupportedLanguageError ||
        error instanceof VoiceProviderError
      ) {
        return this.ttsFallback(request, provider.name, error);
      }
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async detectLanguage(audio: Buffer, audioFormat: string, agentId?: string): Promise<LanguageDetectionResponse> {
    // Route to Sarvam by default — best Indian language detection with 'unknown' language_code
    const sarvam = this.registry.get('sarvam');
    if (sarvam) {
      this.logger.log('Language detection: routing to sarvam (default)');
      return sarvam.detectLanguage(audio, audioFormat);
    }

    // Fallback: use first available provider
    const firstProvider = this.registry.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No voice providers available');
    }
    this.logger.log(
      `Language detection: routing to ${firstProvider.name} (fallback)`,
    );
    return firstProvider.detectLanguage(audio, audioFormat);
  }

  private resolveSTTProvider(
    config: VoiceConfigDto,
    language: string,
  ): VoiceProvider {
    // Priority 1: Agent override
    if (config.sttProvider) {
      const override = this.sttProviders.get(config.sttProvider);
      if (override) return override;
      this.logger.warn(
        `STT override provider "${config.sttProvider}" not found, falling back to language-based routing`,
      );
    }

    // Priority 2: Language-based routing
    if (this.INDIAN_LANGUAGES.has(language)) {
      const sarvam = this.sttProviders.get('sarvam');
      if (sarvam) return sarvam;
    }

    // Priority 3: Default → Deepgram
    const deepgram = this.sttProviders.get('deepgram');
    if (deepgram) return deepgram;

    // Last resort: first available STT provider
    const firstProvider = this.sttProviders.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No STT providers available');
    }
    return firstProvider;
  }

  private resolveTTSProvider(
    config: VoiceConfigDto,
    language: SupportedLanguage,
  ): VoiceProvider {
    // Priority 1: Agent override
    if (config.ttsProvider) {
      const override = this.ttsProviders.get(config.ttsProvider);
      if (override) return override;
      this.logger.warn(
        `TTS override provider "${config.ttsProvider}" not found, falling back to language-based routing`,
      );
    }

    // Priority 2: Language-based routing
    if (this.INDIAN_LANGUAGES.has(language)) {
      const sarvam = this.ttsProviders.get('sarvam');
      if (sarvam) return sarvam;
    }

    // Priority 3: Default → ElevenLabs
    const elevenlabs = this.ttsProviders.get('elevenlabs');
    if (elevenlabs) return elevenlabs;

    // Last resort: first available TTS provider
    const firstProvider = this.ttsProviders.values().next().value;
    if (!firstProvider) {
      throw new BadGatewayException('No TTS providers available');
    }
    return firstProvider;
  }

  private async ttsFallback(
    request: TTSRequest,
    failedProviderName: string,
    originalError: Error,
  ): Promise<TTSResponse> {
    const fallbackOrder = ['sarvam', 'elevenlabs'];

    for (const providerName of fallbackOrder) {
      if (providerName === failedProviderName) continue;
      const provider = this.ttsProviders.get(providerName);
      if (!provider) continue;

      try {
        this.logger.warn(
          `TTS fallback: ${failedProviderName} → ${providerName}, reason: ${originalError.message}`,
        );
        return await provider.synthesize(request);
      } catch (e) {
        if (
          e instanceof UnsupportedLanguageError ||
          e instanceof VoiceProviderError
        ) {
          continue;
        }
        throw e;
      }
    }

    throw new BadGatewayException(
      `No TTS provider supports language: ${request.language}`,
    );
  }

  async getVoiceConfig(agentId: string): Promise<VoiceConfigDto> {
    const now = Date.now();
    const cached = this.voiceConfigCache.get(agentId);
    if (cached && cached.expiresAt > now) return cached.config;

    try {
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: { voiceEnabled: true, voiceConfig: true },
      });

      if (!agent || !agent.voiceEnabled || !agent.voiceConfig) {
        this.cacheConfig(agentId, DEFAULT_VOICE_CONFIG);
        return DEFAULT_VOICE_CONFIG;
      }

      const config = voiceConfigSchema.parse(agent.voiceConfig);
      this.cacheConfig(agentId, config);
      return config;
    } catch (error) {
      this.logger.warn(
        `Failed to load voice config for agent ${agentId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // Don't cache transient errors — let next request retry
      return DEFAULT_VOICE_CONFIG;
    }
  }

  private cacheConfig(agentId: string, config: VoiceConfigDto): void {
    this.voiceConfigCache.set(agentId, {
      config,
      expiresAt: Date.now() + VOICE_CONFIG_CACHE_TTL_MS,
    });
  }

  clearVoiceConfigCache(): void {
    this.voiceConfigCache.clear();
  }
}
