'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import {
  sendVoiceConversation,
  VoiceApiError,
} from '@/lib/voice-api';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

export type VoiceErrorSeverity = 'error' | 'warning' | 'info';

const MAX_RECORDING_MS = 60_000;
const DURATION_UPDATE_MS = 100;
const API_TIMEOUT_MS = 30_000;

const ERROR_MESSAGES: { [key: string]: string | undefined } = {
  STT_FAILED: "Couldn't understand audio. Please try again or type your message.",
  TTS_FAILED: 'Voice playback unavailable',
  UNSUPPORTED_LANGUAGE: 'This language is not supported for voice',
  PROVIDER_TIMEOUT: 'Voice processing timed out. Please try again.',
  PROVIDER_UNAVAILABLE: 'Voice service temporarily unavailable',
  INVALID_AUDIO: 'Audio recording was not valid. Please try again.',
  AUDIO_TOO_SHORT: 'Recording was too short. Please speak longer.',
  RATE_LIMITED: 'Too many voice requests. Please wait.',
};

const WARNING_ERROR_CODES = new Set(['TTS_FAILED', 'RATE_LIMITED']);

export function getErrorSeverity(errorCode: string | null): VoiceErrorSeverity {
  if (!errorCode) return 'error';
  if (WARNING_ERROR_CODES.has(errorCode)) return 'warning';
  return 'error';
}

export interface UseVoiceOptions {
  agentId: string;
  sessionId?: string;
  onTranscription?: (text: string, language: string) => void;
  onResponse?: (reply: string, sessionId: string) => void;
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

export function useVoice({
  agentId,
  sessionId,
  onTranscription,
  onResponse,
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOutRef = useRef(false);
  const activeMimeRef = useRef<string>('audio/webm');

  const onTranscriptionRef = useRef(onTranscription);
  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const setVoiceStateSynced = useCallback((state: VoiceState) => {
    voiceStateRef.current = state;
    setVoiceState(state);
  }, []);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
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

    // Frontend timeout: abort after 30s
    timeoutRef.current = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, API_TIMEOUT_MS);

    try {
      const result = await sendVoiceConversation({
        audio: audioBlob,
        agentId,
        sessionId: sessionIdRef.current,
        signal: controller.signal,
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (controller.signal.aborted) return;

      // Always deliver text response if available
      if (result.transcription) {
        onTranscriptionRef.current?.(
          result.transcription.text,
          result.transcription.detectedLanguage,
        );
      }
      if (result.response?.text) {
        onResponseRef.current?.(result.response.text, result.sessionId);
      }

      // Handle TTS error (graceful degradation — text was still delivered)
      if (result.ttsError) {
        const msg = (result.ttsError.errorCode && ERROR_MESSAGES[result.ttsError.errorCode]) || 'Voice playback unavailable';
        setErrorWithAutoDismiss(msg, result.ttsError.errorCode);
        Sentry.captureMessage('Voice TTS failed (graceful degradation)', {
          level: 'warning',
          extra: { agentId, errorCode: result.ttsError.errorCode, voiceState: 'processing' },
        });
      }

      // Play audio if available
      if (result.response.audio && result.response.audioFormat) {
        try {
          const format = result.response.audioFormat.replace('audio/', '');
          const byteChars = atob(result.response.audio);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
          }
          const responseAudioBlob = new Blob([byteArray], { type: `audio/${format}` });
          const audioUrl = URL.createObjectURL(responseAudioBlob);
          audioUrlRef.current = audioUrl;
          const audio = new Audio(audioUrl);

          audio.onended = () => {
            revokeAudioUrl();
            audioRef.current = null;
            setVoiceStateSynced('idle');
          };

          audio.onerror = () => {
            revokeAudioUrl();
            audioRef.current = null;
            setVoiceStateSynced('idle');
          };

          audioRef.current = audio;
          setVoiceStateSynced('playing');
          audio.play().catch(() => {
            revokeAudioUrl();
            audioRef.current = null;
            setVoiceStateSynced('idle');
          });
        } catch {
          revokeAudioUrl();
          setVoiceStateSynced('idle');
        }
      } else {
        setVoiceStateSynced('idle');
      }
    } catch (err) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Distinguish timeout abort from unmount abort
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
        // Unmount abort — silently ignore
        return;
      }

      const { message, errorCode: code } = mapErrorToMessage(err);
      setErrorWithAutoDismiss(message, code);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');

      // Report to Sentry (not for permission denied or unsupported browser)
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
  }, [agentId, setErrorWithAutoDismiss, setVoiceStateSynced, revokeAudioUrl]);

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
        // Permission denied is user choice — NOT reported to Sentry (AC #7: 6.3)
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    revokeAudioUrl();
    setVoiceStateSynced('idle');
  }, [revokeAudioUrl, setVoiceStateSynced]);

  useEffect(() => {
    return () => {
      cleanup();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      revokeAudioUrl();
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, [cleanup, revokeAudioUrl]);

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
