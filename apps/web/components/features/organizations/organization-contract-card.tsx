"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Gauge,
  Loader2,
  Pencil,
  RotateCw,
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useOrganizationContract,
  type OrganizationContract,
  type OrganizationContractAlert,
} from "@/hooks/use-organizations";
import { ConversationLimitDialog } from "./conversation-limit-dialog";
import { ContractStartDateDialog } from "./contract-start-date-dialog";
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatTimestamp,
  pluralConversations,
} from "./contract-format";

const ALERT_THRESHOLDS = [50, 90, 100] as const;

/** At or above this share the bar turns amber, matching the 90% alert email. */
const WARNING_PERCENT = 90;

interface OrganizationContractCardProps {
  organizationId: string;
  /** `OrganizationContract:Update`. Without it the card is read-only. */
  canEdit: boolean;
}

/**
 * Contract terms and conversation usage for one organization. The limit is an
 * alert only: reaching it never stops the agents. Render this only for users
 * who hold `OrganizationContract:Read`; the query runs as soon as it mounts.
 */
export function OrganizationContractCard({
  organizationId,
  canEdit,
}: OrganizationContractCardProps) {
  const contractQuery = useOrganizationContract(organizationId, true);
  const [limitOpen, setLimitOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const contract = contractQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract</CardTitle>
        <CardDescription>
          Conversation limit and usage. Agents keep working when the limit is
          reached.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {contractQuery.isPending ? (
          <ContractSkeleton />
        ) : contractQuery.isError ? (
          <ContractError
            message={contractQuery.error.message}
            retrying={contractQuery.isFetching}
            onRetry={() => void contractQuery.refetch()}
          />
        ) : (
          <ContractDetails
            contract={contractQuery.data}
            canEdit={canEdit}
            onEditLimit={() => setLimitOpen(true)}
            onEditDate={() => setDateOpen(true)}
          />
        )}
      </CardContent>

      {canEdit && contract && (
        <>
          <ConversationLimitDialog
            open={limitOpen}
            onOpenChange={setLimitOpen}
            organizationId={organizationId}
            currentLimit={contract.conversationLimit}
            conversationsUsed={contract.conversationsUsed}
          />
          <ContractStartDateDialog
            open={dateOpen}
            onOpenChange={setDateOpen}
            organizationId={organizationId}
            currentDate={contract.contractStartDate}
          />
        </>
      )}
    </Card>
  );
}

function ContractDetails({
  contract,
  canEdit,
  onEditLimit,
  onEditDate,
}: {
  contract: OrganizationContract;
  canEdit: boolean;
  onEditLimit: () => void;
  onEditDate: () => void;
}) {
  const limit = contract.conversationLimit;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Contract start date"
          value={
            contract.contractStartDate
              ? formatDay(contract.contractStartDate)
              : null
          }
          emptyText="Not set"
          action={
            canEdit ? (
              <Button variant="outline" size="sm" onClick={onEditDate}>
                <Pencil className="size-3.5" />
                Edit
                <span className="sr-only"> contract start date</span>
              </Button>
            ) : null
          }
        />
        <Field
          label="Conversation limit"
          value={
            limit === null
              ? null
              : `${formatCount(limit)} ${pluralConversations(limit)}`
          }
          emptyText="No limit"
          action={
            // With no limit, the empty state below holds the one "Set limit" action.
            canEdit && limit !== null ? (
              <Button variant="outline" size="sm" onClick={onEditLimit}>
                <Pencil className="size-3.5" />
                Change limit
              </Button>
            ) : null
          }
        />
      </div>

      {limit === null ? (
        <NoLimitState canEdit={canEdit} onSetLimit={onEditLimit} />
      ) : (
        <Usage contract={contract} limit={limit} />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  emptyText,
  action,
}: {
  label: string;
  value: string | null;
  emptyText: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-lg font-semibold",
            value === null && "text-muted-foreground",
          )}
        >
          {value ?? emptyText}
        </p>
      </div>
      {action}
    </div>
  );
}

