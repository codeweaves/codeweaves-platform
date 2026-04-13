import { apiUrl } from '@/config/api';

export interface VoiceConversationResponse {
  transcription: {
    text: string;
    detectedLanguage: string;
    confidence: number;
  };
  response: {
    text: string;
    audio: string | null;
    audioFormat: string | null;
    audioDurationMs: number | null;
  };
  sessionId: string;
  messageId: string;
  metrics: {
    sttLatencyMs: number;
    aiLatencyMs: number;
    ttsLatencyMs: number;
    totalLatencyMs: number;
  };
  ttsError?: {
    errorCode: string;
    message: string;
  };
}

// Streaming voice chunk types (matches backend VoiceStreamChunk)
export interface VoiceAudioChunk {
  type: 'audio';
  sentenceIndex: number;
  text: string;
  audio: string; // base64
  audioFormat: string;
  audioDurationMs: number | null;
  ttsLatencyMs: number;
}

export interface VoiceEndChunk {
  type: 'end';
  fullText: string;
  totalSentences: number;
}

export interface VoiceTranscriptionChunk {
  type: 'transcription';
  text: string;
  detectedLanguage: string;
  confidence: number;
  sttLatencyMs: number;
}

export interface VoiceErrorChunk {
  type: 'error';
  errorCode: string;
  message: string;
  sentenceIndex?: number;
}

export type VoiceStreamChunk = VoiceTranscriptionChunk | VoiceAudioChunk | VoiceEndChunk | VoiceErrorChunk;

export interface StreamVoiceCallbacks {
  onTranscription?: (text: string) => void;
  onAudioChunk?: (chunk: VoiceAudioChunk) => void;
  onComplete?: (fullText: string, totalSentences: number) => void;
  onError?: (errorCode: string, message: string) => void;
}

export class VoiceApiError extends Error {
  status: number;
  statusText: string;
  errorCode: string | null;

  constructor(response: Response, errorCode?: string) {
    super(`Voice API error: ${response.status} ${response.statusText}`);
    this.name = 'VoiceApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.errorCode = errorCode ?? null;
  }
}

function blobExtension(blob: Blob): string {
  const type = blob.type;
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4') || type.includes('aac')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

function buildFormData(params: {
  audio: Blob;
  agentId: string;
  sessionId?: string;
  languageHint?: string;
  source?: string;
}): FormData {
  const formData = new FormData();
  const ext = blobExtension(params.audio);
  formData.append('audio', params.audio, `recording.${ext}`);
  formData.append('agentId', params.agentId);
  if (params.sessionId) formData.append('sessionId', params.sessionId);
  if (params.languageHint) formData.append('languageHint', params.languageHint);
  if (params.source) formData.append('source', params.source);
  return formData;
}

/**
 * Legacy non-streaming voice conversation.
 * Used as fallback when backend returns JSON instead of NDJSON.
 */
export async function sendVoiceConversation(params: {
  audio: Blob;
  agentId: string;
  sessionId?: string;
  languageHint?: string;
  source?: string;
  signal?: AbortSignal;
}): Promise<VoiceConversationResponse> {
  const formData = buildFormData(params);

  const response = await fetch(apiUrl('/public/voice/conversation'), {
    method: 'POST',
    body: formData,
    signal: params.signal,
  });

  if (!response.ok) {
    let errorCode: string | undefined;
    try {
      const body = await response.json();
      errorCode = body?.errorCode;
    } catch {
      // Response body not JSON — leave errorCode undefined
    }
    throw new VoiceApiError(response, errorCode);
  }

  return response.json();
}

/**
 * Streaming voice conversation — reads NDJSON audio chunks progressively.
 * Returns session/message IDs from response headers.
 */
export async function streamVoiceConversation(params: {
  audio: Blob;
  agentId: string;
  sessionId?: string;
  languageHint?: string;
  source?: string;
  signal?: AbortSignal;
  callbacks: StreamVoiceCallbacks;
}): Promise<{ sessionId: string | null; messageId: string | null }> {
  const formData = buildFormData(params);

  const response = await fetch(apiUrl('/public/voice/conversation'), {
    method: 'POST',
    headers: { Accept: 'application/x-ndjson' },
    body: formData,
    signal: params.signal,
  });

  if (!response.ok) {
    let errorCode: string | undefined;
    try {
      const body = await response.json();
      errorCode = body?.errorCode;
    } catch {
      // Response body not JSON
    }
    throw new VoiceApiError(response, errorCode);
  }

  const sessionId = response.headers.get('X-Session-Id');
  const messageId = response.headers.get('X-Message-Id');
  const contentType = response.headers.get('Content-Type') ?? '';

  // If backend returned JSON (legacy fallback), parse and map to callbacks
  if (contentType.includes('application/json')) {
    const result: VoiceConversationResponse = await response.json();
    if (result.transcription) {
      params.callbacks.onTranscription?.(result.transcription.text);
    }
    if (result.response?.audio) {
      params.callbacks.onAudioChunk?.({
        type: 'audio',
        sentenceIndex: 0,
        text: result.response.text,
        audio: result.response.audio,
        audioFormat: result.response.audioFormat ?? 'audio/mp3',
        audioDurationMs: result.response.audioDurationMs,
        ttsLatencyMs: result.metrics?.ttsLatencyMs ?? 0,
      });
    }
    if (result.response?.text) {
      params.callbacks.onComplete?.(result.response.text, 1);
    }
    if (result.ttsError) {
      params.callbacks.onError?.(result.ttsError.errorCode, result.ttsError.message);
    }
    return { sessionId: result.sessionId ?? sessionId, messageId: result.messageId ?? messageId };
  }

  // NDJSON streaming path
  const body = response.body;
  if (!body) {
    throw new Error('No response body for streaming voice');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let chunk: VoiceStreamChunk;
        try {
          chunk = JSON.parse(trimmed) as VoiceStreamChunk;
        } catch {
          continue;
        }

        switch (chunk.type) {
          case 'transcription':
            params.callbacks.onTranscription?.(chunk.text);
            break;
          case 'audio':
            params.callbacks.onAudioChunk?.(chunk);
            break;
          case 'end':
            params.callbacks.onComplete?.(chunk.fullText, chunk.totalSentences);
            break;
          case 'error':
            params.callbacks.onError?.(chunk.errorCode, chunk.message);
            break;
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as VoiceStreamChunk;
        if (chunk.type === 'transcription') params.callbacks.onTranscription?.(chunk.text);
        else if (chunk.type === 'audio') params.callbacks.onAudioChunk?.(chunk);
        else if (chunk.type === 'end') params.callbacks.onComplete?.(chunk.fullText, chunk.totalSentences);
        else if (chunk.type === 'error') params.callbacks.onError?.(chunk.errorCode, chunk.message);
      } catch {
        // ignore malformed trailing chunk
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { sessionId, messageId };
}
