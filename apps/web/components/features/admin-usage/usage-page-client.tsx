"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  AudioLines,
  Brain,
  Download,
  Handshake,
  IndianRupee,
  Info,
  MessageSquare,
  Package,
  Speaker,
  X,
} from "lucide-react";
import {
  BILLED_TO,
  USAGE_CHANNELS,
  USAGE_FEATURES,
  type BilledToKey,
  type UsageChannelKey,
  type UsageFeatureKey,
} from "@repo/validation";
import { usePageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useUnitEconomics,
  useUsageAgents,
  useUsageExport,
  useUsageOrganizations,
  useUsageSummary,
  useUsageTimeseries,
  type UsageFilters,
} from "@/hooks/use-usage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRangePresets } from "@/components/features/analytics/date-range-presets";
import { KpiCard } from "@/components/features/analytics/kpi-card";
import {
  CHANNEL_LABELS,
  FEATURE_LABELS,
  QUANTITY_SOURCE_LABELS,
  formatCount,
  formatInr,
  formatNative,
} from "./usage-format";
import {
  AgentsTable,
  ChannelTable,
  FeatureTable,
  OrganizationsTable,
  ProviderModelTable,
  TopConversationsTable,
  UnitEconomicsPanel,
  UsageSection,
} from "./usage-tables";

// Recharts is heavy and only this card needs it: load it in its own chunk.
const UsageDailyChart = dynamic(() => import("./usage-daily-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-70 w-full" />,
});

