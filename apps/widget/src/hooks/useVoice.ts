/**
 * useVoice hook — voice recording, streaming, and playback state for the widget.
 *
 * Ported from apps/web/hooks/use-voice.ts with widget-specific adaptations:
 * - Preact hooks instead of React
 * - No Sentry
 * - Uses getSessionId() from session-manager
 * - Widget-specific callbacks (onAudioSentence, onComplete)
 */

import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { AudioPlaybackQueue } from '../utils/audio-playback-queue';
import {
  streamVoiceConversation,
  VoiceApiError,
  type VoiceAudioChunk,
} from '../services/voice-client';
import { getSessionId, updateSession } from '../services/session-manager';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

export type VoiceErrorSeverity = 'error' | 'warning' | 'info';

const MAX_RECORDING_MS = 60_000;
const DURATION_UPDATE_MS = 100;
// IDLE timeout: give up only if NO stream activity arrives for this long. It is
// RE-ARMED on every chunk (see armIdleTimeout below), so an actively-streaming
// reply is never aborted mid-audio no matter how long the full answer runs.
// (Previously this was a fixed 30s deadline on the whole request, which killed
// long replies while they were still streaming and playing — surfacing a false
// "Voice processing timed out" even though audio was coming through fine.)
const IDLE_TIMEOUT_MS = 25_000;

// ── Error message mapping (matches demo page) ──

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

// ── Types ──

export interface UseVoiceOptions {
  agentId: string;
  voiceEnabled?: boolean;
  voiceAutoPlay?: boolean;
  /** Called when transcription arrives — add user message bubble */
  onTranscription?: (text: string) => void;
  /** Called per sentence as audio chunks arrive — progressive text display */
  onAudioSentence?: (text: string, sentenceIndex: number) => void;
  /** Called when voice response completes — finalize bot message */
  onComplete?: (fullText: string) => void;
  /** Called on voice error */
  onError?: (message: string) => void;
  /** Called when a handover is raised on a voice turn (caller asked for a human). */
  onHandover?: (handoverState: 'NONE' | 'REQUESTED' | 'ACTIVE_HUMAN') => void;
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
  /** Returns the live AnalyserNode for the active mic stream while recording, or null
   *  outside the listening state. Components use this to render a real-time waveform
   *  driven by actual audio levels (see VoiceRecordingBar). */
  getAnalyser: () => AnalyserNode | null;
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
  voiceEnabled = true,
  voiceAutoPlay = true,
  onTranscription,
  onAudioSentence,
  onComplete,
  onError,
  onHandover,
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
  // Web Audio plumbing for the live waveform: a MediaStreamAudioSource feeds an
  // AnalyserNode whose getByteFrequencyData() the recording bar polls each frame.
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackQueueRef = useRef<AudioPlaybackQueue | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedOutRef = useRef(false);
  const activeMimeRef = useRef<string>('audio/webm');
  // P3: Flag to distinguish cancel from normal stop
  const cancelledRef = useRef(false);

  const onTranscriptionRef = useRef(onTranscription);
  const onAudioSentenceRef = useRef(onAudioSentence);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const onHandoverRef = useRef(onHandover);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onAudioSentenceRef.current = onAudioSentence; }, [onAudioSentence]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onHandoverRef.current = onHandover; }, [onHandover]);

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
    // Tear down Web Audio analyser plumbing so the AudioContext doesn't leak across
    // recording sessions (Chrome caps the number of live AudioContexts per document).
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
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

    // Arm (and re-arm) an IDLE timeout. It fires only after IDLE_TIMEOUT_MS with
    // no stream activity; every chunk callback below re-arms it, so a healthy
    // stream is never aborted while audio is still arriving. It's cleared once
    // the stream finishes (see the clearTimeout after the await).
    const armIdleTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timedOutRef.current = true;
        controller.abort();
      }, IDLE_TIMEOUT_MS);
    };
    armIdleTimeout();

    let receivedFirstAudio = false;
    let fullResponseText = '';
    let responseSessionId = getSessionId() ?? '';

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
        sessionId: getSessionId() ?? undefined,
        // No languageHint sent — backend auto-detects via Sarvam (one-shot detect+transcribe)
        signal: controller.signal,
        callbacks: {
          onTranscription: (text: string) => {
            armIdleTimeout();
            onTranscriptionRef.current?.(text);
            // Drop out of 'processing' the instant the transcript lands so the
            // "Transcribing…" loader disappears as soon as the user sees their words.
            // Audio chunks arriving next will independently flip state to 'playing'.
            setVoiceStateSynced('idle');
          },
          onAudioChunk: (chunk: VoiceAudioChunk) => {
            armIdleTimeout();
            // Skip empty-audio chunks. The server's per-sentence final marker
            // (isFinalChunk=true) carries no audio bytes — it only exists to
            // settle metrics on the server side. Enqueuing an empty buffer
            // would throw in createBuffer (requires ≥1 sample).
            if (!chunk.audio) return;

            if (!receivedFirstAudio) {
              receivedFirstAudio = true;
              if (voiceAutoPlay) {
                setVoiceStateSynced('playing');
              }
            }
            // Deliver sentence text in sync with audio so UI shows text as voice plays
            if (chunk.text) {
              onAudioSentenceRef.current?.(chunk.text, chunk.sentenceIndex);
            }
            if (voiceAutoPlay) {
              queue.enqueue(chunk.audio, chunk.audioFormat);
            }
          },
          onComplete: (fullText: string) => {
            armIdleTimeout();
            fullResponseText = fullText;
            onCompleteRef.current?.(fullText);
            queue.markStreamComplete();

            // If no audio was received or autoPlay is off, go idle immediately
            if (!receivedFirstAudio || !voiceAutoPlay) {
              setVoiceStateSynced('idle');
            }
          },
          onHandover: (handoverState) => {
            armIdleTimeout();
            onHandoverRef.current?.(handoverState);
          },
          onError: (errCode: string, message: string) => {
            const mapped = ERROR_MESSAGES[errCode] ?? message;
            setErrorWithAutoDismiss(mapped, errCode);
            onErrorRef.current?.(mapped);
          },
        },
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (controller.signal.aborted) return;

      responseSessionId = result.sessionId ?? responseSessionId;

      // Update session if returned
      if (responseSessionId) {
        updateSession(agentId, responseSessionId);
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
          setVoiceStateSynced('idle');
        }
        return;
      }

      const { message, errorCode: code } = mapErrorToMessage(err);
      setErrorWithAutoDismiss(message, code);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [agentId, voiceAutoPlay, setErrorWithAutoDismiss, setVoiceStateSynced]);

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
    setError(null);
    setErrorCode(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Tap into the live mic stream for waveform visualization. fftSize=64 gives 32
      // frequency bins which we average into the 5 bars we render. smoothingTimeConstant
      // damps jitter so the bars don't strobe. Failure here is non-fatal — the bar
      // falls back to a CSS animation when the analyser isn't available.
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.7;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        audioSourceRef.current = source;
      } catch {
        // AudioContext unavailable (older Safari, etc.) — bar uses CSS fallback
      }

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
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        message = 'Microphone access denied. Please allow microphone in your browser settings.';
      }
      setErrorWithAutoDismiss(message, null);
      onErrorRef.current?.(message);
      setVoiceStateSynced('idle');
    }
  }, [isSupported, voiceEnabled, handleApiCall, stopRecording, setErrorWithAutoDismiss, setVoiceStateSynced]);

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

  const getAnalyser = useCallback(() => analyserRef.current, []);

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
    getAnalyser,
  };
}
