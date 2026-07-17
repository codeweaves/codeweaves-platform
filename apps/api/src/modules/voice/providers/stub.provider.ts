import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../../common/logger/app-logger';
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
  private readonly log = new AppLogger(StubProvider.name);

  readonly name = 'stub';
  readonly supportedLanguages: SupportedLanguage[] = ['en', 'hi', 'mr', 'hinglish'];

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const start = Date.now();
    this.log.debug('transcribe', 'stub STT invoked', { agentId: request.agentId });

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
    this.log.debug('synthesize', 'stub TTS invoked', { agentId: request.agentId });

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
    this.log.debug('detectLanguage', 'stub language detection invoked', {
      format: audioFormat,
      audioBytes: audio.length,
    });

    return {
      detectedLanguage: 'en',
      confidence: 0.9,
      provider: this.name,
      latencyMs: Date.now() - start,
    };
  }
}
