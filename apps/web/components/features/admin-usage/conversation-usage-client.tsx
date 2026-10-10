"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, ArrowLeft, Info } from "lucide-react";
import { usePageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useConversationUsage,
  type ConversationUsageLine,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CHANNEL_LABELS,
  FEATURE_LABELS,
  QUANTITY_SOURCE_LABELS,
  UNIT_LABELS,
  describeQuantity,
  formatDateTime,
  formatInr,
  formatMoney,
} from "./usage-format";

/** How each unit price was applied, e.g. "1,000 Input token at $0.40 per 1M". */
function PricingDetail({ line }: { line: ConversationUsageLine }) {
  if (!line.pricing?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {line.pricing.map((p) => (
        <li key={p.unit}>
          {p.quantity.toLocaleString("en-IN")}{" "}
          {UNIT_LABELS[p.unit]?.toLowerCase() ?? p.unit}
          {p.price !== null && p.per !== null
            ? ` at ${formatMoney(p.price, line.currency)} per ${p.per.toLocaleString("en-IN")}`
            : " (no price)"}
        </li>
      ))}
    </ul>
  );
}

export function ConversationUsageClient({
  chatSessionId,
}: {
  chatSessionId: string;
}) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const { setTitle } = usePageHeader();
  const canRead = can("Usage:Read");
  const { data, isLoading, isError, error } =
    useConversationUsage(chatSessionId);

  useEffect(() => {
    setTitle("Conversation cost");
    return () => setTitle("");
  }, [setTitle]);

  useEffect(() => {
    if (!permsLoading && !canRead) router.replace("/dashboard");
  }, [permsLoading, canRead, router]);

  if (permsLoading || !canRead) return null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1">
        <Link href="/dashboard/admin/usage">
          <ArrowLeft className="size-4" />
          Usage & cost
        </Link>
      </Button>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isError || !data ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <AlertCircle className="size-4 shrink-0" />
            {error?.message || "No usage recorded for this conversation"}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                {data.agentName ?? "No agent"}
                {data.organizationName && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    / {data.organizationName}
                  </span>
                )}
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {data.chatSessionId}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-8">
              <div>
                <p className="text-xs text-muted-foreground">Our cost</p>
                <p className="text-2xl font-bold tabular-nums">
                  {formatInr(data.totalInr)}
                </p>
              </div>
              {data.clientTotalInr !== null && data.clientTotalInr > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">
                    Client pass-through
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatInr(data.clientTotalInr)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Calls</p>
                <p className="text-2xl font-bold tabular-nums">
                  {data.lines.length}
                </p>
              </div>
            </CardContent>
          </Card>

          {data.unpricedLines > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              {data.unpricedLines}{" "}
              {data.unpricedLines === 1 ? "call has" : "calls have"} no price
              and {data.unpricedLines === 1 ? "is" : "are"} not in the total.
              <Link
                href="/dashboard/admin/prices"
                className="font-medium underline underline-offset-4"
              >
                Prices
              </Link>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {data.fx.available
              ? "Each USD cost is converted to INR with the stored USD to INR rate for the call's UTC date, or the nearest earlier day. INR costs need no conversion."
              : "No USD to INR rate is stored yet, so INR figures are hidden."}
          </p>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Provider / model</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead className="text-right">
                      Cost in provider currency
                    </TableHead>
                    <TableHead className="text-right">
                      USD to INR rate
                    </TableHead>
                    <TableHead className="text-right">Cost in INR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((line) => (
                    <TableRow key={line.id} className="align-top">
                      <TableCell>
                        <span className="font-medium">
                          {FEATURE_LABELS[line.feature] ?? line.feature}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDateTime(line.occurredAt)} ·{" "}
                          {CHANNEL_LABELS[line.channel] ?? line.channel}
                        </span>
                        {line.billedTo === "CLIENT" && (
                          <Badge variant="secondary" className="mt-1">
                            Client pays
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span>{line.provider}</span>
                        <span className="block text-xs text-muted-foreground">
                          {line.model}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {describeQuantity(line)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {QUANTITY_SOURCE_LABELS[line.quantitySource] ??
                            line.quantitySource}
                        </span>
                        <PricingDetail line={line} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.cost === null ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 text-amber-700 dark:text-amber-400"
                          >
                            No price
                          </Badge>
                        ) : (
                          formatMoney(line.cost, line.currency)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {line.fxRate !== null ? (
                          <>
                            ₹{line.fxRate.toFixed(4)}
                            {line.fxDate && (
                              <span className="block">{line.fxDate}</span>
                            )}
                          </>
                        ) : line.currency === "INR" ? (
                          "Not needed"
                        ) : (
                          "n/a"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatInr(line.costInr)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="font-medium">
                      Total, our cost
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatInr(data.totalInr)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
