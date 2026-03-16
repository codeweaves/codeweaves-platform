/**
 * Voice validation schemas
 * Zod schemas for voice-related input validation
 */
import { z } from 'zod';

// ============================================
// Voice Provider Enum
// ============================================

export const voiceProviderEnum = z.enum(['sarvam', 'deepgram', 'elevenlabs']);
export type VoiceProviderEnum = z.infer<typeof voiceProviderEnum>;

// ============================================
// Supported Language Enum
// ============================================

export const supportedLanguageEnum = z.enum(['en', 'hi', 'mr', 'hinglish']);
export type SupportedLanguageEnum = z.infer<typeof supportedLanguageEnum>;

// ============================================
// Voice Configuration Schema
// ============================================

export const voiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sttEnabled: z.boolean().default(true),
  ttsEnabled: z.boolean().default(true),
  sttProvider: voiceProviderEnum.optional(),
  ttsProvider: voiceProviderEnum.optional(),
  defaultLanguage: supportedLanguageEnum.default('en'),
  supportedLanguages: z.array(supportedLanguageEnum).default(['en']),
  ttsVoiceId: z.string().max(255).optional(),
  ttsSpeed: z.number().min(0.5).max(2.0).default(1.0),
  autoDetectLanguage: z.boolean().default(true),
});

export type VoiceConfigDto = z.infer<typeof voiceConfigSchema>;

// ============================================
// Voice Conversation Schema
// ============================================

export const voiceConversationSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  deviceId: z.string().max(128, 'Device ID must be at most 128 characters').optional(),
  sessionId: z.string().max(128, 'Session ID must be at most 128 characters').optional(),
  languageHint: supportedLanguageEnum.optional(),
});

export type VoiceConversationDto = z.infer<typeof voiceConversationSchema>;

// ============================================
// Transcribe Schema
// ============================================

export const transcribeSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
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
  agentId: z.string().uuid('Invalid agent ID'),
});

export type SynthesizeDto = z.infer<typeof synthesizeSchema>;
