export interface VoiceTranscriptionChunk {
  type: 'transcription';
  text: string;
  detectedLanguage: string;
  confidence: number;
  sttLatencyMs: number;
}

export interface VoiceAudioChunk {
  type: 'audio';
  sentenceIndex: number;
  /** 0-based index within a sentence. On batch HTTP this is always 0 and
   *  `isFinalChunk` is true. On WebSocket streaming the same sentence emits
   *  multiple `audio` events with subChunkIndex 0..N-1; clients play them in
   *  order via the existing audio queue. */
  subChunkIndex: number;
  /** True on the last chunk of a sentence. Always true for batch HTTP. For
   *  WebSocket the last chunk arrives when the provider signals completion. */
  isFinalChunk: boolean;
  text: string;
  audio: string; // base64-encoded
  /** MIME type. Batch path returns 'audio/mpeg' / 'audio/wav'. Streaming
   *  path returns 'audio/pcm; rate=<N>' (raw PCM samples 16-bit signed LE),
   *  which is the only format that's independently playable per chunk on
   *  every browser without MediaSource Extensions. */
  audioFormat: string;
  audioDurationMs: number | null;
  /** Wall-clock from when this sentence's TTS request started to when this
   *  CHUNK was ready to send. On the first chunk this equals the perceptual
   *  "audio started arriving" latency; on subsequent chunks it grows
   *  monotonically toward sentence-end time. */
  ttsLatencyMs: number;
  /** Which transport was used: 'http' (batch) or 'websocket' (streaming).
   *  Lets analytics compare apples-to-apples per sentence. Optional so older
   *  consumers ignore it. */
  ttsProtocol?: 'http' | 'websocket';
  /** Streaming-only, set on FIRST CHUNK only: time-to-first-chunk from
   *  request start (the perceptual "when audio could have started playing"
   *  number — server-side, before any client-side delivery delay). */
  wsFirstChunkLatencyMs?: number;
  /** Streaming-only, set on FINAL CHUNK only: total chunks the provider sent
   *  for this sentence (1..N). */
  wsChunkCount?: number;
  /** Streaming-only, set on FINAL CHUNK only: total bytes of audio across
   *  all chunks of this sentence. */
  wsTotalBytes?: number;
}

export interface VoiceEndChunk {
  type: 'end';
  fullText: string;
  totalSentences: number;
}

export interface VoiceErrorChunk {
  type: 'error';
  errorCode: string;
  message: string;
  sentenceIndex?: number;
}

export type VoiceStreamChunk = VoiceTranscriptionChunk | VoiceAudioChunk | VoiceEndChunk | VoiceErrorChunk;
