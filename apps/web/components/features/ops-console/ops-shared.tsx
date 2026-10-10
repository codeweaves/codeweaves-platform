"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { usePageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

/** The permission every ops console page and endpoint needs. */
export const OPS_PERMISSION = "AuditLog:Read";

/**
 * Sets the page title and sends anyone without AuditLog:Read back to the
 * dashboard. Returns true once the page may render. UX only: the API is the
 * boundary and returns 403 on its own.
 */
export function useOpsPageGate(title: string): boolean {
  const router = useRouter();
  const { can, isLoading } = usePermissions();
  const { setTitle } = usePageHeader();
  const allowed = can(OPS_PERMISSION);

  useEffect(() => {
    if (!isLoading && !allowed) router.replace("/dashboard");
  }, [isLoading, allowed, router]);

  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [setTitle, title]);

  return !isLoading && allowed;
}

const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const fullTimestampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** "10 Oct, 14:03:22" in the viewer's time zone. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : timestampFormat.format(d);
}

export function formatFullTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : fullTimestampFormat.format(d);
}

/** Local `yyyy-MM-dd` from the date-range filter to an ISO instant. */
export function dayStartIso(day: string | undefined): string | undefined {
  return day ? new Date(`${day}T00:00:00`).toISOString() : undefined;
}

export function dayEndIso(day: string | undefined): string | undefined {
  return day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined;
}

export function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0] || undefined;
  return v || undefined;
}

export function asList(v: string | string[] | undefined): string[] | undefined {
  if (!v) return undefined;
  const list = Array.isArray(v) ? v : [v];
  return list.length ? list : undefined;
}

/** Pretty-printed JSON in a scrollable block. */
export function JsonBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return <p className="text-sm text-muted-foreground">Nothing recorded.</p>;
  }
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all",
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** One label / value pair in a detail sheet. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children ?? "-"}</dd>
    </div>
  );
}

/** "Showing the newest 10,000" notice plus the active time window. */
export function WindowNote({
  from,
  to,
  capped,
  defaultLabel,
}: {
  from?: string;
  to?: string;
  capped?: boolean;
  defaultLabel: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {from && to
        ? `Showing ${formatFullTimestamp(from)} to ${formatFullTimestamp(to)}.`
        : defaultLabel}
      {capped &&
        " More than 10,000 rows match. Narrow the filters to see them all."}
    </p>
  );
}
