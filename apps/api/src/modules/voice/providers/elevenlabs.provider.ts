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
  VoiceListItem,
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

interface ElevenLabsVoiceListResponse {
  voices: Array<{
    voice_id: string;
    name: string;
    preview_url?: string | null;
    labels?: Record<string, string> | null;
    category?: string | null;
    high_quality_base_model_ids?: string[] | null;
  }>;
}

/** Maps ElevenLabs `labels.language` (or accent fallback) to our SupportedLanguage codes. */
const ELEVENLABS_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  english: 'en',
  hindi: 'hi',
  tamil: 'ta',
};

const ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2';

@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  private readonly logger = new Logger(ElevenLabsProvider.name);
  private readonly apiKey: string;
  private readonly defaultVoiceId: string;

  /**
   * ElevenLabs enforces a subscription-tier concurrency cap on TTS (2 concurrent
   * on the starter plan, higher on paid tiers). When we exceeded this, the
   * provider returned 429 and fell back to Sarvam mid-response — causing an
   * audible voice switch mid-reply. We gate synthesize() with a simple
   * promise-chain semaphore sized to the plan limit, so concurrent callers
   * queue at our edge instead of hitting the rate limit.
   *
   * Configurable via ELEVENLABS_MAX_CONCURRENT (default 2, matching starter plan).
   * If you upgrade the plan, bump this env var accordingly.
   */
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private readonly waitQueue: Array<() => void> = [];

  readonly name = 'elevenlabs';
  readonly supportedLanguages: SupportedLanguage[] = [
    'en', 'hi', 'ta', // Multilingual v2 only supports Hindi + Tamil from Indian languages
  ];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ELEVENLABS_API_KEY') || '';
    this.defaultVoiceId =
      this.configService.get<string>('ELEVENLABS_DEFAULT_VOICE_ID') || 'Xb7hH8MSUJpSbSDYk0k2';
    const configured = this.configService.get<string>('ELEVENLABS_MAX_CONCURRENT');
    const parsed = configured ? parseInt(configured, 10) : NaN;
    this.maxConcurrent = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

    if (!this.apiKey) {
      this.logger.warn('ELEVENLABS_API_KEY not configured — ElevenLabs provider will not work');
    }
  }

  /**
   * Acquire a concurrency slot. Resolves immediately if under the cap,
   * otherwise queues until a prior call releases. FIFO ordering preserved so
   * sentence 0 doesn't get starved by later sentences jumping the queue.
   */
  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.inFlight--;
    const next = this.waitQueue.shift();
    if (next) next();
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
    return this.synthesizeWithFormat(request, 'mp3_44100_128', 'audio/mp3', 'synthesize');
  }

  /** Preview synthesis returns Ogg Opus (free-tier compatible — wav_44100 needs Pro).
   *  Opus has a pre-skip field in its header that browsers always honor when decoding,
   *  so unlike MP3 there's no leading priming silence to clip the first consonant.
   *  Ref: https://medium.com/vimeo-engineering-blog/a-brief-history-of-gapless-audio-and-what-you-can-do-about-it-ea9e1c343215 */
  async synthesizePreview(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithFormat(request, 'opus_48000_32', 'audio/ogg', 'synthesizePreview');
  }

  private async synthesizeWithFormat(
    request: TTSRequest,
    elevenlabsFormat: string,
    audioFormat: string,
    operation: string,
  ): Promise<TTSResponse> {
    // Respect the subscription-tier concurrency cap. Blocks here until a slot
    // is free — prevents the 429 cascade that caused sentences 2-3 to fall
    // back to Sarvam (audible voice switch mid-reply).
    await this.acquireSlot();
    const startTime = Date.now();
    try {
      const voiceId = request.voiceId || this.defaultVoiceId;
      const sanitizedVoiceId = encodeURIComponent(voiceId);

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${sanitizedVoiceId}?output_format=${elevenlabsFormat}`,
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
        throw this.handleNetworkError(error, operation);
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, operation);
      }

      // CRITICAL: Response is raw binary audio, NOT JSON
      const arrayBuffer = await response.arrayBuffer();
      const audio = Buffer.from(arrayBuffer);

      return {
        audio,
        audioFormat,
        provider: this.name,
        latencyMs: Date.now() - startTime,
      };
    } finally {
      this.releaseSlot();
    }
  }

  async listVoices(): Promise<VoiceListItem[]> {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error, 'listVoices');
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, 'listVoices');
    }

    const data = (await response.json()) as ElevenLabsVoiceListResponse;

    return (data.voices ?? [])
      .filter((v) => {
        const compatibleModels = v.high_quality_base_model_ids ?? [];
        // Keep voices either explicitly compatible with our TTS model, or with an unknown
        // compatibility list (premade voices often omit this and still work).
        return compatibleModels.length === 0 || compatibleModels.includes(ELEVENLABS_TTS_MODEL);
      })
      .map((v): VoiceListItem => {
        const labels = v.labels ?? {};
        const languageLabel = (labels.language ?? labels.accent ?? '').toLowerCase();
        const language = ELEVENLABS_LANGUAGE_MAP[languageLabel];
        const gender = labels.gender as VoiceListItem['gender'] | undefined;

        // Build a human-readable descriptor from labels: combine description ("calm",
        // "deep"), use_case ("narration"), age ("young"), and accent. Gender is shown
        // separately. Skip ElevenLabs' top-level `category` ("premade"/"cloned") — not
        // useful UI copy. Cap at 3 parts to keep the dropdown row readable.
        const descriptionParts = [
          labels.description,
          labels.use_case,
          labels.age,
          labels.accent,
        ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        const category =
          descriptionParts.length > 0 ? descriptionParts.slice(0, 3).join(' · ') : undefined;

        return {
          id: v.voice_id,
          name: v.name,
          languages: language ? [language] : undefined,
          gender: gender && ['male', 'female', 'neutral'].includes(gender) ? gender : undefined,
          category,
          previewUrl: v.preview_url ?? undefined,
        };
      });
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
