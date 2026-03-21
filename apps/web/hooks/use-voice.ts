'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  sendVoiceConversation,
  VoiceApiError,
} from '@/lib/voice-api';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

const MAX_RECORDING_MS = 60_000;
const DURATION_UPDATE_MS = 100;

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
  isSupported: boolean;
}

function detectMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  // Let browser choose its default
  return undefined;
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
  const activeMimeRef = useRef<string>('audio/webm');

  // Keep callbacks in refs to avoid re-creating functions
  const onTranscriptionRef = useRef(onTranscription);
  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Keep voiceStateRef in sync for use in non-reactive callbacks
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
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    // Abort any in-flight API call
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const setErrorWithAutoDismiss = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setError(null);
      errorTimerRef.current = null;
    }, 5_000);
  }, []);

  const handleApiCall = useCallback(async (audioBlob: Blob) => {
    setVoiceStateSynced('processing');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await sendVoiceConversation({
        audio: audioBlob,
        agentId,
        sessionId: sessionIdRef.current,
        signal: controller.signal,
      });

      // If aborted while awaiting, bail out
      if (controller.signal.aborted) return;

      onTranscriptionRef.current?.(
        result.transcription.text,
        result.transcription.detectedLanguage,
      );
      onResponseRef.current?.(result.response.text, result.sessionId);

      // Play audio if available — isolate base64 decode from the above callbacks
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
          // base64 decode or audio creation failed — text response already delivered
          setVoiceStateSynced('idle');
        }
      } else {
        // No audio — text-only response (TTS disabled)
        setVoiceStateSynced('idle');
      }
    } catch (err) {
      // Ignore abort errors from unmount
      if (err instanceof DOMException && err.name === 'AbortError') return;

      let message = 'Voice processing failed. Please try again.';
      if (err instanceof VoiceApiError) {
        if (err.status === 429) {
          message = 'Too many voice requests. Please wait.';
        }
      }
      setErrorWithAutoDismiss(message);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
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
    // P1: Guard against double-click / calling while not idle
    if (voiceStateRef.current !== 'idle') return;

    if (!isSupported) {
      const msg = 'Voice is not supported in this browser.';
      setErrorWithAutoDismiss(msg);
      onErrorRef.current?.(msg);
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // P4+P5: Detect actual mimeType, let browser choose if webm unsupported
      const mimeType = detectMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      activeMimeRef.current = recorder.mimeType || 'audio/webm';
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Release mic
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

      // Duration timer
      const startTime = Date.now();
      durationTimerRef.current = setInterval(() => {
        setRecordingDurationMs(Date.now() - startTime);
      }, DURATION_UPDATE_MS);

      // Auto-stop at 60 seconds
      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (err) {
      let message = 'Voice processing failed. Please try again.';
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        message = 'Microphone access denied. Please allow microphone in your browser settings.';
      }
      setErrorWithAutoDismiss(message);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
    }
  }, [isSupported, handleApiCall, stopRecording, setErrorWithAutoDismiss, setVoiceStateSynced]);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    revokeAudioUrl();
    setVoiceStateSynced('idle');
  }, [revokeAudioUrl, setVoiceStateSynced]);

  // Cleanup on unmount
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
    isSupported,
  };
}
