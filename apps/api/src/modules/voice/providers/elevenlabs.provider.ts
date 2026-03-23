import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
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

interface ElevenLabsSTTResponse {
  language_code: string;
  language_probability: number;
  text: string;
  words: Array<{
    text: string;
    start: number;
    end: number;
    type: string;
    speaker_id?: string;
  }>;
}

interface ElevenLabsErrorResponse {
  detail: {
    status: string;
    message: string;
  };
}

@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  private readonly logger = new Logger(ElevenLabsProvider.name);
  private readonly apiKey: string;
  private readonly defaultVoiceId: string;

  readonly name = 'elevenlabs';
  readonly supportedLanguages: SupportedLanguage[] = [
    'en', 'hi', 'ta', // Multilingual v2 only supports Hindi + Tamil from Indian languages
  ];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY') || '';
    this.defaultVoiceId =
      this.configService.get<string>('ELEVENLABS_DEFAULT_VOICE_ID') || 'Xb7hH8MSUJpSbSDYk0k2';

    if (!this.apiKey) {
      this.logger.warn('ELEVENLABS_API_KEY not configured — ElevenLabs provider will not work');
    }
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const startTime = Date.now();

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(request.audio)]), 'audio.webm');
    formData.append('model_id', 'scribe_v2');
    if (request.languageHint) {
      formData.append('language_code', request.languageHint);
    }

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error, 'transcribe');
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, 'transcribe');
    }

    const data = (await response.json()) as ElevenLabsSTTResponse;

    return {
      transcript: data.text,
      confidence: data.language_probability ?? 0,
      detectedLanguage: (data.language_code as SupportedLanguage) || 'en',
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const voiceId = request.voiceId || this.defaultVoiceId;

    const sanitizedVoiceId = encodeURIComponent(voiceId);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${sanitizedVoiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: 'eleven_multilingual_v2',
          language_code: request.language,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: request.speed || 1.0,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    ).catch((error: Error) => {
      throw this.handleNetworkError(error, 'synthesize');
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, 'synthesize');
    }

    // CRITICAL: Response is raw binary audio, NOT JSON
    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    return {
      audio,
      audioFormat: 'audio/mp3',
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const startTime = Date.now();
    this.logger.debug(`detectLanguage called (format: ${audioFormat}, size: ${audio.length})`);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.webm');
    formData.append('model_id', 'scribe_v2');
    // Omit language_code to let ElevenLabs auto-detect

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error, 'detectLanguage');
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, 'detectLanguage');
    }

    const data = (await response.json()) as ElevenLabsSTTResponse;

    return {
      detectedLanguage: (data.language_code as SupportedLanguage) || 'en',
      confidence: data.language_probability ?? 0,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  private handleNetworkError(error: Error, operation: string): VoiceProviderError {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      const timeout = operation === 'synthesize' ? '15s' : '10s';
      return new VoiceProviderError(
        this.name,
        `Request timed out after ${timeout}`,
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

  private async handleErrorResponse(response: Response, operation: string): Promise<never> {
    let errorData: ElevenLabsErrorResponse | undefined;
    try {
      errorData = (await response.json()) as ElevenLabsErrorResponse;
    } catch {
      throw new VoiceProviderError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const message = errorData?.detail?.message || `HTTP ${response.status}`;

    this.logger.error(`ElevenLabs API error (${operation}): ${response.status} — ${message}`);

    switch (response.status) {
      case 401:
        throw new VoiceProviderError(this.name, message, HttpStatus.UNAUTHORIZED);
      case 422:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_REQUEST);
      case 429:
        throw new VoiceProviderError(this.name, message, HttpStatus.TOO_MANY_REQUESTS);
      case 500:
      case 502:
      case 503:
      default:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_GATEWAY);
    }
  }
}
