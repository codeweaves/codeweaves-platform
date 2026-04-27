'use client';

export type TzMode = 'local' | 'utc';

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function resolveTimezone(mode: TzMode): string {
  return mode === 'utc' ? 'UTC' : getBrowserTimezone();
}

interface TimezoneToggleProps {
  mode: TzMode;
  onChange: (mode: TzMode) => void;
}

export function TimezoneToggle({ mode, onChange }: TimezoneToggleProps) {
  const browserTz = getBrowserTimezone();
  return (
    <div
      className="inline-flex items-center rounded-md border bg-background p-0.5"
      role="group"
      aria-label="Timezone"
    >
      <button
        type="button"
        onClick={() => onChange('local')}
        className={
          'rounded px-3 py-1 text-xs font-medium transition-colors ' +
          (mode === 'local'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground')
        }
        title={`Local time (${browserTz})`}
      >
        Local
      </button>
      <button
        type="button"
        onClick={() => onChange('utc')}
        className={
          'rounded px-3 py-1 text-xs font-medium transition-colors ' +
          (mode === 'utc'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground')
        }
        title="UTC"
      >
        UTC
      </button>
    </div>
  );
}
