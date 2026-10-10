"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useSystemStatus,
  type CronJobState,
  type CronJobStatus,
  type DependencyState,
  type SystemStatus,
} from "@/hooks/use-ops-console";
import { formatDuration, formatNumber } from "@/lib/format-utils";
import { cn, formatTimeAgo } from "@/lib/utils";
import { formatFullTimestamp } from "./ops-shared";

const JOB_BADGE: Record<
  CronJobState,
  { label: string; variant: "success" | "destructive" | "warning" }
> = {
  ok: { label: "Healthy", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  overdue: { label: "Overdue", variant: "warning" },
  never: { label: "Never ran", variant: "warning" },
};

const DEPENDENCY_BADGE: Record<
  DependencyState,
  {
    label: string;
    variant: "success" | "destructive" | "warning" | "secondary";
  }
> = {
  ok: { label: "Ready", variant: "success" },
  fail: { label: "Down", variant: "destructive" },
  degraded: { label: "Degraded", variant: "warning" },
  disabled: { label: "Not configured", variant: "secondary" },
};

function scheduleLabel(minutes: number): string {
  if (minutes === 1) return "Every minute";
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes === 24 * 60) return "Daily";
  return `Every ${Math.round(minutes / 60)} hours`;
}

function ago(iso: string | null): string {
  return iso ? formatTimeAgo(new Date(iso).getTime()) : "never";
}

export function SystemStatusView() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } =
    useSystemStatus(true);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <AlertCircle className="size-6 text-destructive" />
        <span className="text-sm text-muted-foreground">
          Could not load the system status
        </span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-3" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Updated {formatTimeAgo(dataUpdatedAt)}. Refreshes every minute while
          this tab is open.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <ReadinessCards readiness={data.readiness} />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Scheduled jobs</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.jobs.map((job) => (
            <JobCard key={job.key} job={job} />
          ))}
        </div>
      </section>

      <UnpricedUsageCard usage={data.unpricedUsage} />

      <ProviderHealthCard providers={data.providers} />
    </div>
  );
}

function ReadinessCards({
  readiness,
}: {
  readiness: SystemStatus["readiness"];
}) {
  const items = [
    { key: "db", label: "Database", check: readiness.checks.db },
    { key: "redis", label: "Redis", check: readiness.checks.redis },
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map(({ key, label, check }) => {
        const badge = DEPENDENCY_BADGE[check.state];
        return (
          <Card key={key} className="gap-2 py-4">
            <CardHeader className="px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{label}</CardTitle>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 text-sm text-muted-foreground">
              {check.state === "disabled"
                ? "REDIS_URL is not set. Caching and rate limits are off."
                : `Probe took ${formatDuration(check.latencyMs)}${check.error ? ` (${check.error})` : ""}.`}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function JobCard({ job }: { job: CronJobStatus }) {
  const badge = JOB_BADGE[job.state];
  return (
    <Card
      className={cn(
        "gap-3 py-4",
        job.state === "failed" && "border-destructive/50",
        (job.state === "overdue" || job.state === "never") &&
          "border-warning-foreground/40",
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{job.label}</CardTitle>
            <CardDescription className="truncate font-mono text-xs">
              {job.endpoint}
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Last run</span>
          <span title={formatFullTimestamp(job.lastRunAt)}>
            {ago(job.lastRunAt)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Schedule</span>
          <span>{scheduleLabel(job.expectedEveryMinutes)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Runs in 24 hours</span>
          <span className="tabular-nums">
            {formatNumber(job.runsLast24h)}
            {job.failuresLast24h > 0 && (
              <span className="text-destructive">
                {" "}
                ({job.failuresLast24h} failed)
              </span>
            )}
          </span>
        </div>
        {job.state === "never" && (
          <p className="pt-1 text-xs text-warning-foreground">
            No run recorded in the last 30 days. Check the scheduler for this
            endpoint.
          </p>
        )}
        {job.state === "overdue" && !job.backlog?.waiting && (
          <p className="pt-1 text-xs text-warning-foreground">
            No run for more than twice the schedule. Check the scheduler.
          </p>
        )}
        {job.backlog && job.backlog.waiting > 0 && (
          <p className="pt-1 text-xs text-warning-foreground">
            {formatNumber(job.backlog.waiting)} conversation
            {job.backlog.waiting === 1 ? " is" : "s are"} waiting, the oldest
            since {ago(job.backlog.oldestDueAt)}.
          </p>
        )}
        {job.lastError && (
          <p className="line-clamp-3 pt-1 text-xs text-destructive">
            {job.lastError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function UnpricedUsageCard({
  usage,
}: {
  usage: SystemStatus["unpricedUsage"];
}) {
  const hasUnpriced = usage.unpricedRecords > 0;
  return (
    <Card
      className={cn(
        "gap-3 py-4",
        hasUnpriced && "border-warning-foreground/40",
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-center gap-2">
          {hasUnpriced ? (
            <AlertTriangle className="size-4 text-warning-foreground" />
          ) : (
            <CheckCircle2 className="size-4 text-success-foreground" />
          )}
          <CardTitle className="text-sm">Usage with no price</CardTitle>
        </div>
        <CardDescription>
          {hasUnpriced
            ? `${formatNumber(usage.unpricedRecords)} of ${formatNumber(usage.totalRecords)} usage records in the last ${usage.windowHours} hours have no matching price. Add a price row so the cost reports stay complete.`
            : `Every usage record in the last ${usage.windowHours} hours has a price (${formatNumber(usage.totalRecords)} records).`}
        </CardDescription>
      </CardHeader>
      {hasUnpriced && (
        <CardContent className="px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.top.map((r) => (
                <TableRow key={`${r.provider}/${r.model}`}>
                  <TableCell>{r.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{r.model}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.count)}
                  </TableCell>
                  <TableCell className="text-right">
                    {ago(r.lastSeenAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}

function ProviderHealthCard({
  providers,
}: {
  providers: SystemStatus["providers"];
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Provider health</CardTitle>
        <CardDescription>
          Outbound calls in the last {providers.windowMinutes} minutes. An error
          rate above 10% is highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {providers.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No provider calls in this window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Error rate</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">Last failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.rows.map((p) => (
                <TableRow
                  key={p.provider}
                  className={cn(p.alert && "bg-destructive/5")}
                >
                  <TableCell className="font-medium">{p.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.calls)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.failed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.alert ? (
                      <Badge variant="destructive">
                        {(p.errorRate * 100).toFixed(1)}%
                      </Badge>
                    ) : (
                      `${(p.errorRate * 100).toFixed(1)}%`
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.p50LatencyMs != null
                      ? formatDuration(p.p50LatencyMs)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.p95LatencyMs != null
                      ? formatDuration(p.p95LatencyMs)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.lastFailureAt ? ago(p.lastFailureAt) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
