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
// VoiceProvider Interface
// ============================================

export interface VoiceProvider {
  readonly name: string;
  readonly supportedLanguages: SupportedLanguage[];

  transcribe(request: STTRequest): Promise<STTResponse>;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  detectLanguage(audio: Buffer, audioFormat: string): Promise<LanguageDetectionResponse>;
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
