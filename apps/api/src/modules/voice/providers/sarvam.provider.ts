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

/** Sarvam bulbul:v3 speaker catalog (verified against the live API error response).
 *  Update if Sarvam ships new speakers. */
const SARVAM_BULBUL_V3_VOICES: ReadonlyArray<VoiceListItem> = [
  { id: 'aayan',    name: 'Aayan',    gender: 'male' },
  { id: 'aditya',   name: 'Aditya',   gender: 'male' },
  { id: 'advait',   name: 'Advait',   gender: 'male' },
  { id: 'amit',     name: 'Amit',     gender: 'male' },
  { id: 'anand',    name: 'Anand',    gender: 'male' },
  { id: 'ashutosh', name: 'Ashutosh', gender: 'male' },
  { id: 'dev',      name: 'Dev',      gender: 'male' },
  { id: 'gokul',    name: 'Gokul',    gender: 'male' },
  { id: 'ishita',   name: 'Ishita',   gender: 'female' },
  { id: 'kabir',    name: 'Kabir',    gender: 'male' },
  { id: 'kavitha',  name: 'Kavitha',  gender: 'female' },
  { id: 'kavya',    name: 'Kavya',    gender: 'female' },
  { id: 'mani',     name: 'Mani',     gender: 'male' },
  { id: 'manan',    name: 'Manan',    gender: 'male' },
  { id: 'mohit',    name: 'Mohit',    gender: 'male' },
  { id: 'neha',     name: 'Neha',     gender: 'female' },
  { id: 'niharika', name: 'Niharika', gender: 'female' },
  { id: 'pooja',    name: 'Pooja',    gender: 'female' },
  { id: 'priya',    name: 'Priya',    gender: 'female' },
  { id: 'rahul',    name: 'Rahul',    gender: 'male' },
  { id: 'ratan',    name: 'Ratan',    gender: 'male' },
  { id: 'rehan',    name: 'Rehan',    gender: 'male' },
  { id: 'ritu',     name: 'Ritu',     gender: 'female' },
  { id: 'rohan',    name: 'Rohan',    gender: 'male' },
  { id: 'roopa',    name: 'Roopa',    gender: 'female' },
  { id: 'rupali',   name: 'Rupali',   gender: 'female' },
  { id: 'shreya',   name: 'Shreya',   gender: 'female' },
  { id: 'shruti',   name: 'Shruti',   gender: 'female' },
  { id: 'shubh',    name: 'Shubh',    gender: 'male' },
  { id: 'simran',   name: 'Simran',   gender: 'female' },
  { id: 'soham',    name: 'Soham',    gender: 'male' },
  { id: 'suhani',   name: 'Suhani',   gender: 'female' },
  { id: 'sumit',    name: 'Sumit',    gender: 'male' },
  { id: 'sunny',    name: 'Sunny',    gender: 'male' },
  { id: 'tanya',    name: 'Tanya',    gender: 'female' },
  { id: 'tarun',    name: 'Tarun',    gender: 'male' },
  { id: 'varun',    name: 'Varun',    gender: 'male' },
  { id: 'vijay',    name: 'Vijay',    gender: 'male' },
];

const SARVAM_DEFAULT_SPEAKER = 'priya';

interface SarvamSTTResponse {
  request_id: string | null;
  transcript: string;
  language_code: string | null;
  language_probability: number | null;
  timestamps: {
    words: string[];
    start_time_seconds: number[];
    end_time_seconds: number[];
  } | null;
}

interface SarvamTTSResponse {
  request_id: string;
  audios: string[];
}

interface SarvamErrorResponse {
  error: {
    request_id: string | null;
    message: string;
    code: string;
  };
}

@Injectable()
export class SarvamProvider implements VoiceProvider {
  private readonly logger = new Logger(SarvamProvider.name);
  private readonly apiKey: string;

  readonly name = 'sarvam';
  readonly supportedLanguages: SupportedLanguage[] = [
    'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'en', 'hinglish',
  ];

  private readonly LANGUAGE_MAP: Record<string, string> = {
    'hi': 'hi-IN',
    'mr': 'mr-IN',
    'bn': 'bn-IN',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'gu': 'gu-IN',
    'kn': 'kn-IN',
    'ml': 'ml-IN',
    'pa': 'pa-IN',
    'or': 'od-IN',
    'en': 'en-IN',
    'hinglish': 'unknown',
  };

