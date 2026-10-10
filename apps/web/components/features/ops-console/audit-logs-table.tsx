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
import { useUsers } from "@/hooks/use-rbac";
import {
  useAuditEventNames,
  useAuditLogs,
  type AuditLogRow,
} from "@/hooks/use-ops-console";
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

export function AuditLogsTable() {
  const { can } = usePermissions();
  const [params, setParams] = useState<DataTableFetchParams>({
    page: 0,
    pageSize: 20,
    sorting: [],
    search: "",
    filters: {},
  });
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const f = params.filters;
  const sort = params.sorting[0];
  const query = useMemo(
    () => ({
      page: params.page + 1,
      limit: params.pageSize,
      sortOrder: (sort && !sort.desc ? "asc" : "desc") as "asc" | "desc",
      search: params.search || undefined,
      organizationId: asString(f.organizationId),
      userId: asString(f.userId),
      events: asList(f.events),
      from: dayStartIso(asString(f.dateFrom)),
      to: dayEndIso(asString(f.dateTo)),
    }),
    [params, f, sort],
  );

  // The list and the three filter option lists load in parallel.
  const { data, isFetching, isError, refetch } = useAuditLogs(query, true);
  const eventNames = useAuditEventNames(true);
  const orgs = useOrganizations(
    { page: 1, limit: 100, sortBy: "name", sortOrder: "asc" },
    { enabled: can("Organization:ReadAll") },
  );
  const users = useUsers({ page: 1, limit: 100, enabled: can("User:ReadAll") });

  const filters = useMemo<DataTableFilterConfig[]>(
    () => [
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
        id: "userId",
        label: "User",
        placeholder: "All users",
        type: "combobox",
        options: (users.data?.data ?? []).map((u) => ({
          label: u.name ? `${u.name} (${u.email})` : u.email,
          value: u.id,
        })),
      },
      {
        id: "events",
        label: "Action",
        placeholder: "All actions",
        multiSelect: true,
        options: (eventNames.data?.events ?? []).map((e) => ({
          label: e,
          value: e,
        })),
      },
      {
        id: "date",
        label: "Date",
        placeholder: "Last 7 days",
        type: "dateRange",
      },
    ],
    [orgs.data, users.data, eventNames.data],
  );

  const columns = useMemo<ColumnDef<AuditLogRow, unknown>[]>(
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
        accessorKey: "event",
        header: "Action",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs break-all">
            {row.original.event}
          </span>
        ),
      },
      {
        id: "user",
        header: "User",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original.user;
          if (!u) return <span className="text-muted-foreground">System</span>;
          return (
            <div className="min-w-0">
              <div className="truncate">{u.name ?? u.email}</div>
              {u.name && (
                <div className="truncate text-xs text-muted-foreground">
                  {u.email}
                </div>
              )}
            </div>
          );
        },
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
        id: "agent",
        header: "Agent",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="truncate">{row.original.agent?.name ?? "-"}</span>
        ),
      },
    ],
    [],
  );

  const handleFetch = useCallback(
    (p: DataTableFetchParams) => setParams(p),
    [],
  );

  return (
    <div className="space-y-3">
      <WindowNote
        from={data?.meta.from}
        to={data?.meta.to}
        capped={data?.meta.totalCapped}
        defaultLabel="Showing the last 7 days unless you pick dates."
      />
      <DataTable<AuditLogRow, unknown>
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
                Could not load the audit log
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
        searchConfig={{ placeholder: "Search actions...", searchKey: "search" }}
        filters={filters}
        onRowClick={setSelected}
        showHeader={false}
        hideSelectionCount
      />

      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base break-all">
                  {selected.event}
                </SheetTitle>
                <SheetDescription>
                  {formatFullTimestamp(selected.createdAt)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <dl className="space-y-2">
                  <DetailRow label="User">
                    {selected.user
                      ? `${selected.user.name ?? ""} ${selected.user.email}`.trim()
                      : "System"}
                  </DetailRow>
                  <DetailRow label="Organization">
                    {selected.organization?.name ??
                      selected.organizationId ??
                      "-"}
                  </DetailRow>
                  <DetailRow label="Agent">
                    {selected.agent?.name ?? selected.agentId ?? "-"}
                  </DetailRow>
                  <DetailRow label="Context ID">
                    <span className="font-mono text-xs">
                      {selected.contextId}
                    </span>
                  </DetailRow>
                  <DetailRow label="Correlation ID">
                    <span className="font-mono text-xs">
                      {selected.correlationId ?? "-"}
                    </span>
                  </DetailRow>
                </dl>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Data</h3>
                  <JsonBlock value={selected.data} className="max-h-[60vh]" />
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
