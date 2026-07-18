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
  /** Optional chat session id — threaded through for observability (event_logs)
   *  when the caller has it. Providers never require it; undefined is fine. */
  sessionId?: string;
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
  /** Optional chat session id — threaded through for observability (event_logs)
   *  when the caller has it. Providers never require it; undefined is fine. */
  sessionId?: string;
}

export interface TTSResponse {
  audio: Buffer;
  audioFormat: string; // e.g., 'audio/mp3', 'audio/wav'
  durationMs?: number;
  provider: string;
  latencyMs: number;
}

/**
 * One audio chunk yielded by a streaming TTS provider. The provider opens a
 * WebSocket per sentence (or per turn), sends the text, and receives one or
 * more `TTSStreamChunk` instances as the audio is rendered. First chunks may
 * arrive in ~150-400ms vs ~600-3000ms for batch HTTP — that's the latency
 * win that justifies the extra protocol complexity.
 *
 * `audioFormat` is the SAME across all chunks of one synthesize call (i.e. the
 * provider doesn't switch formats mid-stream). `latencyMs` is wall-clock from
 * provider request to THIS chunk being received — `firstChunkLatencyMs` is
 * conceptually the same as `latencyMs` on the first chunk. Downstream code
 * (VoiceService.streamingTTS) uses the first chunk's latency as the
 * per-sentence "ttsLatencyMs" reported to clients.
 */
export interface TTSStreamChunk {
  /** Audio bytes for this chunk. Concatenating all chunks in order yields the full audio. */
  audio: Buffer;
  /** Audio MIME type; constant across all chunks of one call. */
  audioFormat: string;
  /** Wall-clock from provider request to THIS chunk being received. */
  latencyMs: number;
  /** True on the last chunk so consumers know to close their downstream stream cleanly. */
  isFinal: boolean;
  /** Provider name (for analytics / fallback bookkeeping). */
  provider: string;
}

/**
 * Per-session config passed to `openSynthesisSession`. The session keeps a
 * single WebSocket open across multiple sentences in the same voice turn,
 * avoiding the per-sentence handshake (~150-300ms) and the perceptual gap
 * between sentences that comes with opening a fresh WS each time.
 *
 * Pattern mirrors pipecat's persistent-WS Sarvam plugin + LiveKit's
 * multi-stream-input EL plugin — both keep one WS per "voice run" and
 * multiplex multiple synthesize calls on it.
 */
export interface TTSSessionConfig {
  language: SupportedLanguage;
  agentId: string;
  voiceId?: string;
  speed?: number;
  /** Optional chat session id — threaded through for observability (event_logs). */
  sessionId?: string;
}

/**
 * A persistent TTS session. Open once per voice turn, send sentences with
 * `synthesize()`, close when the turn is done. Each `synthesize()` call yields
 * audio chunks for THAT sentence only (terminated by the provider's
 * per-sentence "final" signal — Sarvam's `event_type: 'final'`, EL's
 * `isFinal: true`, etc).
 *
 * Why this matters for latency: opening a WS costs ~150-300ms (DNS + TCP + TLS
 * + auth + first server handshake). With per-sentence WS, that cost is paid N
 * times in a 5-sentence reply. With a session, it's paid once.
 */
export interface TTSSession {
  /** Provider name, for logging / metrics. */
  readonly provider: string;
  /**
   * Send a sentence to be synthesized. Yields audio chunks for THIS sentence
   * only — implementations use the provider's per-sentence terminator
   * (`event_type: 'final'` for Sarvam, `isFinal: true` for ElevenLabs).
   *
   * Calling `synthesize()` again while a previous one is still draining is
   * undefined behaviour — consumers must fully iterate one sentence's stream
   * before calling again. (VoiceService does this naturally: it awaits each
   * sentence's audio chunks before moving to the next sentence's text.)
   */
  synthesize(text: string): AsyncIterable<TTSStreamChunk>;
  /** Close the underlying connection. Safe to call multiple times. */
  close(): Promise<void>;
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
  /**
   * Optional. WebSocket / chunked streaming TTS — yields audio chunks as the
   * provider renders them, rather than waiting for the full sentence to be
   * synthesized. First chunk lands ~150-400ms after the request vs ~600-3000ms
   * for batch `synthesize()`.
   *
   * Providers that don't implement this fall back to `synthesize()` in
   * VoiceService.streamingTTS (gated by `voiceConfig.ttsStreaming`). Audio
   * format and provider behaviour are otherwise identical to batch.
   *
   * Prefer `openSynthesisSession()` for new code — the session keeps one WS
   * across multiple sentences in a turn, saving the per-sentence handshake.
   * `synthesizeStream` is kept for backward compatibility / providers that
   * can't reasonably implement a session (e.g. one-shot HTTP chunked).
   */
  synthesizeStream?(request: TTSRequest): AsyncIterable<TTSStreamChunk>;

  /**
   * Optional. Open a persistent TTS session for the duration of one voice
   * turn. The session multiplexes multiple sentences on a single WebSocket,
   * eliminating the per-sentence handshake gap that's audible to users when
   * a reply has 2+ sentences ("…Certainly." [pause] "Let me explain...").
   *
   * Implementations:
   *  - Sarvam Bulbul WS: send config once on open, then `{type:'text'}` +
   *    `{type:'flush'}` per sentence, listen for `event_type:'final'` to
   *    delimit each sentence's chunks.
   *  - ElevenLabs multi-stream-input: each sentence becomes a context with
   *    its own `context_id` on the same WS.
   *
   * Providers without a stable persistent-WS protocol can omit this and
   * VoiceService will fall back to `synthesizeStream` per-sentence, then to
   * batch `synthesize` per-sentence.
   */
  openSynthesisSession?(config: TTSSessionConfig): Promise<TTSSession>;
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
