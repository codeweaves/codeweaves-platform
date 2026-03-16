import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import {
  type VoiceProvider,
  type STTRequest,
  type STTResponse,
  type TTSRequest,
  type TTSResponse,
  type LanguageDetectionResponse,
  VOICE_PROVIDERS,
} from './providers/voice-provider.interface';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly registry = new Map<string, VoiceProvider>();

  constructor(
    @Inject(VOICE_PROVIDERS) providers: VoiceProvider[],
  ) {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  private registerProvider(provider: VoiceProvider): void {
    if (this.registry.has(provider.name)) {
      this.logger.warn(`Provider "${provider.name}" is already registered — overwriting`);
    }
    this.registry.set(provider.name, provider);
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

  async transcribe(providerName: string, request: STTRequest): Promise<STTResponse> {
    const provider = this.getProvider(providerName);
    this.logger.debug(`Transcribing via ${providerName} for agent ${request.agentId}`);
    return provider.transcribe(request);
  }

  async synthesize(providerName: string, request: TTSRequest): Promise<TTSResponse> {
    const provider = this.getProvider(providerName);
    this.logger.debug(`Synthesizing via ${providerName} for agent ${request.agentId}`);
    return provider.synthesize(request);
  }

  async detectLanguage(providerName: string, audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const provider = this.getProvider(providerName);
    this.logger.debug(`Detecting language via ${providerName}`);
    return provider.detectLanguage(audio, audioFormat);
  }
}
