/**
 * Voice validation schemas
 * Zod schemas for voice-related input validation
 */
import { z } from 'zod';

// ============================================
// Voice Error Codes
// ============================================

export const voiceErrorCodes = {
  STT_FAILED: 'STT_FAILED',
  TTS_FAILED: 'TTS_FAILED',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_AUDIO: 'INVALID_AUDIO',
  AUDIO_TOO_SHORT: 'AUDIO_TOO_SHORT',
  /** STT processed normal-length audio but couldn't extract clear speech.
   *  Usually background noise/static, mic too quiet, or mumbled input. */
  NO_SPEECH_DETECTED: 'NO_SPEECH_DETECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  RECORDING_FAILED: 'RECORDING_FAILED',
} as const;

export type VoiceErrorCode = (typeof voiceErrorCodes)[keyof typeof voiceErrorCodes];

// ============================================
// Voice Provider Enum
// ============================================

export const voiceProviderEnum = z.enum(['sarvam', 'deepgram', 'elevenlabs']);
export type VoiceProviderEnum = z.infer<typeof voiceProviderEnum>;

export const ttsProviderEnum = z.enum(['sarvam', 'elevenlabs']);
export type TtsProviderEnum = z.infer<typeof ttsProviderEnum>;

// ============================================
// Supported Language Enum
// ============================================

export const supportedLanguageEnum = z.enum(['en', 'hi', 'mr', 'hinglish']);
export type SupportedLanguageEnum = z.infer<typeof supportedLanguageEnum>;

// ============================================
// Voice Configuration Schema
// ============================================

export const voiceConfigSchema = z.object({
  sttEnabled: z.boolean().default(true),
  ttsEnabled: z.boolean().default(true),
  sttProvider: voiceProviderEnum.optional(),
  ttsProvider: ttsProviderEnum.optional(),
  defaultLanguage: supportedLanguageEnum.default('en'),
  supportedLanguages: z.array(supportedLanguageEnum).default(['en']),
  ttsVoiceId: z.string().max(255).optional(),
  ttsSpeed: z.number().min(0.5).max(2.0).default(1.0),
  autoDetectLanguage: z.boolean().default(true),
  /**
   * Per-agent rollout flag for WebSocket streaming TTS. When `true`,
   * VoiceService.streamingTTS uses `provider.synthesizeStream()` if the
   * resolved provider implements it; falls back to batch `synthesize()`
   * otherwise. Defaults to `false` so existing agents keep the
   * (predictable, well-tested) batch behaviour until manually flipped.
   * Expected gain: ~300-800ms per sentence of audio latency.
   */
  ttsStreaming: z.boolean().default(false),
});

export type VoiceConfigDto = z.infer<typeof voiceConfigSchema>;

// ============================================
// Voice Conversation Schema
// ============================================

export const voiceConversationSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required').max(128, 'Agent ID must be at most 128 characters'),
  deviceId: z.string().max(128, 'Device ID must be at most 128 characters').optional(),
  sessionId: z.string().max(128, 'Session ID must be at most 128 characters').optional(),
  languageHint: supportedLanguageEnum.optional(),
  source: z.enum(['DEMO', 'WIDGET', 'WHATSAPP']).optional(),
});

export type VoiceConversationDto = z.infer<typeof voiceConversationSchema>;

// ============================================
// Transcribe Schema
// ============================================

export const transcribeSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required').max(128, 'Agent ID must be at most 128 characters'),
  languageHint: supportedLanguageEnum.optional(),
});

export type TranscribeDto = z.infer<typeof transcribeSchema>;

// ============================================
// Synthesize Schema
// ============================================

export const synthesizeSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').max(5000, 'Text must be at most 5000 characters'),
  language: supportedLanguageEnum,
  voiceId: z.string().max(255).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  agentId: z.string().min(1, 'Agent ID is required').max(128, 'Agent ID must be at most 128 characters'),
});

export type SynthesizeDto = z.infer<typeof synthesizeSchema>;

// ============================================
// Voice Catalog (List + Preview) Schemas
// ============================================

export const voiceListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Display-only language hint (e.g. "en", "ta"). Looser than supportedLanguageEnum because
  // providers may surface languages we don't expose in agent config (e.g. Tamil).
  languages: z.array(z.string()).optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  category: z.string().optional(),
  previewUrl: z.string().url().optional(),
});

export type VoiceListItemDto = z.infer<typeof voiceListItemSchema>;

export const voiceProviderListSchema = z.object({
  provider: ttsProviderEnum,
  voices: z.array(voiceListItemSchema),
});

export type VoiceProviderListDto = z.infer<typeof voiceProviderListSchema>;

export const voiceListResponseSchema = z.object({
  providers: z.array(voiceProviderListSchema),
});

export type VoiceListResponseDto = z.infer<typeof voiceListResponseSchema>;

export const voicePreviewRequestSchema = z.object({
  provider: ttsProviderEnum,
  voiceId: z.string().min(1, 'Voice ID is required').max(255),
  language: supportedLanguageEnum.optional(),
});

export type VoicePreviewRequestDto = z.infer<typeof voicePreviewRequestSchema>;
