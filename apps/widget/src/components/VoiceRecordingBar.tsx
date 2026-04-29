/**
 * VoiceRecordingBar — WhatsApp-style recording UI that replaces the message input
 * while the user is recording or transcription is in flight.
 *
 *   listening  → [Cancel] [● 0:05  ▁▃▅▃▁]              [Send]
 *   processing → [   ]    [⏳ Transcribing…]            [    ]
 *
 * Cancel discards the recording; Send stops + sends. After STT, the transcribed
 * message appears in the chat history as a normal user bubble.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { VoiceState } from '../hooks/useVoice';

export interface VoiceRecordingBarProps {
  voiceState: VoiceState;
  recordingDurationMs: number;
  onCancel: () => void;
  onSend: () => void;
  /** Send button background color (matches the send button in the regular input area). */
  sendBtnColor?: string;
  sendBtnIconColor?: string;
  /** Returns the live AnalyserNode for the active mic stream. When provided + listening,
   *  the waveform bars react to actual audio levels instead of the CSS fallback. */
  getAnalyser?: () => AnalyserNode | null;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function TrashIcon({ class: cls }: { class?: string }) {
  return (
    <svg class={cls} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ArrowUpIcon({ class: cls }: { class?: string }) {
  return (
    <svg class={cls} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function Spinner({ class: cls }: { class?: string }) {
  return (
    <svg class={`${cls ?? ''} cw-voice-spin`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

const NUM_WAVE_BARS = 50;
const MIN_BAR_PX = 2;
const MAX_BAR_PX = 28;

/** Scrolling amplitude waveform — each bar holds the loudness value from one moment
 *  in the recent past. Every animation frame we sample the current RMS amplitude of
 *  the mic, push it onto the right end, and discard the oldest sample on the left.
 *  The result is a WhatsApp-style strip that visibly moves while you talk.
 *
 *  Implementation notes:
 *  - Circular buffer (Float32Array + offset) so we never shift/splice 60×/sec.
 *  - Bar heights written to `style.height` via refs — no React state churn at 60fps.
 *  - RMS computed from getByteTimeDomainData (loudness measure, not spectrum). */
function WaveformBars({ getAnalyser }: { getAnalyser?: () => AnalyserNode | null }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!getAnalyser) return;
    let raf = 0;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;
    const history = new Float32Array(NUM_WAVE_BARS);
    let writeIdx = 0; // next slot to overwrite (oldest sample lives here)

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const analyser = getAnalyser();
      if (!analyser) return;
      if (!dataArray || dataArray.length !== analyser.fftSize) {
        dataArray = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      analyser.getByteTimeDomainData(dataArray);

      // RMS of deviation from silence (128) → 0..1 loudness
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const dev = ((dataArray[i] ?? 128) - 128) / 128;
        sumSquares += dev * dev;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      // Boost mid/quiet voice so bars show meaningful motion (otherwise everything is
      // bottom-pinned). sqrt() flattens the dynamic range pleasantly.
      const visualLevel = Math.min(1, Math.sqrt(rms) * 1.4);

      // Write into the circular buffer; advance the write head.
      history[writeIdx] = visualLevel;
      writeIdx = (writeIdx + 1) % NUM_WAVE_BARS;

      // Render: bar 0 = oldest sample (at writeIdx), bar N-1 = most recent (writeIdx-1).
      for (let i = 0; i < NUM_WAVE_BARS; i++) {
        const value = history[(writeIdx + i) % NUM_WAVE_BARS] ?? 0;
        const height = MIN_BAR_PX + value * (MAX_BAR_PX - MIN_BAR_PX);
        const bar = barRefs.current[i];
        if (bar) bar.style.height = `${height}px`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser]);

  return (
    <div
      class="cw-voice-wave flex h-8 flex-1 items-center gap-px overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: NUM_WAVE_BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => { barRefs.current[i] = el; }}
          class="cw-voice-wave-bar inline-block w-0.5 shrink-0 rounded-full bg-red-500"
          style={{ height: `${MIN_BAR_PX}px` }}
        />
      ))}
    </div>
  );
}

export function VoiceRecordingBar({
  voiceState,
  recordingDurationMs,
  onCancel,
  onSend,
  sendBtnColor = '#3b82f6',
  sendBtnIconColor = '#ffffff',
  getAnalyser,
}: VoiceRecordingBarProps) {
  const isListening = voiceState === 'listening';
  const isProcessing = voiceState === 'processing';

  return (
    <div class="cw-voice-bar flex items-center gap-2 py-1">
      {/* Cancel — disabled during transcription so we don't drop a partial result. */}
      <button
        type="button"
        onClick={onCancel}
        disabled={isProcessing}
        aria-label="Cancel recording"
        class="cw-voice-bar-cancel flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <TrashIcon class="h-4 w-4" />
      </button>

      {/* Center status panel */}
      <div class="cw-voice-bar-center flex flex-1 items-center justify-start gap-3 rounded-full bg-gray-50 px-3 py-1.5">
        {isListening && (
          <>
            <span class="cw-voice-bar-dot relative flex h-2 w-2">
              <span class="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-75" />
              <span class="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span class="cw-voice-bar-timer text-sm font-medium tabular-nums text-gray-700">
              {formatDuration(recordingDurationMs)}
            </span>
            <WaveformBars getAnalyser={getAnalyser} />
          </>
        )}
        {isProcessing && (
          <>
            <Spinner class="text-gray-500" />
            <span class="cw-voice-bar-status text-sm text-gray-600">Transcribing…</span>
          </>
        )}
      </div>

      {/* Send — only meaningful while listening; hidden during processing. */}
      <button
        type="button"
        onClick={onSend}
        disabled={!isListening}
        aria-label="Send voice message"
        class="cw-voice-bar-send flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: sendBtnColor, color: sendBtnIconColor }}
      >
        <ArrowUpIcon class="h-4 w-4" />
      </button>
    </div>
  );
}
