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
  text: string;
  audio: string; // base64-encoded
  audioFormat: string;
  audioDurationMs: number | null;
  ttsLatencyMs: number;
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
