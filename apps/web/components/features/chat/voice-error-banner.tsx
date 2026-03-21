'use client';

import { X } from 'lucide-react';

interface VoiceErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export function VoiceErrorBanner({ error, onDismiss }: VoiceErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
    >
      <span className="flex-1">{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 rounded p-0.5 hover:bg-red-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
