"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFetchParams,
  type DataTableFilterConfig,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePermissions } from "@/hooks/use-permissions";
import { useOrganizations } from "@/hooks/use-organizations";
import {
  useEventLog,
  useEventLogs,
  type EventLogParams,
  type EventLogRow,
} from "@/hooks/use-ops-console";
import { formatDuration } from "@/lib/format-utils";
import {
  DetailRow,
  JsonBlock,
  WindowNote,
  asList,
  asString,
  dayEndIso,
  dayStartIso,
  formatFullTimestamp,
  formatTimestamp,
} from "./ops-shared";

const PAGE_SIZES = [20, 50, 100];

const CHANNEL_OPTIONS = [
  { label: "Widget", value: "WIDGET" },
  { label: "Dashboard", value: "DASHBOARD" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Voice", value: "VOICE" },
  { label: "Internal jobs", value: "INTERNAL" },
  { label: "System", value: "SYSTEM" },
];

// Labels written to event_logs.provider (common/events/provider.logger.ts).
const PROVIDER_OPTIONS = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "GROQ",
  "ELEVENLABS",
  "SARVAM",
  "DEEPGRAM",
  "META_WHATSAPP",
  "RESEND",
  "CLERK",
  "SUPABASE",
  "N8N",
  "AGENT_WEBHOOK",
  "FRANKFURTER",
].map((p) => ({ label: p, value: p }));

const OUTCOME_OPTIONS = [
  { label: "Succeeded", value: "true" },
  { label: "Failed", value: "false" },
];

