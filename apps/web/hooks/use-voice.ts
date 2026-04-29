'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import {
  streamVoiceConversation,
  VoiceApiError,
  type VoiceAudioChunk,
} from '@/lib/voice-api';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

export type VoiceErrorSeverity = 'error' | 'warning' | 'info';

const MAX_RECORDING_MS = 60_000;
const DURATION_UPDATE_MS = 100;
const API_TIMEOUT_MS = 30_000;

const ERROR_MESSAGES: { [key: string]: string | undefined } = {
  STT_FAILED: "Couldn't understand audio. Please try again or type your message.",
  TTS_FAILED: 'Voice playback unavailable',
  TTS_ALL_PROVIDERS_FAILED: 'Voice synthesis unavailable for this sentence',
  UNSUPPORTED_LANGUAGE: 'This language is not supported for voice',
  PROVIDER_TIMEOUT: 'Voice processing timed out. Please try again.',
  PROVIDER_UNAVAILABLE: 'Voice service temporarily unavailable',
  INVALID_AUDIO: 'Audio recording was not valid. Please try again.',
  AUDIO_TOO_SHORT: 'Recording was too short. Please speak longer.',
  NO_SPEECH_DETECTED: "We couldn't make that out. Please try again from a quieter spot.",
  RATE_LIMITED: 'Too many voice requests. Please wait.',
};

const WARNING_ERROR_CODES = new Set(['TTS_FAILED', 'TTS_ALL_PROVIDERS_FAILED', 'RATE_LIMITED']);

export function getErrorSeverity(errorCode: string | null): VoiceErrorSeverity {
  if (!errorCode) return 'error';
  if (WARNING_ERROR_CODES.has(errorCode)) return 'warning';
  return 'error';
}

export interface UseVoiceOptions {
  agentId: string;
  sessionId?: string;
  source?: 'DEMO' | 'WIDGET';
  onTranscription?: (text: string, language: string) => void;
  onResponse?: (reply: string, sessionId: string) => void;
  /** Called per sentence as audio chunks arrive — use to progressively display text in sync with audio */
  onResponseTextChunk?: (sentenceText: string, sentenceIndex: number) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceReturn {
  voiceState: VoiceState;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  stopPlayback: () => void;
  clearError: () => void;
  recordingDurationMs: number;
  error: string | null;
  errorCode: string | null;
  isSupported: boolean;
}

function detectMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return undefined;
}

function mapErrorToMessage(err: unknown): { message: string; errorCode: string | null } {
  if (err instanceof VoiceApiError) {
    const mapped = err.errorCode ? ERROR_MESSAGES[err.errorCode] : undefined;
    if (mapped) {
      return { message: mapped, errorCode: err.errorCode };
    }
    if (err.status === 429) {
      return { message: 'Too many voice requests. Please wait.', errorCode: 'RATE_LIMITED' };
    }
    if (err.status === 504) {
      return { message: 'Voice processing timed out. Please try again.', errorCode: 'PROVIDER_TIMEOUT' };
    }
    return { message: "Couldn't understand audio. Please try again or type your message.", errorCode: err.errorCode };
  }
  if (err instanceof TypeError) {
    return { message: 'Connection issue. Please try again.', errorCode: 'NETWORK_ERROR' };
  }
  return { message: 'Voice processing failed. Please try again.', errorCode: null };
}

/**
 * Manages a queue of base64 audio chunks, playing them sequentially.
 * Each chunk is decoded, converted to an Audio element, and played in order.
 */
class AudioPlaybackQueue {
  private queue: { audio: string; format: string }[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private playing = false;
  private stopped = false;
  private onFinished: (() => void) | null = null;
  private streamComplete = false;

  constructor(onFinished: () => void) {
    this.onFinished = onFinished;
  }

  enqueue(audio: string, audioFormat: string) {
    if (this.stopped) return;
    this.queue.push({ audio, format: audioFormat });
    if (!this.playing) {
      this.playNext();
    }
  }

  markStreamComplete() {
    this.streamComplete = true;
    // If nothing is playing and queue is empty, we're done
    if (!this.playing && this.queue.length === 0) {
      this.onFinished?.();
    }
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.playing = false;
  }

  private playNext() {
    if (this.stopped) return;

    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      if (this.streamComplete) {
        this.onFinished?.();
      }
      return;
    }

    this.playing = true;
    try {
      const format = item.format.startsWith('audio/') ? item.format : `audio/${item.format}`;
      const byteChars = atob(item.audio);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: format });
      const url = URL.createObjectURL(blob);
      this.currentUrl = url;

