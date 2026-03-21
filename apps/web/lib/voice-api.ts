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

export async function sendVoiceConversation(params: {
  audio: Blob;
  agentId: string;
  sessionId?: string;
  languageHint?: string;
  signal?: AbortSignal;
}): Promise<VoiceConversationResponse> {
  const formData = new FormData();
  const ext = blobExtension(params.audio);
  formData.append('audio', params.audio, `recording.${ext}`);
  formData.append('agentId', params.agentId);
  if (params.sessionId) formData.append('sessionId', params.sessionId);
  if (params.languageHint) formData.append('languageHint', params.languageHint);

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
