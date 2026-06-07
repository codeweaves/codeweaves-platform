import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-lg font-semibold', className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
        K
      </span>
      Klivo
    </div>
  );
}

/**
 * Split-screen auth layout: a violet brand panel (desktop) + the form column.
 * Shared by sign-in, sign-up, and reset-password so they stay consistent.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form column — left */}
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <Wordmark className="mb-10 lg:hidden" />
          {children}
        </div>
      </div>

      {/* Brand panel — right, desktop only */}
      <div className="relative hidden overflow-hidden bg-sidebar-primary px-12 py-10 text-sidebar-primary-foreground lg:flex lg:flex-col lg:justify-between">
        {/* soft decorative glows */}
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-black/10 blur-3xl" />

        <Wordmark className="relative" />

        <div className="relative space-y-4">
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            AI chat widgets for your business.
          </h1>
          <p className="max-w-sm text-sidebar-primary-foreground/70">
            Deploy branded AI assistants across your sites and manage every
            conversation from a single dashboard.
          </p>
        </div>

        <p className="relative text-sm text-sidebar-primary-foreground/60">
          © Klivo
        </p>
      </div>
    </div>
  );
}

/** Inline banner shown at the top of an auth form (info notice or error). */
export function AuthNotice({
  variant = 'info',
  children,
}: {
  variant?: 'info' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2.5 text-sm',
        variant === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-sidebar-primary/25 bg-sidebar-primary/10 text-foreground',
      )}
    >
      {children}
    </div>
  );
}