  private readonly REVERSE_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
    'hi-IN': 'hi',
    'mr-IN': 'mr',
    'bn-IN': 'bn',
    'ta-IN': 'ta',
    'te-IN': 'te',
    'gu-IN': 'gu',
    'kn-IN': 'kn',
    'ml-IN': 'ml',
    'pa-IN': 'pa',
    'od-IN': 'or',
    'en-IN': 'en',
  };

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SARVAM_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn('SARVAM_API_KEY not configured — Sarvam provider will not work');
    }
  }

  private toSarvamLanguage(language?: string): string {
    if (!language) return 'unknown';
    const mapped = this.LANGUAGE_MAP[language];
    if (!mapped) {
      this.logger.warn(`Unmapped language code "${language}" — falling back to auto-detect`);
      return 'unknown';
    }
    return mapped;
  }

  private fromSarvamLanguage(sarvamCode: string | null): SupportedLanguage {
    if (!sarvamCode) return 'en';
    return this.REVERSE_LANGUAGE_MAP[sarvamCode] || 'en';
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const startTime = Date.now();

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(request.audio)]), 'audio.webm');
    formData.append('model', 'saarika:v2.5');
    formData.append('language_code', this.toSarvamLanguage(request.languageHint));

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamSTTResponse;

    return {
      transcript: data.transcript,
      confidence: data.language_probability ?? 0,
      detectedLanguage: this.fromSarvamLanguage(data.language_code),
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithCodec(request, 'mp3', 'audio/mp3');
  }

  /** Preview synthesis returns WAV instead of MP3 — MP3's mandatory ~24-45ms leading
   *  priming silence (per spec) clips the first consonant on one-shot dropdown playback.
   *  WAV has no priming. Production conversation traffic stays on MP3 via synthesize(). */
  async synthesizePreview(request: TTSRequest): Promise<TTSResponse> {
    return this.synthesizeWithCodec(request, 'wav', 'audio/wav');
  }

  private async synthesizeWithCodec(
    request: TTSRequest,
    sarvamCodec: 'mp3' | 'wav',
    audioFormat: string,
  ): Promise<TTSResponse> {
    const startTime = Date.now();
    const targetLanguageCode = this.toSarvamLanguage(request.language);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': this.apiKey,
      },
      body: JSON.stringify({
        text: request.text,
        target_language_code: targetLanguageCode,
        model: 'bulbul:v3',
        speaker: request.voiceId || SARVAM_DEFAULT_SPEAKER,
        pace: request.speed || 1.0,
        speech_sample_rate: '22050',
        output_audio_codec: sarvamCodec,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamTTSResponse;
    const base64Audio = data.audios[0];
    if (!base64Audio) {
      throw new VoiceProviderError(this.name, 'Empty audio response from Sarvam TTS');
    }
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    return {
      audio: audioBuffer,
      audioFormat,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }

  async listVoices(): Promise<VoiceListItem[]> {
    // Sarvam exposes no /voices catalog endpoint — speakers are baked into the model spec.
    // Returning the static catalog keeps the dropdown UX consistent with ElevenLabs.
    return SARVAM_BULBUL_V3_VOICES.map((v) => ({ ...v }));
  }

  async detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse> {
    const startTime = Date.now();
    this.logger.debug(`detectLanguage called (format: ${audioFormat}, size: ${audio.length})`);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.webm');
    formData.append('model', 'saarika:v2.5');
    formData.append('language_code', 'unknown');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw this.handleNetworkError(error);
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = (await response.json()) as SarvamSTTResponse;

    return {
      detectedLanguage: this.fromSarvamLanguage(data.language_code),
      confidence: data.language_probability ?? 0,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
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
    let errorData: SarvamErrorResponse | undefined;
    try {
      errorData = (await response.json()) as SarvamErrorResponse;
    } catch {
      throw new VoiceProviderError(
        this.name,
        `HTTP ${response.status}: ${response.statusText}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const code = errorData?.error?.code;
    const message = errorData?.error?.message || `HTTP ${response.status}`;

    this.logger.error(`Sarvam API error: ${code} — ${message}`);

    switch (code) {
      case 'invalid_api_key_error':
      case 'authentication_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.UNAUTHORIZED);
      case 'rate_limit_exceeded_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.TOO_MANY_REQUESTS);
      case 'invalid_request_error':
      case 'unprocessable_entity_error':
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_REQUEST);
      case 'internal_server_error':
      default:
        throw new VoiceProviderError(this.name, message, HttpStatus.BAD_GATEWAY);
    }
  }
}