export function EventLogsTable() {
  const { can } = usePermissions();
  const [params, setParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 20,
    sorting: [],
    search: "",
    filters: {},
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const f = params.filters;
  const sort = params.sorting[0];
  const success = asString(f.success);
  const query = useMemo<EventLogParams>(
    () => ({
      page: params.page + 1,
      limit: params.pageSize,
      sortOrder: sort && !sort.desc ? "asc" : "desc",
      search: params.search || undefined,
      channels: asList(f.channels),
      providers: asList(f.providers),
      success: success === "true" || success === "false" ? success : undefined,
      organizationId: asString(f.organizationId),
      from: dayStartIso(asString(f.dateFrom)),
      to: dayEndIso(asString(f.dateTo)),
    }),
    [params, f, sort, success],
  );

  const { data, isFetching, isError, refetch } = useEventLogs(query, true);
  const orgs = useOrganizations(
    { page: 1, limit: 100, sortBy: "name", sortOrder: "asc" },
    { enabled: can("Organization:ReadAll") },
  );

  const filters = useMemo<DataTableFilterConfig[]>(
    () => [
      {
        id: "channels",
        label: "Channel",
        placeholder: "All channels",
        multiSelect: true,
        options: CHANNEL_OPTIONS,
      },
      {
        id: "providers",
        label: "Provider",
        placeholder: "All providers",
        multiSelect: true,
        options: PROVIDER_OPTIONS,
      },
      {
        id: "success",
        label: "Outcome",
        placeholder: "Any outcome",
        options: OUTCOME_OPTIONS,
      },
      {
        id: "organizationId",
        label: "Organization",
        placeholder: "All organizations",
        type: "combobox",
        options: (orgs.data?.data ?? []).map((o) => ({
          label: o.name,
          value: o.id,
        })),
      },
      {
        id: "date",
        label: "Date",
        placeholder: "Last 24 hours",
        type: "dateRange",
      },
    ],
    [orgs.data],
  );

  const columns = useMemo<ColumnDef<EventLogRow, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Time" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatTimestamp(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "eventName",
        header: "Event",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs break-all">
                  {r.eventName}
                </span>
                {!r.success && <Badge variant="destructive">Failed</Badge>}
                {r.responseStatus != null && (
                  <Badge
                    variant={
                      r.responseStatus >= 400 ? "destructive" : "outline"
                    }
                  >
                    {r.responseStatus}
                  </Badge>
                )}
              </div>
              {r.errorMessage && (
                <p className="line-clamp-1 text-xs text-destructive">
                  {r.errorMessage}
                </p>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "channel",
        header: "Channel",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.channel}</Badge>
        ),
      },
      {
        accessorKey: "provider",
        header: "Provider",
        enableSorting: false,
        cell: ({ row }) => row.original.provider ?? "-",
      },
      {
        id: "organization",
        header: "Organization",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate">
            {row.original.organization?.name ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "latencyMs",
        header: () => <div className="text-right">Latency</div>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {row.original.latencyMs != null
              ? formatDuration(row.original.latencyMs)
              : "-"}
          </div>
        ),
      },
    ],
    [],
  );

  const handleFetch = useCallback(
    (p: DataTableFetchParams) => setParams(p),
    [],
  );
  const handleRowClick = useCallback(
    (row: EventLogRow) => setSelectedId(row.id),
    [],
  );

  return (
    <div className="space-y-3">
      <WindowNote
        from={data?.meta.from}
        to={data?.meta.to}
        capped={data?.meta.totalCapped}
        defaultLabel="Showing the last 24 hours unless you pick dates."
      />
      <DataTable<EventLogRow, unknown>
        columns={columns}
        data={data?.data ?? []}
        pageCount={data?.meta.totalPages ?? 0}
        totalItems={data?.meta.total ?? 0}
        isLoading={isFetching}
        renderLoading={() => (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {...(isError && {
          renderEmpty: () => (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <AlertCircle className="size-6 text-destructive" />
              <span className="text-sm text-muted-foreground">
                Could not load the event log
              </span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="size-3" />
                Try again
              </Button>
            </div>
          ),
        })}
        onFetch={handleFetch}
        initialPageSize={20}
        pageSizeOptions={PAGE_SIZES}
        searchConfig={{
          placeholder: "Event name, session ID or correlation ID...",
          searchKey: "search",
          minWidth: "min-w-[280px]",
        }}
        filters={filters}
        onRowClick={handleRowClick}
        showHeader={false}
        hideSelectionCount
      />

      <EventLogSheet id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function EventLogSheet({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useEventLog(id);

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base break-all">
            {data?.eventName ?? "Event"}
          </SheetTitle>
          <SheetDescription>
            {data
              ? formatFullTimestamp(data.createdAt)
              : "Loading the event..."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          {isLoading && (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {isError && (
            <p className="text-sm text-destructive">
              Could not load this event.
            </p>
          )}
          {data && (
            <>
              <dl className="space-y-2">
                <DetailRow label="Outcome">
                  {data.success ? (
                    <Badge variant="success">Succeeded</Badge>
                  ) : (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                </DetailRow>
                {data.errorMessage && (
                  <DetailRow label="Error">
                    <span className="text-destructive">
                      {data.errorMessage}
                    </span>
                  </DetailRow>
                )}
                <DetailRow label="Channel">{data.channel}</DetailRow>
                <DetailRow label="Direction">{data.direction}</DetailRow>
                <DetailRow label="Provider">{data.provider ?? "-"}</DetailRow>
                <DetailRow label="Status">
                  {data.responseStatus ?? "-"}
                </DetailRow>
                <DetailRow label="Latency">
                  {data.latencyMs != null
                    ? formatDuration(data.latencyMs)
                    : "-"}
                </DetailRow>
                <DetailRow label="URL">
                  <span className="font-mono text-xs">
                    {data.requestUrl ?? "-"}
                  </span>
                </DetailRow>
                <DetailRow label="Organization">
                  {data.organization?.name ?? data.organizationId ?? "-"}
                </DetailRow>
                <DetailRow label="Actor">{data.actor?.email ?? "-"}</DetailRow>
                <DetailRow label="Visitor">{data.visitorId ?? "-"}</DetailRow>
                <DetailRow label="Agent ID">
                  <span className="font-mono text-xs">
                    {data.agentId ?? "-"}
                  </span>
                </DetailRow>
                <DetailRow label="Session ID">
                  <span className="font-mono text-xs">
                    {data.sessionId ?? "-"}
                  </span>
                </DetailRow>
                <DetailRow label="Correlation ID">
                  <span className="font-mono text-xs">
                    {data.correlationId ?? "-"}
                  </span>
                </DetailRow>
              </dl>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Request headers</h3>
                <JsonBlock value={data.requestHeaders} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Request payload</h3>
                <JsonBlock value={data.requestPayload} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Response payload</h3>
                <JsonBlock value={data.responsePayload} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Metadata</h3>
                <JsonBlock value={data.metadata} />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
