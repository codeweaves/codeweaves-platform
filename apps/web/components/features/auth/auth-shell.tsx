import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { KlivoAuthPanel } from "./klivo-auth-panel";

function Wordmark({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-2 text-lg font-semibold", className)}
    >
      <Image
        src="/klivo-logo-remove.png"
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
 * Split-screen auth layout: the form column + the Klivo marketing panel
 * (desktop only). Shared by sign-in, sign-up, and reset-password so they stay
 * consistent.
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

      {/* Marketing panel — right, desktop only. Pinned to the viewport so it
          keeps its full height while a long form scrolls. */}
      <div className="sticky top-0 hidden h-screen lg:block">
        <KlivoAuthPanel />
      </div>
    </div>
  );
}

/** Inline banner shown at the top of an auth form (info notice or error). */
export function AuthNotice({
  variant = "info",
  children,
}: {
  variant?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2.5 text-sm",
        variant === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-sidebar-primary/25 bg-sidebar-primary/10 text-foreground",
      )}
    >
      {children}
    </div>
  );
}
