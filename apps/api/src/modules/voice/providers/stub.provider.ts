import { Injectable, Logger } from '@nestjs/common';
import type {
  VoiceProvider,
  STTRequest,
  STTResponse,
  TTSRequest,
  TTSResponse,
  LanguageDetectionResponse,
  SupportedLanguage,
} from './voice-provider.interface';

@Injectable()
export class StubProvider implements VoiceProvider {
  private readonly logger = new Logger(StubProvider.name);

  readonly name = 'stub';
  readonly supportedLanguages: SupportedLanguage[] = ['en', 'hi', 'mr', 'hinglish'];

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const start = Date.now();
    this.logger.debug(`[stub] transcribe called for agent ${request.agentId}`);

    return {
      transcript: 'This is a stub transcription response.',
      confidence: 0.95,
      detectedLanguage: request.languageHint ?? 'en',
      provider: this.name,
      latencyMs: Date.now() - start,
    };
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const start = Date.now();
    this.logger.debug(`[stub] synthesize called for agent ${request.agentId}`);

    return {
      audio: Buffer.from('stub-audio-data'),
      audioFormat: 'audio/mp3',
      durationMs: 1000,
      provider: this.name,
      latencyMs: Date.now() - start,
    };
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const start = Date.now();
    this.logger.debug(`[stub] detectLanguage called (format: ${audioFormat}, size: ${audio.length})`);

    return {
      detectedLanguage: 'en',
      confidence: 0.9,
      provider: this.name,
      latencyMs: Date.now() - start,
    };
  }
}
