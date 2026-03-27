/**
 * useVoice hook — voice recording, streaming, and playback state for the widget (Story 5-20).
 *
 * Manages the voice state machine: idle → listening → processing → playing → idle.
 * Integrates with AudioPlaybackQueue for sequential audio playback and
 * typewriter buffer for progressive text display in sync with audio.
 */

import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { AudioPlaybackQueue } from '../utils/audio-playback-queue';
import { sendVoiceMessage } from '../services/voice-client';
import type { VoiceAudioChunk } from '../services/voice-client';
import { updateSession } from '../services/session-manager';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

export type VoiceErrorSeverity = 'error' | 'warning' | 'info';

const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 500;
const DURATION_UPDATE_MS = 100;
const API_TIMEOUT_MS = 60_000;

// ── Error message mapping (matches demo page) ──

const ERROR_MESSAGES: Record<string, string> = {
  STT_FAILED: "Couldn't understand audio. Please try again or type your message.",
  TTS_FAILED: 'Voice playback unavailable',
  TTS_ALL_PROVIDERS_FAILED: 'Voice synthesis unavailable for this sentence',
  UNSUPPORTED_LANGUAGE: 'This language is not supported for voice',
  PROVIDER_TIMEOUT: 'Voice processing timed out. Please try again.',
  PROVIDER_UNAVAILABLE: 'Voice service temporarily unavailable',
  INVALID_AUDIO: 'Audio recording was not valid. Please try again.',
  AUDIO_TOO_SHORT: 'Recording was too short. Please speak longer.',
  RATE_LIMITED: 'Too many voice requests. Please wait.',
  NETWORK_ERROR: 'Connection issue. Please try again.',
};

const WARNING_CODES = new Set(['TTS_FAILED', 'TTS_ALL_PROVIDERS_FAILED', 'RATE_LIMITED']);

export function getErrorSeverity(errorCode: string | null): VoiceErrorSeverity {
  if (!errorCode) return 'error';
  if (WARNING_CODES.has(errorCode)) return 'warning';
  return 'error';
}

// ── Types ──

export interface UseVoiceOptions {
  agentId: string;
  voiceEnabled?: boolean;
  voiceLanguage?: string;
  voiceAutoPlay?: boolean;
  /** Called when transcription arrives — add user message bubble */
  onTranscription?: (text: string) => void;
  /** Called per sentence as audio chunks arrive — progressive text display */
  onAudioSentence?: (text: string, sentenceIndex: number) => void;
  /** Called when voice response completes — finalize bot message */
  onComplete?: (fullText: string) => void;
  /** Called on voice error */
  onError?: (message: string) => void;
}

export interface UseVoiceReturn {
  voiceState: VoiceState;
  isSupported: boolean;
  recordingDurationMs: number;
  error: string | null;
  errorCode: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  stopPlayback: () => void;
  clearError: () => void;
}

function detectMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return undefined;
}

