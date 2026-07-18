import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { AppLogger } from '../../../common/logger/app-logger';
import { ProviderEventLogger, PROVIDERS } from '../../../common/events/provider.logger';
import type {
  VoiceProvider,
  STTRequest,
  STTResponse,
  TTSRequest,
  TTSResponse,
  LanguageDetectionResponse,
  SupportedLanguage,
} from './voice-provider.interface';
import { VoiceProviderError } from './voice-provider.interface';

interface DeepgramResponse {
  metadata: {
    request_id: string;
    duration: number;
    channels: number;
    models: string[];
  };
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
        words: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
        }>;
      }>;
      detected_language?: string;
    }>;
  };
}

interface DeepgramError {
  err_code: string;
  err_msg: string;
  request_id: string;
}

@Injectable()
export class DeepgramProvider implements VoiceProvider {
  private readonly log = new AppLogger(DeepgramProvider.name);
  private readonly apiKey: string;

  readonly name = 'deepgram';
  // Nova-3 supported languages. Verify gu (Gujarati) and kn (Kannada) availability
  // against Deepgram docs — they may have limited accuracy for these languages.
  readonly supportedLanguages: SupportedLanguage[] = [
    'en', 'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {
    this.apiKey = this.configService.get<string>('DEEPGRAM_API_KEY') || '';

    if (!this.apiKey) {
      this.log.warn('constructor', 'DEEPGRAM_API_KEY not configured — Deepgram provider will not work');
    }
  }

  private getContentType(format: string): string {
    const map: Record<string, string> = {
      'webm': 'audio/webm',
      'wav': 'audio/wav',
      'mp3': 'audio/mp3',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
    };
    const contentType = map[format];
    if (!contentType) {
      this.log.warn('getContentType', 'unknown audio format — defaulting to audio/webm', { format });
      return 'audio/webm';
    }
    return contentType;
  }

  private extractFormat(audioFormat: string): string {
    // Handle both "audio/webm" and "webm" formats
    if (audioFormat.includes('/')) {
      return audioFormat.split('/')[1] ?? audioFormat;
    }
    return audioFormat;
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', 'nova-3');
    url.searchParams.set('language', request.languageHint || 'en');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');

    const format = this.extractFormat(request.audioFormat);
    this.log.debug('transcribe', 'STT request', {
      agentId: request.agentId,
      format,
      languageHint: request.languageHint,
      audioBytes: request.audio.length,
    });

    // Fire-and-forget event: wraps the outbound STT call and emits
    // DEEPGRAM_STT_COMPLETED / _FAILED with timing. Never stores audio bytes.
    return this.providerLog.traced<STTResponse>(
      {
        channel: 'VOICE',
        provider: PROVIDERS.DEEPGRAM,
        eventBase: 'DEEPGRAM_STT',
        agentId: request.agentId,
        sessionId: request.sessionId,
        requestUrl: url.toString(),
        requestPayload: {
          audioBytes: request.audio.length,
          audioMime: request.audioFormat,
          languageHint: request.languageHint,
        },
        extract: (r) => ({
          responsePayload: {
            transcriptChars: r.transcript.length,
            detectedLanguage: r.detectedLanguage,
            confidence: r.confidence,
          },
          metadata: { latencyMs: r.latencyMs },
        }),
      },
      async () => {
        const startTime = Date.now();

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
            'Content-Type': this.getContentType(format),
          },
          body: new Uint8Array(request.audio),
          signal: AbortSignal.timeout(10_000),
        }).catch((error: Error) => {
          throw this.handleNetworkError(error);
        });

        if (!response.ok) {
          await this.handleErrorResponse(response);
        }

        const data = (await response.json()) as DeepgramResponse;

        const channel = data.results.channels[0];
        const alternative = channel?.alternatives[0];

        const result: STTResponse = {
          transcript: alternative?.transcript || '',
          confidence: alternative?.confidence || 0,
          detectedLanguage: (channel?.detected_language || request.languageHint || 'en') as SupportedLanguage,
          provider: this.name,
          latencyMs: Date.now() - startTime,
        };
        this.log.info('transcribe', 'STT completed', {
          detectedLanguage: result.detectedLanguage,
          transcriptChars: result.transcript.length,
          latencyMs: result.latencyMs,
        });
        return result;
      },
    );
  }

  // Deepgram Aura TTS is English-only and not implemented yet.
  // Throws for ALL languages (including English) so VoiceService routing (story 10-5)
  // can fall back to Sarvam or ElevenLabs.
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    this.log.warn('synthesize', 'Deepgram TTS not implemented — caller must route to Sarvam/ElevenLabs', {
      language: request.language,
    });
    throw new VoiceProviderError(
      this.name,
      `Deepgram TTS is not implemented. Use Sarvam or ElevenLabs for language: ${request.language}.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', 'nova-3');
    url.searchParams.set('language', 'multi');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');

    const format = this.extractFormat(audioFormat);
    this.log.debug('detectLanguage', 'auto-detect request', { format, audioBytes: audio.length });

    return this.providerLog.traced<LanguageDetectionResponse>(
      {
        channel: 'VOICE',
        provider: PROVIDERS.DEEPGRAM,
        eventBase: 'DEEPGRAM_STT_DETECT',
        requestUrl: url.toString(),
        requestPayload: { audioBytes: audio.length, audioMime: audioFormat },
        extract: (r) => ({
          responsePayload: { detectedLanguage: r.detectedLanguage, confidence: r.confidence },
          metadata: { latencyMs: r.latencyMs },
        }),
      },
      async () => {
        const startTime = Date.now();

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
            'Content-Type': this.getContentType(format),
          },
          body: new Uint8Array(audio),
          signal: AbortSignal.timeout(10_000),
        }).catch((error: Error) => {
          throw this.handleNetworkError(error);
        });

        if (!response.ok) {
          await this.handleErrorResponse(response);
        }

        const data = (await response.json()) as DeepgramResponse;

        const channel = data.results.channels[0];
        const alternative = channel?.alternatives[0];

        const result: LanguageDetectionResponse = {
          detectedLanguage: (channel?.detected_language || 'en') as SupportedLanguage,
          confidence: alternative?.confidence || 0,
          provider: this.name,
          latencyMs: Date.now() - startTime,
        };
        this.log.info('detectLanguage', 'detection completed', {
          detectedLanguage: result.detectedLanguage,
          latencyMs: result.latencyMs,
        });
        return result;
      },
    );
  }

  private handleNetworkError(error: Error): VoiceProviderError {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new VoiceProviderError(
        this.name,
        'Request timed out after 10s',
        HttpStatus.GATEWAY_TIMEOUT,
        error,
      );
    }
    return new VoiceProviderError(
      this.name,
      `Network error: ${error.message}`,
      HttpStatus.BAD_GATEWAY,
      error,
    );
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: DeepgramError | undefined;
    try {
      errorData = (await response.json()) as DeepgramError;
    } catch {
      throw new VoiceProviderError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const message = errorData?.err_msg || `HTTP ${response.status}`;

    this.log.error('handleErrorResponse', 'Deepgram API error', undefined, {
      status: response.status,
      code: errorData?.err_code,
      message,
    });

    switch (response.status) {
      case 401:
        throw new VoiceProviderError(this.name, message, HttpStatus.UNAUTHORIZED);
      case 429:
        throw new VoiceProviderError(this.name, message, HttpStatus.TOO_MANY_REQUESTS);
      case 400:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_REQUEST);
      case 500:
      case 502:
      case 503:
      default:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_GATEWAY);
    }
  }
}