      const audio = new Audio();
      this.currentAudio = audio;

      audio.onended = () => {
        this.revokeCurrentUrl();
        this.currentAudio = null;
        this.playNext();
      };

      audio.onerror = () => {
        this.revokeCurrentUrl();
        this.currentAudio = null;
        this.playNext();
      };

      // Wait for audio to buffer before playing — prevents first word cutoff
      audio.oncanplaythrough = () => {
        if (this.stopped) return;
        audio.play().catch(() => {
          this.revokeCurrentUrl();
          this.currentAudio = null;
          this.playNext();
        });
      };

      audio.src = url;
    } catch {
      this.revokeCurrentUrl();
      this.currentAudio = null;
      this.playNext();
    }
  }

  private revokeCurrentUrl() {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }
}

export function useVoice({
  agentId,
  sessionId,
  source,
  onTranscription,
  onResponse,
  onResponseTextChunk,
  onError,
}: UseVoiceOptions): UseVoiceReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSupported] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  });

  const voiceStateRef = useRef<VoiceState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackQueueRef = useRef<AudioPlaybackQueue | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOutRef = useRef(false);
  const activeMimeRef = useRef<string>('audio/webm');

  const onTranscriptionRef = useRef(onTranscription);
  const onResponseRef = useRef(onResponse);
  const onResponseTextChunkRef = useRef(onResponseTextChunk);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  useEffect(() => { onResponseTextChunkRef.current = onResponseTextChunk; }, [onResponseTextChunk]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const setVoiceStateSynced = useCallback((state: VoiceState) => {
    voiceStateRef.current = state;
    setVoiceState(state);
  }, []);

  const cleanup = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    abortRef.current?.abort();
    abortRef.current = null;
    playbackQueueRef.current?.stop();
    playbackQueueRef.current = null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const setErrorWithAutoDismiss = useCallback((msg: string, code: string | null, dismissMs?: number) => {
    setError(msg);
    setErrorCode(code);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    const severity = getErrorSeverity(code);
    const timeout = dismissMs ?? (severity === 'warning' ? 5_000 : 8_000);
    errorTimerRef.current = setTimeout(() => {
      setError(null);
      setErrorCode(null);
      errorTimerRef.current = null;
    }, timeout);
  }, []);

  const handleApiCall = useCallback(async (audioBlob: Blob) => {
    setVoiceStateSynced('processing');

    const controller = new AbortController();
    abortRef.current = controller;
    timedOutRef.current = false;

    timeoutRef.current = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, API_TIMEOUT_MS);

    let receivedFirstAudio = false;
    let fullResponseText = '';
    let responseSessionId = sessionIdRef.current ?? '';

    // Create playback queue — transitions to 'idle' when all audio finishes
    const queue = new AudioPlaybackQueue(() => {
      playbackQueueRef.current = null;
      setVoiceStateSynced('idle');
    });
    playbackQueueRef.current = queue;

    try {
      const result = await streamVoiceConversation({
        audio: audioBlob,
        agentId,
        sessionId: sessionIdRef.current,
        source,
        signal: controller.signal,
        callbacks: {
          onTranscription: (text: string) => {
            onTranscriptionRef.current?.(text, '');
            // Drop out of 'processing' as soon as the transcript lands so the user
            // never sits looking at "Transcribing…" while we wait for the bot's audio.
            // Audio chunks arriving next flip state to 'playing' independently.
            setVoiceStateSynced('idle');
          },
          onAudioChunk: (chunk: VoiceAudioChunk) => {
            if (!receivedFirstAudio) {
              receivedFirstAudio = true;
              setVoiceStateSynced('playing');
            }
            // Deliver sentence text in sync with audio so UI shows text as voice plays
            if (chunk.text) {
              onResponseTextChunkRef.current?.(chunk.text, chunk.sentenceIndex);
            }
            queue.enqueue(chunk.audio, chunk.audioFormat);
          },
          onComplete: (fullText: string) => {
            fullResponseText = fullText;
            queue.markStreamComplete();
          },
          onError: (errCode: string, message: string) => {
            const mapped = ERROR_MESSAGES[errCode] ?? message;
            setErrorWithAutoDismiss(mapped, errCode);
            Sentry.captureMessage('Voice streaming error', {
              level: 'warning',
              extra: { agentId, errorCode: errCode, message },
            });
          },
        },
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (controller.signal.aborted) return;

      responseSessionId = result.sessionId ?? responseSessionId;

      // Deliver text callbacks
      if (fullResponseText) {
        onResponseRef.current?.(fullResponseText, responseSessionId);
      }

      // If no audio was received at all, go idle
      if (!receivedFirstAudio) {
        queue.markStreamComplete();
        if (fullResponseText) {
          // Text-only response (TTS failed for all sentences)
          setVoiceStateSynced('idle');
        }
      }
    } catch (err) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      queue.stop();
      playbackQueueRef.current = null;

      if (err instanceof DOMException && err.name === 'AbortError') {
        if (timedOutRef.current) {
          const msg = 'Voice processing timed out. Please try again.';
          setErrorWithAutoDismiss(msg, 'PROVIDER_TIMEOUT');
          onErrorRef.current?.(msg);
          Sentry.captureMessage('Voice API frontend timeout', {
            level: 'error',
            extra: { agentId, timeoutMs: API_TIMEOUT_MS, voiceState: voiceStateRef.current },
          });
          setVoiceStateSynced('idle');
        }
        return;
      }

      const { message, errorCode: code } = mapErrorToMessage(err);
      setErrorWithAutoDismiss(message, code);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');

      Sentry.captureMessage('Voice API call failed', {
        level: 'error',
        extra: {
          agentId,
          errorCode: code,
          errorType: code === 'NETWORK_ERROR' ? 'network_failure' : 'api_failure',
          voiceState: voiceStateRef.current,
          status: err instanceof VoiceApiError ? err.status : undefined,
        },
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [agentId, source, setErrorWithAutoDismiss, setVoiceStateSynced]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (voiceStateRef.current !== 'idle') return;

    if (!isSupported) {
      const msg = 'Voice is not supported in this browser.';
      setErrorWithAutoDismiss(msg, null);
      onErrorRef.current?.(msg);
      return;
    }

    setError(null);
    setErrorCode(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = detectMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      activeMimeRef.current = recorder.mimeType || 'audio/webm';
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const actualMime = activeMimeRef.current;
        const blob = new Blob(chunksRef.current, { type: actualMime });
        chunksRef.current = [];

        if (blob.size > 0) {
          handleApiCall(blob);
        } else {
          setVoiceStateSynced('idle');
        }
      };

      recorder.start();
      setVoiceStateSynced('listening');
      setRecordingDurationMs(0);

      const startTime = Date.now();
      durationTimerRef.current = setInterval(() => {
        setRecordingDurationMs(Date.now() - startTime);
      }, DURATION_UPDATE_MS);

      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (err) {
      let message = 'Voice processing failed. Please try again.';
      let code: string | null = null;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        message = 'Microphone access denied. Please allow microphone in your browser settings.';
      } else {
        Sentry.captureException(err, {
          extra: { agentId, voiceState: voiceStateRef.current, operation: 'startRecording' },
        });
        code = 'RECORDING_FAILED';
      }
      setErrorWithAutoDismiss(message, code);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
    }
  }, [isSupported, handleApiCall, stopRecording, setErrorWithAutoDismiss, setVoiceStateSynced, agentId]);

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current?.stop();
    playbackQueueRef.current = null;
    setVoiceStateSynced('idle');
  }, [setVoiceStateSynced]);

  useEffect(() => {
    return () => {
      cleanup();
      playbackQueueRef.current?.stop();
      playbackQueueRef.current = null;
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, [cleanup]);

  return {
    voiceState,
    startRecording,
    stopRecording,
    stopPlayback,
    clearError,
    recordingDurationMs,
    error,
    errorCode,
    isSupported,
  };
}
