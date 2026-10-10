"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useHttpEventForCorrelation,
  type AuditLogRow,
} from "@/hooks/use-ops-console";
import { formatDuration } from "@/lib/format-utils";
import { DetailRow, JsonBlock, formatFullTimestamp } from "./ops-shared";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface AuditSections {
  request?: unknown;
  response?: unknown;
  before?: unknown;
  after?: unknown;
  error?: unknown;
  details?: Json;
}

/**
 * Audit `data` has no fixed shape. Loggers wrap their payload as
 * `{ response: ... }`, and that payload may itself hold `request` / `response`
 * or `before` / `after`. Pull those out so the sheet shows them under their
 * own headings; everything else goes under Details.
 */
export function splitAuditData(data: unknown): AuditSections {
  if (!isObject(data)) return data == null ? {} : { details: { value: data } };
  const out: AuditSections = {};
  const details: Json = {};

  const take = (source: Json) => {
    for (const [key, value] of Object.entries(source)) {
      if (key === "request" && out.request === undefined) out.request = value;
      else if (key === "response" && out.response === undefined)
        out.response = value;
      else if (key === "before") out.before = value;
      else if (key === "after") out.after = value;
      else if (key === "error") out.error = value;
      else details[key] = value;
    }
  };

  const { response: wrapped, ...top } = data;
  if (isObject(wrapped)) take(wrapped);
  else if (wrapped !== undefined) out.response = wrapped;
  take(top);

  if (Object.keys(details).length) out.details = details;
  return out;
}

function Section({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <JsonBlock value={value} />
    </section>
  );
}

/** The real HTTP request and response behind this action, from the event log. */
function HttpRequestSection({ row }: { row: AuditLogRow }) {
  const { data, isLoading, isError } = useHttpEventForCorrelation(
    row.correlationId,
    row.createdAt,
  );

  return (
    <section className="space-y-3 rounded-md border p-3">
      <h3 className="text-sm font-medium">HTTP request</h3>
      {!row.correlationId ? (
        <p className="text-sm text-muted-foreground">
          No request id on this entry. It came from a background job, not a
          dashboard request.
        </p>
      ) : isLoading ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load the request.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          No HTTP request was recorded for this action. Reads, public widget
          traffic and background jobs are not stored as requests.
        </p>
      ) : (
        <>
          <dl className="space-y-2">
            <DetailRow label="Request">
              <span className="font-mono text-xs">
                {data.eventName.split("_HTTP_")[1] ?? ""}{" "}
                {data.requestUrl ?? ""}
              </span>
            </DetailRow>
            <DetailRow label="Status">
              <span className="flex items-center gap-2">
                {data.responseStatus ?? "-"}
                {data.success ? (
                  <Badge variant="success">Succeeded</Badge>
                ) : (
                  <Badge variant="destructive">Failed</Badge>
                )}
              </span>
            </DetailRow>
            <DetailRow label="Latency">
              {data.latencyMs != null ? formatDuration(data.latencyMs) : "-"}
            </DetailRow>
            {data.errorMessage && (
              <DetailRow label="Error">
                <span className="text-destructive">{data.errorMessage}</span>
              </DetailRow>
            )}
          </dl>
          <Section title="Request body" value={data.requestPayload} />
          <Section title="Response body" value={data.responsePayload} />
        </>
      )}
    </section>
  );
}

export function AuditLogSheet({
  row,
  onClose,
}: {
  row: AuditLogRow | null;
  onClose: () => void;
}) {
  const sections = row ? splitAuditData(row.data) : {};
  const nothing = Object.values(sections).every((v) => v === undefined);

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-base break-all">
                {row.event}
              </SheetTitle>
              <SheetDescription>
                {formatFullTimestamp(row.createdAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-6">
              <dl className="space-y-2">
                <DetailRow label="User">
                  {row.user
                    ? `${row.user.name ?? ""} ${row.user.email}`.trim()
                    : "System"}
                </DetailRow>
                <DetailRow label="Organization">
                  {row.organization?.name ?? row.organizationId ?? "-"}
                </DetailRow>
                <DetailRow label="Agent">
                  {row.agent?.name ?? row.agentId ?? "-"}
                </DetailRow>
                <DetailRow label="Context ID">
                  <span className="font-mono text-xs">{row.contextId}</span>
                </DetailRow>
                <DetailRow label="Correlation ID">
                  <span className="font-mono text-xs">
                    {row.correlationId ?? "-"}
                  </span>
                </DetailRow>
              </dl>

              {sections.error !== undefined && (
                <Section title="Error" value={sections.error} />
              )}
              {sections.request !== undefined && (
                <Section title="Request" value={sections.request} />
              )}
              {sections.response !== undefined && (
                <Section title="Response" value={sections.response} />
              )}
              {sections.before !== undefined && (
                <Section title="Before" value={sections.before} />
              )}
              {sections.after !== undefined && (
                <Section title="After" value={sections.after} />
              )}
              {sections.details && (
                <Section title="Details" value={sections.details} />
              )}
              {nothing && <Section title="Details" value={null} />}

              <HttpRequestSection row={row} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
