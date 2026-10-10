"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AgentUsageRow,
  CostBreakdown,
  OrganizationUsageRow,
  UnitEconomics,
  UsageSummary,
} from "@/hooks/use-usage";
import {
  CHANNEL_LABELS,
  FEATURE_LABELS,
  formatCount,
  formatDateTime,
  formatInr,
  formatNative,
} from "./usage-format";

interface SectionProps {
  title: string;
  description?: string;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  children: ReactNode;
  className?: string;
}

/** Card with the loading, error and empty states every table on the page shares. */
export function UsageSection({
  title,
  description,
  isLoading,
  isError,
  isEmpty,
  children,
  className,
}: SectionProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex h-24 items-center justify-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            Failed to load
          </div>
        ) : isEmpty ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            No usage for these filters
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Our cost, plus what the client paid the provider directly (WhatsApp) on a
 * second line. A row that is only client-paid shows the client amount alone,
 * so it does not read as free.
 */
function CostCells({ row }: { row: CostBreakdown }) {
  const clientOnly = row.clientRows > 0 && row.clientRows === row.rows;
  const hasClient = row.clientRows > 0;
  return (
    <>
      <TableCell className="text-right font-medium tabular-nums">
        {clientOnly ? (
          <ClientAmount>{formatInr(row.clientCostInr)}</ClientAmount>
        ) : (
          <>
            {formatInr(row.costInr)}
            {hasClient && (
              <ClientAmount>{formatInr(row.clientCostInr)}</ClientAmount>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">
        {clientOnly ? (
          <ClientAmount>{formatNative(row.clientNative)}</ClientAmount>
        ) : (
          <>
            {formatNative(row.native)}
            {hasClient && (
              <ClientAmount>{formatNative(row.clientNative)}</ClientAmount>
            )}
          </>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.rows)}
        {row.unpricedRows > 0 && (
          <Badge
            variant="outline"
            className="ml-2 border-amber-500/50 text-amber-700 dark:text-amber-400"
          >
            {formatCount(row.unpricedRows)} unpriced
          </Badge>
        )}
      </TableCell>
    </>
  );
}

function ClientAmount({ children }: { children: ReactNode }) {
  return (
    <span className="block text-xs font-normal text-muted-foreground">
      {children} client
    </span>
  );
}

const COST_HEADERS = (
  <>
    <TableHead className="text-right">Cost (INR)</TableHead>
    <TableHead className="text-right">Provider currency</TableHead>
    <TableHead className="text-right">Calls</TableHead>
  </>
);

/** A clickable row: the whole row applies a filter, by mouse or keyboard. */
const clickableRow =
  "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none";

function activate(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

export function ProviderModelTable({
  rows,
  onSelectProvider,
}: {
  rows: UsageSummary["byProviderModel"];
  onSelectProvider: (provider: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Provider / model</TableHead>
          <TableHead className="text-right">Usage</TableHead>
          {COST_HEADERS}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const usage = [
            row.inputTokens ? `${formatCount(row.inputTokens)} in` : "",
            row.outputTokens ? `${formatCount(row.outputTokens)} out` : "",
            row.audioSeconds
              ? `${(row.audioSeconds / 60).toFixed(1)} min audio`
              : "",
            row.characters ? `${formatCount(row.characters)} chars` : "",
            row.units ? `${formatCount(row.units)} units` : "",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <TableRow
              key={`${row.provider}|${row.model}`}
              className={clickableRow}
              {...activate(() => onSelectProvider(row.provider))}
              title="Filter by this provider"
            >
              <TableCell>
                <span className="font-medium">{row.provider}</span>
                <span className="text-muted-foreground"> / {row.model}</span>
                {row.clientRows > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    Client pays
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {usage || "n/a"}
              </TableCell>
              <CostCells row={row} />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DimensionTable({
  label,
  rows,
  labels,
  onSelect,
}: {
  label: string;
  rows: Array<CostBreakdown & { key: string }>;
  labels: Record<string, string>;
  onSelect: (key: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          {COST_HEADERS}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.key}
            className={clickableRow}
            {...activate(() => onSelect(row.key))}
            title={`Filter by this ${label.toLowerCase()}`}
          >
            <TableCell className="font-medium">
              {labels[row.key] ?? row.key}
            </TableCell>
            <CostCells row={row} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FeatureTable({
  summary,
  onSelect,
}: {
  summary: UsageSummary;
  onSelect: (feature: string) => void;
}) {
  return (
    <DimensionTable
      label="Feature"
      labels={FEATURE_LABELS}
      rows={summary.byFeature.map((r) => ({ ...r, key: r.feature }))}
      onSelect={onSelect}
    />
  );
}

export function ChannelTable({
  summary,
  onSelect,
}: {
  summary: UsageSummary;
  onSelect: (channel: string) => void;
}) {
  return (
    <DimensionTable
      label="Channel"
      labels={CHANNEL_LABELS}
      rows={summary.byChannel.map((r) => ({ ...r, key: r.channel }))}
      onSelect={onSelect}
    />
  );
}

export function OrganizationsTable({
  rows,
  onSelect,
}: {
  rows: OrganizationUsageRow[];
  onSelect: (id: string, name: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Organization</TableHead>
          <TableHead className="text-right">Conversations</TableHead>
          <TableHead className="text-right">Per conversation</TableHead>
          {COST_HEADERS}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const name = row.organizationName ?? "Platform (no organization)";
          const id = row.organizationId;
          return (
            <TableRow
              key={id ?? "none"}
              className={id ? clickableRow : undefined}
              {...(id ? activate(() => onSelect(id, name)) : {})}
            >
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.conversations)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInr(row.costPerConversationInr)}
              </TableCell>
              <CostCells row={row} />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function AgentsTable({
  rows,
  onSelect,
}: {
  rows: AgentUsageRow[];
  onSelect: (id: string, name: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead className="text-right">Conversations</TableHead>
          <TableHead className="text-right">Per conversation</TableHead>
          {COST_HEADERS}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const name = row.agentName ?? "No agent";
          const id = row.agentId;
          return (
            <TableRow
              key={`${id ?? "none"}|${row.organizationId ?? ""}`}
              className={id ? clickableRow : undefined}
              {...(id ? activate(() => onSelect(id, name)) : {})}
            >
              <TableCell>
                <span className="font-medium">{name}</span>
                {row.organizationName && (
                  <span className="block text-xs text-muted-foreground">
                    {row.organizationName}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.conversations)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInr(row.costPerConversationInr)}
              </TableCell>
              <CostCells row={row} />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function UnitEconomicsPanel({ data }: { data: UnitEconomics }) {
  const { perConversation: c, voice: v } = data;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium">
          Cost per conversation{" "}
          <span className="font-normal text-muted-foreground">
            ({formatCount(c.conversations)} conversations)
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Average" value={formatInr(c.avgInr)} />
          <Stat label="Median (p50)" value={formatInr(c.p50Inr)} />
          <Stat label="p90" value={formatInr(c.p90Inr)} />
          <Stat label="Most expensive" value={formatInr(c.maxInr)} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">
          Cost per voice minute{" "}
          <span className="font-normal text-muted-foreground">
            ({v.audioMinutes.toFixed(1)} minutes of caller audio)
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Per minute"
            value={formatInr(v.costPerMinuteInr)}
            hint={v.audioMinutes > 0 ? undefined : "No voice audio metered yet"}
          />
          <Stat label="Speech to text" value={formatInr(v.sttInr)} />
          <Stat label="Text to speech" value={formatInr(v.ttsInr)} />
          <Stat label="LLM" value={formatInr(v.llmInr)} />
        </div>
      </div>
    </div>
  );
}

export function TopConversationsTable({
  rows,
}: {
  rows: UnitEconomics["topConversations"];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Conversation</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead className="text-right">Calls</TableHead>
          <TableHead className="text-right">Cost (INR)</TableHead>
          <TableHead className="text-right">Last call</TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.chatSessionId} className="group">
            <TableCell>
              <Link
                href={`/dashboard/admin/usage/conversations/${row.chatSessionId}`}
                className="font-mono text-xs text-primary underline-offset-4 hover:underline"
              >
                {row.chatSessionId.slice(0, 8)}
              </Link>
            </TableCell>
            <TableCell>
              <span>{row.agentName ?? "No agent"}</span>
              {row.organizationName && (
                <span className="block text-xs text-muted-foreground">
                  {row.organizationName}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCount(row.calls)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatInr(row.costInr)}
            </TableCell>
            <TableCell className="text-right text-xs text-muted-foreground">
              {formatDateTime(row.lastAt)}
            </TableCell>
            <TableCell>
              <Link
                href={`/dashboard/admin/usage/conversations/${row.chatSessionId}`}
                aria-label="Open the cost breakdown"
              >
                <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
