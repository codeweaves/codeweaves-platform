import { HttpException, HttpStatus } from '@nestjs/common';

// ============================================
// Normalized Language Codes (ISO 639-1 based)
// ============================================

export type SupportedLanguage =
  | 'en'
  | 'hi'
  | 'mr'
  | 'bn'
  | 'ta'
  | 'te'
  | 'gu'
  | 'kn'
  | 'ml'
  | 'pa'
  | 'or'
  | 'hinglish';

// ============================================
// STT (Speech-to-Text) Types
// ============================================

export interface STTRequest {
  audio: Buffer;
  audioFormat: string; // e.g., 'audio/webm', 'audio/wav'
  languageHint?: SupportedLanguage;
  agentId: string;
}

export interface STTResponse {
  transcript: string;
  /** Confidence score (0-1). Semantics vary by provider:
   *  - Deepgram: transcription confidence
   *  - Sarvam: language detection probability
   *  - ElevenLabs: language detection probability */
  confidence: number;
  detectedLanguage: SupportedLanguage;
  provider: string;
  latencyMs: number;
}

// ============================================
// TTS (Text-to-Speech) Types
// ============================================

export interface TTSRequest {
  text: string;
  language: SupportedLanguage;
  voiceId?: string;
  speed?: number;
  agentId: string;
}

export interface TTSResponse {
  audio: Buffer;
  audioFormat: string; // e.g., 'audio/mp3', 'audio/wav'
  durationMs?: number;
  provider: string;
  latencyMs: number;
}

// ============================================
// Language Detection Types
// ============================================

export interface LanguageDetectionResponse {
  detectedLanguage: SupportedLanguage;
  confidence: number;
  provider: string;
  latencyMs: number;
}

// ============================================
// Voice Listing Types
// ============================================

export interface VoiceListItem {
  /** Provider-specific voice id sent back in synthesize requests (e.g. ElevenLabs voice_id, Sarvam speaker name). */
  id: string;
  /** Human-friendly display name. */
  name: string;
  /** ISO language codes the voice handles well. Empty/omitted = no provider hint. */
  languages?: SupportedLanguage[];
  gender?: 'male' | 'female' | 'neutral';
  /** Optional short label (e.g. "Conversational", "Indian"). */
  category?: string;
  /** Optional public preview URL. When present, the client plays it directly. */
  previewUrl?: string;
}

// ============================================
// VoiceProvider Interface
// ============================================

export interface VoiceProvider {
  readonly name: string;
  readonly supportedLanguages: SupportedLanguage[];

  transcribe(request: STTRequest): Promise<STTResponse>;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse>;
  /** Optional. Providers that don't expose a catalog (or aren't usable as TTS) can omit this. */
  listVoices?(): Promise<VoiceListItem[]>;
  /** Optional. Synthesize a short preview clip in a format that has no MP3 priming
   *  silence — ElevenLabs uses Opus (pre-skip field handled by browsers), Sarvam uses
   *  WAV. Production conversations stay on MP3 (synthesize) for bandwidth. */
  synthesizePreview?(request: TTSRequest): Promise<TTSResponse>;
}

// ============================================
// Voice Provider Injection Token
// ============================================

export const VOICE_PROVIDERS = 'VOICE_PROVIDERS';

// ============================================
// VoiceProviderError
// ============================================

export class VoiceProviderError extends HttpException {
  constructor(
    public readonly provider: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_GATEWAY,
    public readonly originalError?: Error,
  ) {
    super(`[${provider}] ${message}`, status);
  }
}

export class UnsupportedLanguageError extends VoiceProviderError {
  constructor(
    provider: string,
    public readonly language: string,
  ) {
    super(
      provider,
      `Language "${language}" is not supported by ${provider}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
