/**
 * Voice client service for the widget (Story 5-20).
 *
 * Sends voice recordings to the backend and parses NDJSON streaming responses.
 * Uses native fetch only (no external libraries — bundle size constraint).
 */

import { getDeviceId } from '../utils/device-id';
import { getSessionId } from './session-manager';

// ── NDJSON chunk types (mirrors backend voice-stream.interface.ts) ──

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

export type VoiceStreamChunk =
  | VoiceTranscriptionChunk
  | VoiceAudioChunk
  | VoiceEndChunk
  | VoiceErrorChunk;

// ── Callbacks for streaming voice response ──

export interface VoiceStreamCallbacks {
  onTranscription?: (text: string, detectedLanguage: string) => void;
  onAudioChunk?: (chunk: VoiceAudioChunk) => void;
  onComplete?: (fullText: string, totalSentences: number) => void;
  onError?: (errorCode: string, message: string) => void;
}

// ── Internal state ──

let baseUrl = '';

export function initVoiceClient(apiBaseUrl: string): void {
  baseUrl = apiBaseUrl.replace(/\/+$/, '');
}

// ── Public API ──

/**
 * Send a voice message and receive streaming NDJSON response.
 *
 * POST {baseUrl}/api/codeweaves/v1/public/voice/conversation
 * Accept: application/x-ndjson
 *
 * P5: Timeout is managed by the caller (useVoice hook) via the AbortSignal.
 * This avoids double-timeout race conditions.
 */
export async function sendVoiceMessage(
  agentId: string,
  audioBlob: Blob,
  callbacks: VoiceStreamCallbacks,
  signal?: AbortSignal,
  sessionId?: string,
  languageHint?: string,
): Promise<{ sessionId?: string }> {
  if (!baseUrl) {
    throw new Error('Voice client not initialised');
  }

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const resolvedSessionId = sessionId ?? getSessionId() ?? undefined;

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('agentId', agentId);
  if (resolvedSessionId) formData.append('sessionId', resolvedSessionId);
  if (languageHint) formData.append('languageHint', languageHint);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/x-ndjson',
      'X-Device-Id': getDeviceId(),
    };
    if (resolvedSessionId) {
      headers['X-Session-Id'] = resolvedSessionId;
    }

    const response = await fetch(`${baseUrl}/api/codeweaves/v1/public/voice/conversation`, {
      method: 'POST',
      headers,
      body: formData,
      signal,
    });

    if (!response.ok) {
      // Try to parse error body
      try {
        const errBody = await response.json();
        callbacks.onError?.(errBody.errorCode ?? 'UNKNOWN', errBody.message ?? `Voice request failed (${response.status})`);
      } catch {
        callbacks.onError?.('UNKNOWN', `Voice request failed (${response.status})`);
      }
      return {};
    }

    const contentType = response.headers.get('content-type') ?? '';
    const returnedSessionId = response.headers.get('x-session-id') ?? undefined;

    if (contentType.includes('application/x-ndjson') && response.body) {
      // Streaming NDJSON path
      await parseNdjsonStream(response.body, callbacks);
      return { sessionId: returnedSessionId };
    }

    // Legacy JSON fallback
    const json = await response.json();
    if (json.transcription) {
      callbacks.onTranscription?.(json.transcription, json.detectedLanguage ?? '');
    }
    if (json.audio) {
      callbacks.onAudioChunk?.({
        type: 'audio',
        sentenceIndex: 0,
        text: json.text ?? json.reply ?? '',
        audio: json.audio,
        audioFormat: json.audioFormat ?? 'audio/mp3',
        audioDurationMs: json.audioDurationMs ?? null,
        ttsLatencyMs: 0,
      });
    }
    callbacks.onComplete?.(json.text ?? json.reply ?? '', 1);
    return { sessionId: returnedSessionId ?? json.sessionId };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err; // Let caller handle abort
    }
    throw err;
  }
}

// ── NDJSON parser ──

async function parseNdjsonStream(
  body: ReadableStream<Uint8Array>,
  callbacks: VoiceStreamCallbacks,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        try {
          const chunk = JSON.parse(line) as VoiceStreamChunk;
          dispatchChunk(chunk, callbacks);
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process any remaining buffer
    const remaining = buffer.trim();
    if (remaining) {
      try {
        const chunk = JSON.parse(remaining) as VoiceStreamChunk;
        dispatchChunk(chunk, callbacks);
      } catch {
        // Skip malformed final chunk
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchChunk(chunk: VoiceStreamChunk, callbacks: VoiceStreamCallbacks): void {
  switch (chunk.type) {
    case 'transcription':
      callbacks.onTranscription?.(chunk.text, chunk.detectedLanguage);
      break;
    case 'audio':
      callbacks.onAudioChunk?.(chunk);
      break;
    case 'end':
      callbacks.onComplete?.(chunk.fullText, chunk.totalSentences);
      break;
    case 'error':
      callbacks.onError?.(chunk.errorCode, chunk.message);
      break;
  }
}
