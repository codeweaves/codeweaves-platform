/**
 * VoiceErrorBanner — displays voice errors above the input area (Story 5-20).
 *
 * Severity-based styling:
 *   error: red background
 *   warning: yellow background
 *   info: blue background
 *
 * Auto-dismisses via useVoice hook timers (8s errors, 5s warnings).
 * Also dismissible via close (X) button.
 */

import type { VoiceErrorSeverity } from '../hooks/useVoice';

export interface VoiceErrorBannerProps {
  message: string;
  severity: VoiceErrorSeverity;
  onDismiss: () => void;
}

export function VoiceErrorBanner({ message, severity, onDismiss }: VoiceErrorBannerProps) {
  return (
    <div
      class={`cw-voice-error-banner cw-voice-error-banner--${severity}`}
      role="alert"
      aria-live="assertive"
    >
      <span class="cw-voice-error-banner-text">{message}</span>
      <button
        type="button"
        class="cw-voice-error-banner-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        &times;
      </button>
    </div>
  );
}
