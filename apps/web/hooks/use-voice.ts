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
// IDLE timeout: give up only if NO stream activity arrives for this long. It is
// RE-ARMED on every chunk (see armIdleTimeout below), so a long reply is never
// aborted while audio is still coming through. (Previously this was a fixed 30s
// deadline on the whole request, which cut long replies off mid-playback and
// showed a false "Voice processing timed out".) Sits above the server's own 25s
// idle watchdog so the server's typed error chunk wins the race.
const IDLE_TIMEOUT_MS = 30_000;
// The wait for the FIRST audio chunk needs a wider window than a mid-stream gap:
// the LLM has to produce a sentence and its TTS has to return bytes, and a
// provider that times out its WebSocket before falling back to batch HTTP stacks
// onto that. Real turns have taken 32s to first audio and then finished fine.
const FIRST_CHUNK_TIMEOUT_MS = 50_000;
// Absolute ceiling on one voice turn, never re-armed. The idle timers above only
// catch a stream that goes QUIET; a stream that keeps trickling chunks would
// renew them forever. The server has its own 180s ceiling, so this only fires if
// that fails to — hence the margin above it.
const HARD_DEADLINE_MS = 200_000;

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
/**
 * AudioPlaybackQueue (demo page) — same Web Audio API approach as the widget
 * for gap-free playback of many small WS-streamed PCM chunks.
 *
 * Two decoder paths kept in lockstep with the widget queue:
 *   - PCM (`audio/pcm; rate=N`): WS streaming path. Raw 16-bit signed LE
 *     samples → AudioBuffer via createBuffer. No decoder state, independent
 *     per chunk, no priming silence.
 *   - Compressed (`audio/mpeg` etc): batch HTTP path. decodeAudioData()
 *     parses each chunk as a complete file. MP3 priming silence stripped.
 *
 * Sample-accurate scheduling via `nextScheduledTime` is what makes
 * consecutive chunks chain seamlessly with NO audible gap.
 */

const FIRST_CHUNK_LOOKAHEAD_SEC = 0.25;

function parsePcmSampleRate(mimeType: string): number | null {
  if (!mimeType || !mimeType.toLowerCase().startsWith('audio/pcm')) return null;
  const m = mimeType.match(/rate\s*=\s*(\d+)/i);
  return m ? parseInt(m[1] ?? '', 10) : 24000;
}

function pcmToAudioBuffer(ctx: AudioContext, base64: string, sampleRate: number): AudioBuffer {
  const byteChars = atob(base64);
  const sampleCount = Math.floor(byteChars.length / 2);
  const buf = ctx.createBuffer(1, sampleCount, sampleRate);
  const channel = buf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    const lo = byteChars.charCodeAt(i * 2);
    const hi = byteChars.charCodeAt(i * 2 + 1);
    const u16 = (hi << 8) | lo;
    const s16 = u16 >= 0x8000 ? u16 - 0x10000 : u16;
    channel[i] = s16 / 32768;
  }
  return buf;
}

function findLeadingSilence(audioBuffer: AudioBuffer): number {
  const channels: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const len = channels[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    for (const data of channels) {
      if (Math.abs(data[i] ?? 0) > 1e-4) {
        return i / audioBuffer.sampleRate;
      }
    }
  }
  return audioBuffer.duration;
}

class AudioPlaybackQueue {
  private queue: { audio: string; format: string }[] = [];
  private audioContext: AudioContext | null = null;
  private nextScheduledTime = 0;
  private inFlightSources: AudioBufferSourceNode[] = [];
  private worker: Promise<void> | null = null;
  private playing = false;
  private stopped = false;
  private onFinished: (() => void) | null = null;
  private streamComplete = false;
  private resolvers: Array<() => void> = [];

  constructor(onFinished: () => void) {
    this.onFinished = onFinished;
  }

  enqueue(audio: string, audioFormat: string) {
    if (this.stopped) return;
    this.queue.push({ audio, format: audioFormat });
    const r = this.resolvers.shift();
    if (r) r();
    if (!this.playing) {
      this.playing = true;
      this.worker = this.processQueue();
    }
  }

