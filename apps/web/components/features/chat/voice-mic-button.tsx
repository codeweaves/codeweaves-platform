'use client';

import { Mic, Square, Loader2, Volume2 } from 'lucide-react';
import type { VoiceState } from '@/hooks/use-voice';

interface VoiceMicButtonProps {
  voiceState: VoiceState;
  recordingDurationMs: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopPlayback: () => void;
  disabled?: boolean;
  /** Optional inline style for theming (editor preview) */
  style?: React.CSSProperties;
  /** Optional class name override */
  className?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const ariaLabels: Record<VoiceState, string> = {
  idle: 'Start recording',
  listening: 'Stop recording',
  processing: 'Processing voice',
  playing: 'Stop playback',
};

export function VoiceMicButton({
  voiceState,
  recordingDurationMs,
  onStartRecording,
  onStopRecording,
  onStopPlayback,
  disabled = false,
  style,
  className,
}: VoiceMicButtonProps) {
  const handleClick = () => {
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
      // processing — button is disabled, no action
    }
  };

  const isProcessing = voiceState === 'processing';
  const isListening = voiceState === 'listening';

  const defaultClassName = [
    'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
    isListening ? 'bg-red-500 text-white hover:bg-red-600' : '',
    voiceState === 'idle' ? 'bg-blue-600 text-white hover:bg-blue-700' : '',
    voiceState === 'playing' ? 'bg-orange-500 text-white hover:bg-orange-600' : '',
    isProcessing ? 'bg-gray-400 text-white cursor-not-allowed' : '',
    disabled && !isProcessing ? 'opacity-50 cursor-not-allowed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex items-center gap-1.5">
      {/* Recording duration timer */}
      {isListening && (
        <span className="text-xs font-medium text-red-500 tabular-nums" aria-live="off">
          {formatDuration(recordingDurationMs)}
        </span>
      )}

      {/* Processing label */}
      {isProcessing && (
        <span className="text-xs font-medium text-gray-500">Processing...</span>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={isProcessing || disabled}
        aria-label={ariaLabels[voiceState]}
        className={className ?? defaultClassName}
        style={style}
      >
        {/* Pulse ring animation during listening */}
        {isListening && (
          <span className="absolute inset-0 animate-ping rounded-lg bg-red-400 opacity-30" />
        )}

        {voiceState === 'idle' && <Mic className="h-4 w-4" />}
        {isListening && <Square className="relative h-3.5 w-3.5 fill-current" />}
        {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
        {voiceState === 'playing' && <Volume2 className="h-4 w-4" />}
      </button>

      {/* Screen reader announcements */}
      <span className="sr-only" aria-live="polite">
        {voiceState === 'listening' && 'Recording in progress'}
        {voiceState === 'processing' && 'Processing your voice message'}
        {voiceState === 'playing' && 'Playing response audio'}
      </span>
    </div>
  );
}