/** Check if voice recording APIs are available */
function checkVoiceSupport(): boolean {
  if (typeof window === 'undefined') return false;
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function useVoice({
  agentId,
  voiceEnabled = true,
  voiceLanguage,
  voiceAutoPlay = true,
  onTranscription,
  onAudioSentence,
  onComplete,
  onError,
}: UseVoiceOptions): UseVoiceReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // D2: Reactive isSupported — updated when permissions change
  const [isSupported, setIsSupported] = useState(checkVoiceSupport);

  // Refs for voice state (avoids stale closures)
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
  const activeMimeRef = useRef('audio/webm');
  const recordStartRef = useRef(0);
  // P3: Flag to distinguish cancel from normal stop
  const cancelledRef = useRef(false);
  // P7: Flag to prevent API calls after unmount
  const mountedRef = useRef(true);

  // Stable callback refs
  const onTranscriptionRef = useRef(onTranscription);
  const onAudioSentenceRef = useRef(onAudioSentence);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onAudioSentenceRef.current = onAudioSentence; }, [onAudioSentence]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // D2: Listen for permission changes to update isSupported reactively
  useEffect(() => {
    if (typeof navigator.permissions === 'undefined') return;
    let status: PermissionStatus | null = null;
    const handleChange = () => {
      if (status?.state === 'denied') {
        setIsSupported(false);
      } else {
        setIsSupported(checkVoiceSupport());
      }
    };
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => {
      status = s;
      handleChange(); // Sync initial state
      s.addEventListener('change', handleChange);
    }).catch(() => {
      // permissions.query not supported for microphone in some browsers — ignore
    });
    return () => {
      status?.removeEventListener('change', handleChange);
    };
  }, []);

  const setVoiceStateSynced = useCallback((state: VoiceState) => {
    voiceStateRef.current = state;
    setVoiceState(state);
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

  // P7: Cleanup recording without triggering onstop → handleApiCall
  const cleanupRecording = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    // Detach onstop before stopping to prevent triggering handleApiCall during cleanup
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  const handleApiCall = useCallback(async (audioBlob: Blob) => {
    // P7: Don't fire API calls after unmount
    if (!mountedRef.current) return;

    setVoiceStateSynced('processing');

    const controller = new AbortController();
    abortRef.current = controller;
    timedOutRef.current = false;

    // P5: Single timeout here — voice-client.ts no longer has its own
    timeoutRef.current = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, API_TIMEOUT_MS);

    let receivedFirstAudio = false;

    const queue = new AudioPlaybackQueue(() => {
      playbackQueueRef.current = null;
      setVoiceStateSynced('idle');
    });
    playbackQueueRef.current = queue;

    try {
      const result = await sendVoiceMessage(
        agentId,
        audioBlob,
        {
          onTranscription: (text: string) => {
            onTranscriptionRef.current?.(text);
          },
          onAudioChunk: (chunk: VoiceAudioChunk) => {
            if (!receivedFirstAudio) {
              receivedFirstAudio = true;
              // P4: Only transition to 'playing' when autoPlay is on
              if (voiceAutoPlay) {
                setVoiceStateSynced('playing');
              }
            }
            if (chunk.text) {
              onAudioSentenceRef.current?.(chunk.text, chunk.sentenceIndex);
            }
            if (voiceAutoPlay) {
              queue.enqueue(chunk.audio, chunk.audioFormat);
            }
          },
          onComplete: (fullText: string) => {
            onCompleteRef.current?.(fullText);
            queue.markStreamComplete();

            // If no audio was received or autoPlay is off, go idle immediately
            if (!receivedFirstAudio || !voiceAutoPlay) {
              setVoiceStateSynced('idle');
            }
          },
          onError: (errCode: string, message: string) => {
            const mapped = ERROR_MESSAGES[errCode] ?? message;
            setErrorWithAutoDismiss(mapped, errCode);
          },
        },
        controller.signal,
        undefined,
        voiceLanguage,
      );

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (controller.signal.aborted) return;

      // Update session if returned
      if (result.sessionId) {
        updateSession(agentId, result.sessionId);
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
        }
        // P1: Always reset to idle on any abort (timeout or external)
        setVoiceStateSynced('idle');
        return;
      }

      const msg = err instanceof TypeError
        ? 'Connection issue. Please try again.'
        : 'Voice processing failed. Please try again.';
      const code = err instanceof TypeError ? 'NETWORK_ERROR' : null;
      setErrorWithAutoDismiss(msg, code);
      onErrorRef.current?.(msg);
      setVoiceStateSynced('idle');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [agentId, voiceLanguage, voiceAutoPlay, setErrorWithAutoDismiss, setVoiceStateSynced]);

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

  // P3: Cancel recording — discard audio, don't send to API
  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    stopRecording();
  }, [stopRecording]);

  const startRecording = useCallback(async () => {
    if (voiceStateRef.current !== 'idle') return;
    if (!isSupported || !voiceEnabled) return;

    // P3: Reset cancelled flag
    cancelledRef.current = false;
    clearError();

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

        // P3: If cancelled, discard recording and go idle
        if (cancelledRef.current) {
          chunksRef.current = [];
          setVoiceStateSynced('idle');
          return;
        }

        const elapsed = Date.now() - recordStartRef.current;
        const blob = new Blob(chunksRef.current, { type: activeMimeRef.current });
        chunksRef.current = [];

        if (elapsed < MIN_RECORDING_MS || blob.size === 0) {
          setErrorWithAutoDismiss('Hold longer to record', null, 3_000);
          setVoiceStateSynced('idle');
          return;
        }

        handleApiCall(blob);
      };

      recorder.start();
      recordStartRef.current = Date.now();
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
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        message = 'Microphone access denied. Please allow microphone in your browser settings.';
      }
      setErrorWithAutoDismiss(message, null);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
    }
  }, [isSupported, voiceEnabled, handleApiCall, stopRecording, clearError, setErrorWithAutoDismiss, setVoiceStateSynced]);

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current?.stop();
    playbackQueueRef.current = null;
    setVoiceStateSynced('idle');
  }, [setVoiceStateSynced]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // P7: Mark unmounted to prevent API calls from onstop
      mountedRef.current = false;
      cleanupRecording();
      abortRef.current?.abort();
      abortRef.current = null;
      playbackQueueRef.current?.stop();
      playbackQueueRef.current = null;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [cleanupRecording]);

  return {
    voiceState,
    isSupported,
    recordingDurationMs,
    error,
    errorCode,
    startRecording,
    stopRecording,
    cancelRecording,
    stopPlayback,
    clearError,
  };
}