  markStreamComplete() {
    this.streamComplete = true;
    // Wake any worker currently sleeping on a resolver — otherwise the
    // worker stays asleep waiting for chunks that won't come, onFinished
    // never fires, and the UI stays stuck on "playing" indefinitely.
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!();
    }
    if (!this.playing && this.queue.length === 0) {
      this.onFinished?.();
    }
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    for (const src of this.inFlightSources) {
      try {
        src.stop(0);
      } catch {
        // already stopped
      }
    }
    this.inFlightSources = [];
    while (this.resolvers.length > 0) this.resolvers.shift()!();
    this.playing = false;
    this.nextScheduledTime = 0;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor: typeof AudioContext = ((globalThis as any).AudioContext ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).webkitAudioContext) as typeof AudioContext;
      this.audioContext = new Ctor();
    }
    return this.audioContext;
  }

  private async processQueue(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume().catch(() => {});
    }

    try {
      while (!this.stopped) {
        const item = this.queue.shift();
        if (!item) {
          if (this.streamComplete) break;
          await new Promise<void>((resolve) => this.resolvers.push(resolve));
          continue;
        }

        try {
          let audioBuffer: AudioBuffer;
          let leadingSilence = 0;
          const pcmRate = parsePcmSampleRate(item.format);

          if (pcmRate !== null) {
            audioBuffer = pcmToAudioBuffer(ctx, item.audio, pcmRate);
          } else {
            const byteChars = atob(item.audio);
            const buffer = new ArrayBuffer(byteChars.length);
            const view = new Uint8Array(buffer);
            for (let i = 0; i < byteChars.length; i++) {
              view[i] = byteChars.charCodeAt(i);
            }
            audioBuffer = await ctx.decodeAudioData(buffer);
            leadingSilence = findLeadingSilence(audioBuffer);
          }

          if (this.stopped) break;

          const now = ctx.currentTime;
          if (this.nextScheduledTime === 0) {
            this.nextScheduledTime = now + FIRST_CHUNK_LOOKAHEAD_SEC;
          }
          const startAt = Math.max(now, this.nextScheduledTime);

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          this.inFlightSources.push(source);
          source.onended = () => {
            const idx = this.inFlightSources.indexOf(source);
            if (idx >= 0) this.inFlightSources.splice(idx, 1);
          };
          source.start(startAt, leadingSilence);
          this.nextScheduledTime = startAt + (audioBuffer.duration - leadingSilence);
        } catch {
          continue;
        }
      }
    } finally {
      this.playing = false;
      if (this.audioContext && this.nextScheduledTime > this.audioContext.currentTime) {
        const wait = (this.nextScheduledTime - this.audioContext.currentTime) * 1000;
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!this.stopped) this.onFinished?.();
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
  const hardDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (hardDeadlineRef.current) {
      clearTimeout(hardDeadlineRef.current);
      hardDeadlineRef.current = null;
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

    // Arm (and re-arm) the idle deadline. Every stream callback below pushes it
    // back out, so it only fires when the stream has genuinely stalled.
    const armIdleTimeout = (windowMs: number = IDLE_TIMEOUT_MS) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timedOutRef.current = true;
        controller.abort();
      }, windowMs);
    };
    armIdleTimeout(FIRST_CHUNK_TIMEOUT_MS);

    // Independent of the idle timers and never re-armed — see HARD_DEADLINE_MS.
    const clearStreamTimers = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (hardDeadlineRef.current) {
        clearTimeout(hardDeadlineRef.current);
        hardDeadlineRef.current = null;
      }
    };
    hardDeadlineRef.current = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, HARD_DEADLINE_MS);

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
            // The transcript landing does NOT mean the reply is close — the wait
            // for first audio starts here, so keep the long window.
            armIdleTimeout(FIRST_CHUNK_TIMEOUT_MS);
            onTranscriptionRef.current?.(text, '');
            // Drop out of 'processing' as soon as the transcript lands so the user
            // never sits looking at "Transcribing…" while we wait for the bot's audio.
            // Audio chunks arriving next flip state to 'playing' independently.
            setVoiceStateSynced('idle');
          },
          onAudioChunk: (chunk: VoiceAudioChunk) => {
            armIdleTimeout();
            // Pure metrics marker (no text AND no audio) — the server's
            // per-sentence final marker. Nothing to show or play.
            if (!chunk.audio && !chunk.text) return;

            // Deliver sentence text in sync with audio so the UI shows text as
            // the voice plays. Done BEFORE the no-audio bail-out: a sentence
            // that is nothing but a link (or an emoji) is stripped from TTS, so
            // it arrives as text with no audio — and the transcript here is
            // assembled purely from these chunks, so bailing first would lose
            // that sentence for good.
            if (chunk.text) {
              onResponseTextChunkRef.current?.(chunk.text, chunk.sentenceIndex);
            }

            // Nothing to play. createBuffer requires ≥1 sample, so enqueuing
            // empty audio would throw.
            if (!chunk.audio) return;

            if (!receivedFirstAudio) {
              receivedFirstAudio = true;
              setVoiceStateSynced('playing');
            }
            queue.enqueue(chunk.audio, chunk.audioFormat);
          },
          onComplete: (fullText: string) => {
            armIdleTimeout();
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

      clearStreamTimers();

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
      clearStreamTimers();

      queue.stop();
      playbackQueueRef.current = null;

      if (err instanceof DOMException && err.name === 'AbortError') {
        if (timedOutRef.current) {
          const msg = 'Voice processing timed out. Please try again.';
          setErrorWithAutoDismiss(msg, 'PROVIDER_TIMEOUT');
          onErrorRef.current?.(msg);
          Sentry.captureMessage('Voice API frontend timeout', {
            level: 'error',
            extra: { agentId, idleTimeoutMs: IDLE_TIMEOUT_MS, voiceState: voiceStateRef.current },
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
      // Belt and braces: both paths clear these already, but an early `return`
      // above must not leave a 200s timer holding this turn's controller — it
      // would abort a LATER turn.
      clearStreamTimers();
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