function Usage({
  contract,
  limit,
}: {
  contract: OrganizationContract;
  limit: number;
}) {
  const used = contract.conversationsUsed;
  const percent = contract.percentUsed ?? Math.floor((used / limit) * 100);
  const remaining =
    contract.conversationsRemaining ?? Math.max(limit - used, 0);
  const overBy = used - limit;
  const isOver = overBy > 0;
  const isWarning = percent >= WARNING_PERCENT;
  // Radix treats a value above `max` as invalid, so the bar stops at full.
  const barValue = Math.min(Math.max(percent, 0), 100);
  const usedLabel = `${formatCount(used)} of ${formatCount(limit)} ${pluralConversations(limit)} used`;

  return (
    <div className="space-y-5">
      {isOver && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-warning-foreground/30 bg-warning p-4 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-warning-foreground"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="font-medium text-warning-foreground">
              Over the limit by {formatCount(overBy)}{" "}
              {pluralConversations(overBy)}
            </p>
            <p className="text-muted-foreground">
              Agents keep working. The limit only sends alerts. Change the limit
              if the contract allows more conversations.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p>
            <span className="text-2xl font-bold">{formatCount(used)}</span>
            <span className="text-muted-foreground">
              {" "}
              of {formatCount(limit)} used
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            <span
              className={cn(
                "font-medium",
                isWarning ? "text-warning-foreground" : "text-foreground",
              )}
            >
              {percent}%
            </span>
            {" · "}
            {isOver ? "None remaining" : `${formatCount(remaining)} remaining`}
          </p>
        </div>
        <Progress
          value={barValue}
          aria-label="Conversations used"
          getValueLabel={() => `${usedLabel}, ${percent}%`}
          className={cn(
            isWarning &&
              "bg-warning [&_[data-slot=progress-indicator]]:bg-warning-foreground",
          )}
        />
        {contract.conversationLimitSetAt && (
          <p className="text-xs text-muted-foreground">
            Counting since {formatDateTime(contract.conversationLimitSetAt)}
          </p>
        )}
      </div>

      <AlertStatus alerts={contract.alerts} />
    </div>
  );
}

function AlertStatus({ alerts }: { alerts: OrganizationContractAlert[] }) {
  // The API stores one row per level reached, stamped with the email that
  // covered it, so `sentAt` is when that level was reached.
  const reachedAtByLevel = new Map(alerts.map((a) => [a.threshold, a.sentAt]));

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium">Alert levels</p>
        <p className="text-xs text-muted-foreground">
          Super admins get an email when a level is reached, and one email
          covers all levels reached at the same time.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {ALERT_THRESHOLDS.map((threshold) => {
          const reachedAt = reachedAtByLevel.get(threshold);
          return (
            <li
              key={threshold}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{threshold}%</span>
              {reachedAt ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="success">Reached</Badge>
                  {formatTimestamp(reachedAt)}
                </span>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not yet
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NoLimitState({
  canEdit,
  onSetLimit,
}: {
  canEdit: boolean;
  onSetLimit: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center">
      <Gauge className="size-8 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-3 font-medium">No conversation limit</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Set a limit to track how many conversations this organization uses.
        Super admins get an email when usage reaches 50%, 90% or 100% of the
        limit. Agents keep working when the limit is reached.
      </p>
      {canEdit && (
        <Button size="sm" className="mt-4" onClick={onSetLimit}>
          Set limit
        </Button>
      )}
    </div>
  );
}

function ContractError({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-8 text-center"
    >
      <AlertCircle className="size-8 text-destructive/60" aria-hidden="true" />
      <p className="mt-3 font-medium">Could not load the contract</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCw className="size-4" />
        )}
        Try again
      </Button>
    </div>
  );
}

function ContractSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading contract">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-40" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}
