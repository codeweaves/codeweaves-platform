'use client';

import { X } from 'lucide-react';
import { getErrorSeverity, type VoiceErrorSeverity } from '@/hooks/use-voice';

interface VoiceErrorBannerProps {
  error: string;
  errorCode?: string | null;
  onDismiss: () => void;
}

const severityStyles: Record<VoiceErrorSeverity, { container: string; button: string }> = {
  error: {
    container: 'bg-red-50 text-red-700',
    button: 'hover:bg-red-100',
  },
  warning: {
    container: 'bg-yellow-50 text-yellow-700',
    button: 'hover:bg-yellow-100',
  },
  info: {
    container: 'bg-blue-50 text-blue-700',
    button: 'hover:bg-blue-100',
  },
};

export function VoiceErrorBanner({ error, errorCode, onDismiss }: VoiceErrorBannerProps) {
  const severity = getErrorSeverity(errorCode ?? null);
  const styles = severityStyles[severity];

  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${styles.container}`}
    >
      <span className="flex-1">{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className={`shrink-0 rounded p-0.5 ${styles.button}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