const ALL = "all";
const BILLED_TO_LABELS: Record<BilledToKey, string> = {
  PLATFORM: "Our cost",
  CLIENT: "Client pass-through",
};

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  return { from: utcDay(from), to: utcDay(to) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

interface NamedFilter {
  id: string;
  name: string;
}

export function UsagePageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-full max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export function UsagePageClient() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParams = useSearchParams();
  const { can, isLoading: permsLoading } = usePermissions();
  const { setTitle } = usePageHeader();

  const canRead = can("Usage:Read");

  useEffect(() => {
    setTitle("Usage & cost");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    if (!permsLoading && !canRead) router.replace("/dashboard");
  }, [permsLoading, canRead, router]);

  // --- Filter state, seeded from the URL so a view can be shared ---
  const [range, setRange] = useState(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to && DATE_RE.test(from) && DATE_RE.test(to)
      ? { from, to }
      : defaultRange();
  });
  const [org, setOrg] = useState<NamedFilter | null>(() => {
    const id = searchParams.get("organizationId");
    return id
      ? { id, name: searchParams.get("organizationName") ?? "Organization" }
      : null;
  });
  const [agent, setAgent] = useState<NamedFilter | null>(() => {
    const id = searchParams.get("agentId");
    return id ? { id, name: searchParams.get("agentName") ?? "Agent" } : null;
  });
  const [provider, setProvider] = useState<string | undefined>(
    () => searchParams.get("provider") ?? undefined,
  );
  const [feature, setFeature] = useState<UsageFeatureKey | undefined>(() =>
    pick(searchParams.get("feature"), USAGE_FEATURES),
  );
  const [channel, setChannel] = useState<UsageChannelKey | undefined>(() =>
    pick(searchParams.get("channel"), USAGE_CHANNELS),
  );
  const [billedTo, setBilledTo] = useState<BilledToKey | undefined>(() =>
    pick(searchParams.get("billedTo"), BILLED_TO),
  );
  const [conversationId, setConversationId] = useState("");

  const filters: UsageFilters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organizationId: org?.id,
      agentId: agent?.id,
      provider,
      feature,
      channel,
      billedTo,
    }),
    [range, org, agent, provider, feature, channel, billedTo],
  );

  useEffect(() => {
    // Without access the redirect above owns the URL; a replace here would
    // run after it and cancel it.
    if (!canRead) return;
    const params = new URLSearchParams();
    params.set("from", range.from);
    params.set("to", range.to);
    if (org) {
      params.set("organizationId", org.id);
      params.set("organizationName", org.name);
    }
    if (agent) {
      params.set("agentId", agent.id);
      params.set("agentName", agent.name);
    }
    if (provider) params.set("provider", provider);
    if (feature) params.set("feature", feature);
    if (channel) params.set("channel", channel);
    if (billedTo) params.set("billedTo", billedTo);
    routerRef.current.replace(`?${params.toString()}`, { scroll: false });
  }, [canRead, range, org, agent, provider, feature, channel, billedTo]);

  // All six requests start together; none waits on another.
  const summary = useUsageSummary(filters);
  const timeseries = useUsageTimeseries(filters);
  const unit = useUnitEconomics(filters);
  const orgs = useUsageOrganizations(filters);
  const agents = useUsageAgents(filters);
  const exportCsv = useUsageExport();

  const handleRange = useCallback((from: string, to: string) => {
    setRange(from && to ? { from, to } : defaultRange());
  }, []);

  const handleExport = () => {
    exportCsv.mutate(filters, {
      onSuccess: (name) => toast.success(`Downloaded ${name}`),
      onError: (err) => toast.error(err.message || "Export failed"),
    });
  };

  const openConversation = (e: React.FormEvent) => {
    e.preventDefault();
    const id = conversationId.trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      toast.error("Paste the full conversation id (a UUID)");
      return;
    }
    router.push(`/dashboard/admin/usage/conversations/${id}`);
  };

  const chips = [
    org && { key: "org", label: org.name, clear: () => setOrg(null) },
    agent && { key: "agent", label: agent.name, clear: () => setAgent(null) },
    provider && {
      key: "provider",
      label: provider,
      clear: () => setProvider(undefined),
    },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  if (permsLoading || !canRead) return <UsagePageSkeleton />;

  const s = summary.data;
  const fx = s?.fx;
  const kpiLoading = summary.isLoading;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePresets
            fromValue={range.from}
            toValue={range.to}
            onChange={handleRange}
          />
          <DateRangePicker
            fromValue={range.from}
            toValue={range.to}
            onChange={handleRange}
            placeholder="Pick a date range"
            showClear={false}
            triggerClassName="w-[230px]"
          />
          <EnumSelect
            value={feature}
            onChange={setFeature}
            options={USAGE_FEATURES}
            labels={FEATURE_LABELS}
            allLabel="All features"
          />
          <EnumSelect
            value={channel}
            onChange={setChannel}
            options={USAGE_CHANNELS}
            labels={CHANNEL_LABELS}
            allLabel="All channels"
          />
          <EnumSelect
            value={billedTo}
            onChange={setBilledTo}
            options={BILLED_TO}
            labels={BILLED_TO_LABELS}
            allLabel="Our cost and client"
          />
          <Button
            variant="outline"
            className="ml-auto gap-2"
            onClick={handleExport}
            disabled={exportCsv.isPending}
          >
            <Download className="size-4" />
            {exportCsv.isPending ? "Exporting..." : "Export CSV"}
          </Button>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                className="group inline-flex items-center gap-1 rounded-full border bg-muted/50 py-1 pl-2.5 pr-2 text-xs transition-colors hover:bg-muted"
              >
                <span className="max-w-48 truncate">{chip.label}</span>
                <X className="size-3 text-muted-foreground group-hover:text-foreground" />
              </button>
            ))}
          </div>
        )}

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {fx && !fx.available
            ? "No USD to INR rate is stored yet, so INR figures are hidden. Native amounts are still shown."
            : `Days are UTC. Costs are kept in the provider's currency and converted to INR with the stored daily rate for each call's date${
                fx?.latestUsdToInr
                  ? ` (latest: ₹${fx.latestUsdToInr.toFixed(2)} per USD on ${fx.latestDate})`
                  : ""
              }. Click a row to filter by it.`}
        </p>
      </div>

      {summary.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {summary.error?.message || "Failed to load usage"}
        </div>
      )}

      {s && s.totals.unpricedRows > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            {formatCount(s.totals.unpricedRows)} calls in this range have no
            price, so the totals below leave them out.
          </span>
          <Link
            href="/dashboard/admin/prices"
            className="font-medium underline underline-offset-4"
          >
            Add the missing prices
          </Link>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total cost"
          value={formatInr(s?.totals.costInr)}
          icon={IndianRupee}
          isLoading={kpiLoading}
          info={
            <p>
              Our own provider cost in range, in INR. Client pass-through is
              shown apart.
            </p>
          }
        />
        <KpiCard
          title="LLM"
          value={formatInr(s?.byCategory.LLM.costInr)}
          icon={Brain}
          isLoading={kpiLoading}
          info={
            <p>
              Chat replies, summaries, titles, classifier, data extraction and
              retrieval.
            </p>
          }
        />
        <KpiCard
          title="Speech to text"
          value={formatInr(s?.byCategory.STT.costInr)}
          icon={AudioLines}
          isLoading={kpiLoading}
        />
        <KpiCard
          title="Text to speech"
          value={formatInr(s?.byCategory.TTS.costInr)}
          icon={Speaker}
          isLoading={kpiLoading}
          info={<p>Spoken replies and editor voice previews.</p>}
        />
        <KpiCard
          title="Other"
          value={formatInr(s?.byCategory.OTHER.costInr)}
          icon={Package}
          isLoading={kpiLoading}
          info={<p>Emails and any WhatsApp charges we pay ourselves.</p>}
        />
        <KpiCard
          title="Cost per conversation"
          value={formatInr(unit.data?.perConversation.avgInr)}
          icon={MessageSquare}
          isLoading={unit.isLoading}
          info={
            <p>
              Average of each conversation&apos;s own cost. Median and p90 are
              below.
            </p>
          }
        />
        <KpiCard
          title="Client pass-through"
          value={formatInr(s?.totals.clientCostInr)}
          icon={Handshake}
          isLoading={kpiLoading}
          info={
            <p>
              Billed by the provider to the client directly, for example
              WhatsApp messages on the client&apos;s own account. Not our cost.
            </p>
          }
        />
        <KpiCard
          title="Calls with no price"
          value={formatCount(s?.totals.unpricedRows)}
          icon={AlertTriangle}
          isLoading={kpiLoading}
          info={
            <p>
              Recorded with their usage but no matching price row, so they add
              nothing to cost.
            </p>
          }
        />
      </div>

      {s && (
        <p className="text-xs text-muted-foreground">
          {formatCount(s.totals.rows)} calls across{" "}
          {formatCount(s.totals.conversations)} conversations. In provider
          currency: {formatNative(s.totals.native)}.{" "}
          {Object.entries(s.quantitySources)
            .filter(([, n]) => n > 0)
            .map(
              ([k, n]) =>
                `${QUANTITY_SOURCE_LABELS[k] ?? k} ${Math.round((n / Math.max(s.totals.rows, 1)) * 100)}%`,
            )
            .join(", ")}
        </p>
      )}

      {/* Daily chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Daily cost</CardTitle>
          <CardDescription>
            {billedTo === "CLIENT" ? "Client pass-through" : "Our cost"} per UTC
            day, in INR
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeseries.isLoading ? (
            <Skeleton className="h-70 w-full" />
          ) : timeseries.isError ? (
            <p className="flex h-70 items-center justify-center text-sm text-destructive">
              Failed to load the chart
            </p>
          ) : timeseries.data && !timeseries.data.fx.available ? (
            <p className="flex h-70 items-center justify-center text-sm text-muted-foreground">
              No exchange rate stored, so there is no INR chart yet
            </p>
          ) : timeseries.data ? (
            <UsageDailyChart data={timeseries.data} />
          ) : null}
        </CardContent>
      </Card>

      <UsageSection
        title="By provider and model"
        isLoading={summary.isLoading}
        isError={summary.isError}
        isEmpty={!s?.byProviderModel.length}
      >
        {s && (
          <ProviderModelTable
            rows={s.byProviderModel}
            onSelectProvider={setProvider}
          />
        )}
      </UsageSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <UsageSection
          title="By feature"
          isLoading={summary.isLoading}
          isError={summary.isError}
          isEmpty={!s?.byFeature.length}
        >
          {s && (
            <FeatureTable
              summary={s}
              onSelect={(f) => setFeature(pick(f, USAGE_FEATURES))}
            />
          )}
        </UsageSection>
        <UsageSection
          title="By channel"
          isLoading={summary.isLoading}
          isError={summary.isError}
          isEmpty={!s?.byChannel.length}
        >
          {s && (
            <ChannelTable
              summary={s}
              onSelect={(c) => setChannel(pick(c, USAGE_CHANNELS))}
            />
          )}
        </UsageSection>
      </div>

      <UsageSection
        title="Unit economics"
        description="Our own cost unless client pass-through is selected."
        isLoading={unit.isLoading}
        isError={unit.isError}
        isEmpty={false}
      >
        {unit.data && <UnitEconomicsPanel data={unit.data} />}
      </UsageSection>

      <UsageSection
        title="Most expensive conversations"
        description="Open one to see every call it made, line by line."
        isLoading={unit.isLoading}
        isError={unit.isError}
        isEmpty={!unit.data?.topConversations.length}
      >
        {unit.data && (
          <TopConversationsTable rows={unit.data.topConversations} />
        )}
      </UsageSection>

      <form
        onSubmit={openConversation}
        className="flex max-w-xl items-center gap-2"
      >
        <Input
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          placeholder="Paste a conversation id to see its cost"
          aria-label="Conversation id"
          className="font-mono text-xs"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!conversationId.trim()}
        >
          Open
        </Button>
      </form>

      <UsageSection
        title="Organizations"
        isLoading={orgs.isLoading}
        isError={orgs.isError}
        isEmpty={!orgs.data?.rows.length}
      >
        {orgs.data && (
          <OrganizationsTable
            rows={orgs.data.rows}
            onSelect={(id, name) => setOrg({ id, name })}
          />
        )}
      </UsageSection>

      <UsageSection
        title="Agents"
        isLoading={agents.isLoading}
        isError={agents.isError}
        isEmpty={!agents.data?.rows.length}
      >
        {agents.data && (
          <AgentsTable
            rows={agents.data.rows}
            onSelect={(id, name) => setAgent({ id, name })}
          />
        )}
      </UsageSection>
    </div>
  );
}

function EnumSelect<T extends string>({
  value,
  onChange,
  options,
  labels,
  allLabel,
}: {
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  options: readonly T[];
  labels: Record<string, string>;
  allLabel: string;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? undefined : (v as T))}
    >
      <SelectTrigger className="w-[180px]" aria-label={allLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels[o] ?? o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
