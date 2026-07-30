import type { ReactNode } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

function Wordmark({
  className,
  onDark = false,
}: {
  className?: string;
  /** On the navy brand panel the navy mark would vanish — use the white variant. */
  onDark?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2 text-lg font-semibold', className)}>
      <Image
        src={onDark ? '/klivo-logo-white.png' : '/klivo-logo-remove.png'}
        alt="Klivo"
        width={28}
        height={28}
        priority
        className="size-7 object-contain"
      />
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

        <Wordmark className="relative" onDark />

        <div className="relative space-y-4">
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            Agentic AI for your business.
          </h1>
          <p className="max-w-sm text-sidebar-primary-foreground/70">
            Build and deploy AI agents across voice, chat, and more. Manage every
            conversation from one dashboard.
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
