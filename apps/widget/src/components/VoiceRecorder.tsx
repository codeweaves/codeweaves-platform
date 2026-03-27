/**
 * VoiceRecorder component — mic button with state-based appearance (Story 5-20).
 *
 * States:
 *   idle: primary color, mic icon
 *   listening: red, stop icon + pulse animation, recording timer
 *   processing: gray, spinner icon (disabled)
 *   playing: orange, stop icon (tap to stop playback)
 */

import { useCallback } from 'preact/hooks';
import type { VoiceState } from '../hooks/useVoice';

export interface VoiceRecorderProps {
  voiceState: VoiceState;
  recordingDurationMs: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopPlayback: () => void;
  onCancelRecording: () => void;
  disabled?: boolean;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Mic icon (idle state) */
function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="1" width="6" height="11" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

/** Stop icon (square — for listening/playing states) */
function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Spinner icon (processing state) */
function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="cw-voice-spinner">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

/** X icon for cancel */
function CancelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function VoiceRecorder({
  voiceState,
  recordingDurationMs,
  onStartRecording,
  onStopRecording,
  onStopPlayback,
  onCancelRecording,
  disabled = false,
}: VoiceRecorderProps) {
  const handleClick = useCallback(() => {
    switch (voiceState) {
      case 'idle':
        onStartRecording();
        break;
      case 'listening':
        onStopRecording();
        break;
      case 'playing':
        onStopPlayback();
        break;
      // processing: button is disabled, no action
    }
  }, [voiceState, onStartRecording, onStopRecording, onStopPlayback]);

  const isProcessing = voiceState === 'processing';
  const isListening = voiceState === 'listening';
  const isPlaying = voiceState === 'playing';

  const stateClass = `cw-voice-btn cw-voice-btn--${voiceState}`;

  const ariaLabel =
    voiceState === 'idle' ? 'Record voice message' :
    voiceState === 'listening' ? 'Stop recording' :
    voiceState === 'processing' ? 'Processing voice...' :
    'Stop playback';

  return (
    <div class="cw-voice-recorder">
      {isListening && (
        <div class="cw-voice-recording-info">
          <span class="cw-voice-red-dot" />
          <span class="cw-voice-timer">{formatDuration(recordingDurationMs)}</span>
          <button
            type="button"
            class="cw-voice-cancel-btn"
            aria-label="Cancel recording"
            onClick={onCancelRecording}
          >
            <CancelIcon />
          </button>
        </div>
      )}
      <button
        type="button"
        class={stateClass}
        aria-label={ariaLabel}
        disabled={disabled || isProcessing}
        onClick={handleClick}
      >
        {voiceState === 'idle' && <MicIcon />}
        {isListening && <StopIcon />}
        {isProcessing && <SpinnerIcon />}
        {isPlaying && <StopIcon />}
      </button>
    </div>
  );
}
