"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import type { PriceUnitKey } from "@repo/validation";
import { usePageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/use-permissions";
import {
  usePriceList,
  type PriceGroup,
  type PriceRow,
} from "@/hooks/use-usage";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddPriceDialog } from "./add-price-dialog";
import {
  FEATURE_LABELS,
  UNIT_LABELS,
  formatCount,
  formatDateTime,
} from "./usage-format";

/** Default `per` for a unit, so a prefilled form starts on the usual scale. */
const DEFAULT_PER: Record<string, string> = {
  INPUT_TOKEN: "1000000",
  CACHED_INPUT_TOKEN: "1000000",
  CACHE_WRITE_TOKEN: "1000000",
  OUTPUT_TOKEN: "1000000",
  AUDIO_SECOND: "3600",
  CHARACTER: "10000",
  MESSAGE: "1",
  EMAIL: "1",
};

/** The feature that recorded a call tells us which unit is probably missing. */
const FEATURE_UNIT: Record<string, PriceUnitKey> = {
  STT: "AUDIO_SECOND",
  TTS: "CHARACTER",
  VOICE_PREVIEW: "CHARACTER",
  WHATSAPP_MESSAGE: "MESSAGE",
  EMAIL: "EMAIL",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function priceText(row: PriceRow): string {
  const symbol =
    row.currency === "INR"
      ? "₹"
      : row.currency === "USD"
        ? "$"
        : `${row.currency} `;
  return `${symbol}${row.price} per ${Number(row.per).toLocaleString("en-IN")}`;
}

function SourceLink({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the raw text; the API only stores http(s) URLs.
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {host}
      <ExternalLink className="size-3" />
    </a>
  );
}

function HistoryRow({ row, label }: { row: PriceRow; label: string }) {
  return (
    <TableRow className="bg-muted/30 text-xs text-muted-foreground">
      <TableCell />
      <TableCell colSpan={2}>{label}</TableCell>
      <TableCell className="tabular-nums">{priceText(row)}</TableCell>
      <TableCell>{formatDay(row.effectiveFrom)}</TableCell>
      <TableCell>
        <SourceLink url={row.sourceUrl} />
        {row.note && <span className="block">{row.note}</span>}
      </TableCell>
    </TableRow>
  );
}

function PriceGroupRows({ group }: { group: PriceGroup }) {
  const [open, setOpen] = useState(false);
  const extra = group.upcoming.length + group.previous.length;
  const row = group.current ?? group.upcoming[0];
  return (
    <>
      <TableRow>
        <TableCell className="w-8 px-2">
          {extra > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Hide price history" : "Show price history"}
            >
              {open ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          )}
        </TableCell>
        <TableCell>
          <span className="font-medium">{group.provider}</span>
          <span className="block text-xs text-muted-foreground">
            {group.model === "*" ? "Any model" : group.model}
          </span>
        </TableCell>
        <TableCell>{UNIT_LABELS[group.unit] ?? group.unit}</TableCell>
        <TableCell className="tabular-nums">
          {row ? priceText(row) : "n/a"}
          {!group.current && (
            <Badge variant="outline" className="ml-2">
              Not in effect yet
            </Badge>
          )}
          {group.current && group.upcoming.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              Change scheduled
            </Badge>
          )}
        </TableCell>
        <TableCell>{row ? formatDay(row.effectiveFrom) : "n/a"}</TableCell>
        <TableCell className="max-w-72">
          {row && <SourceLink url={row.sourceUrl} />}
          {row?.note && (
            <span
              className="block truncate text-xs text-muted-foreground"
              title={row.note}
            >
              {row.note}
            </span>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <>
          {group.upcoming
            .filter((r) => r !== row)
            .map((r) => (
              <HistoryRow key={r.id} row={r} label="Starts later" />
            ))}
          {group.previous.map((r) => (
            <HistoryRow key={r.id} row={r} label="Replaced" />
          ))}
        </>
      )}
    </>
  );
}

export function PricesPageClient() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const { setTitle, setActions } = usePageHeader();
  const canRead = can("Usage:Read");
  const canCreate = can("Price:Create");
  const { data, isLoading, isError, error } = usePriceList();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setTitle("Prices");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    if (canCreate) setActions(<AddPriceDialog />);
    return () => setActions(null);
  }, [canCreate, setActions]);

  useEffect(() => {
    if (!permsLoading && !canRead) router.replace("/dashboard");
  }, [permsLoading, canRead, router]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return data?.groups ?? [];
    return data.groups.filter((g) =>
      `${g.provider} ${g.model} ${g.unit}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  if (permsLoading || !canRead) return null;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        The list price of each billable unit, used to cost every provider call.
        Rows are never edited: a price change is a new row with a later start
        date, so every recorded cost can be traced to the price it used.
      </p>

      {data && data.missing.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <AlertTriangle className="size-4 text-amber-600" />
              Calls with no price in the last 30 days
            </CardTitle>
            <CardDescription>
              These calls are recorded with their usage but add nothing to cost
              until a price exists. A new price only applies to calls made from
              its start date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider / model</TableHead>
                  <TableHead>Feature</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                  {canCreate && <TableHead className="w-32" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.missing.map((m) => {
                  const unit = FEATURE_UNIT[m.feature] ?? "INPUT_TOKEN";
                  return (
                    <TableRow key={`${m.provider}|${m.model}|${m.feature}`}>
                      <TableCell>
                        <span className="font-medium">{m.provider}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          / {m.model}
                        </span>
                      </TableCell>
                      <TableCell>
                        {FEATURE_LABELS[m.feature] ?? m.feature}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(m.rows)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDateTime(m.lastSeen)}
                      </TableCell>
                      {canCreate && (
                        <TableCell className="text-right">
                          <AddPriceDialog
                            draft={{
                              provider: m.provider,
                              model: m.model,
                              unit,
                              currency: "USD",
                              per: DEFAULT_PER[unit],
                            }}
                            trigger={
                              <Button variant="outline" size="sm">
                                Add price
                              </Button>
                            }
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base font-medium">Price list</CardTitle>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search provider or model"
            className="w-full sm:w-64"
            aria-label="Search prices"
          />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex h-24 items-center justify-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error?.message || "Failed to load prices"}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {search ? "No prices match your search" : "No prices yet"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Provider / model</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <PriceGroupRows
                    key={`${g.provider}|${g.model}|${g.unit}`}
                    group={g}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
