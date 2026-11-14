"use client";

import { useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONVERSATION_LIMIT_MAX } from "@repo/validation";
import { useUpdateOrganizationContract } from "@/hooks/use-organizations";
import { formatCount, pluralConversations } from "./contract-format";

interface ConversationLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  currentLimit: number | null;
  /** Shown in the reset confirmation, so staff see what they are about to clear. */
  conversationsUsed: number;
}

type ParsedLimit =
  { value: number; error: null } | { value: null; error: string };

/** Accepts "17000", "17,000" or "17 000". Rejects decimals and anything else. */
function parseLimit(raw: string): ParsedLimit {
  const digits = raw.replace(/[\s,]/g, "");
  if (digits === "") return { value: null, error: "Enter a limit." };
  if (!/^\d+$/.test(digits))
    return { value: null, error: "Enter a whole number." };
  const value = Number(digits);
  if (value < 1 || value > CONVERSATION_LIMIT_MAX) {
    return {
      value: null,
      error: `Enter a number from 1 to ${formatCount(CONVERSATION_LIMIT_MAX)}.`,
    };
  }
  return { value, error: null };
}

/**
 * Sets, changes or removes the conversation limit. Saving always restarts the
 * count from zero on the server, even with the same number: that is how staff
 * start the next batch. Because the reset cannot be undone, saving over an
 * existing limit always goes through a confirm view first.
 */
export function ConversationLimitDialog({
  open,
  onOpenChange,
  organizationId,
  currentLimit,
  conversationsUsed,
}: ConversationLimitDialogProps) {
  const updateContract = useUpdateOrganizationContract();
  const isSaving = updateContract.isPending;

  const save = async (conversationLimit: number | null) => {
    try {
      await updateContract.mutateAsync({
        id: organizationId,
        data: { conversationLimit },
      });
      toast.success(
        conversationLimit === null
          ? "Conversation limit removed"
          : "Conversation limit saved",
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save the conversation limit",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSaving && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        {/* DialogContent unmounts when closed, so the form state resets on every open. */}
        <LimitForm
          currentLimit={currentLimit}
          conversationsUsed={conversationsUsed}
          isSaving={isSaving}
          onSave={save}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type View =
  | { kind: "form" }
  | { kind: "confirm-save"; limit: number }
  | { kind: "confirm-remove" };

function LimitForm({
  currentLimit,
  conversationsUsed,
  isSaving,
  onSave,
  onCancel,
}: {
  currentLimit: number | null;
  conversationsUsed: number;
  isSaving: boolean;
  onSave: (limit: number | null) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(
    currentLimit === null ? "" : String(currentLimit),
  );
  const [touched, setTouched] = useState(false);
  const [view, setView] = useState<View>({ kind: "form" });

  const parsed = parseLimit(raw);
  const showError = touched && parsed.error !== null;
  const hasLimit = currentLimit !== null;
  const backToForm = () => setView({ kind: "form" });

  // Enter in the input submits the form too, so this is the only path to a
  // save. Over an existing limit it opens the confirm view, never the save.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.value === null || isSaving) return;
    if (hasLimit) {
      setView({ kind: "confirm-save", limit: parsed.value });
      return;
    }
    onSave(parsed.value);
  };

  if (view.kind === "confirm-save" && currentLimit !== null) {
    return (
      <ConfirmNewCount
        currentLimit={currentLimit}
        newLimit={view.limit}
        conversationsUsed={conversationsUsed}
        isSaving={isSaving}
        onBack={backToForm}
        onConfirm={() => onSave(view.limit)}
      />
    );
  }

  if (view.kind === "confirm-remove") {
    return (
      <ConfirmRemove
        isSaving={isSaving}
        onBack={backToForm}
        onConfirm={() => onSave(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader className="space-y-2">
        <DialogTitle>
          {hasLimit ? "Change conversation limit" : "Set conversation limit"}
        </DialogTitle>
        <DialogDescription>
          Agents keep working when the limit is reached. Super admins get an
          email when usage reaches 50%, 90% or 100% of the limit.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="contract-conversation-limit">
            Conversation limit
          </Label>
          <Input
            id="contract-conversation-limit"
            inputMode="numeric"
            autoComplete="off"
            placeholder="17,000"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={isSaving}
            autoFocus
            aria-invalid={showError || undefined}
            aria-describedby={
              showError
                ? "contract-conversation-limit-error contract-conversation-limit-note"
                : "contract-conversation-limit-note"
            }
          />
          {showError && (
            <p
              id="contract-conversation-limit-error"
              className="text-sm text-destructive"
            >
              {parsed.error}
            </p>
          )}
        </div>

        <div
          id="contract-conversation-limit-note"
          className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            This starts a new count from zero, from now. Conversations before
            now are not counted.
            {hasLimit &&
              " The alert emails also start again for the new limit."}
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {hasLimit ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setView({ kind: "confirm-remove" })}
            disabled={isSaving}
          >
            Remove limit
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            <PendingLabel
              pending={isSaving}
              busy="Saving…"
              idle={hasLimit ? "Continue" : "Save limit"}
            />
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function PendingLabel({
  pending,
  busy,
  idle,
}: {
  pending: boolean;
  busy: string;
  idle: string;
}) {
  return pending ? (
    <>
      <Loader2 className="size-4 animate-spin" /> {busy}
    </>
  ) : (
    idle
  );
}

/** Saving over an existing limit clears the count for good, so say so with the real numbers. */
function ConfirmNewCount({
  currentLimit,
  newLimit,
  conversationsUsed,
  isSaving,
  onBack,
  onConfirm,
}: {
  currentLimit: number;
  newLimit: number;
  conversationsUsed: number;
  isSaving: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader className="space-y-2">
        <DialogTitle>Start a new count?</DialogTitle>
        <DialogDescription>
          The current count ({formatCount(conversationsUsed)} of{" "}
          {formatCount(currentLimit)} used) goes back to zero. This cannot be
          undone.
        </DialogDescription>
      </DialogHeader>
      <ul className="list-disc space-y-1 py-4 pl-5 text-sm text-muted-foreground">
        <li>
          {newLimit === currentLimit
            ? "The limit stays at "
            : "The new limit is "}
          <span className="font-medium text-foreground">
            {formatCount(newLimit)} {pluralConversations(newLimit)}
          </span>
          .
        </li>
        <li>
          Conversations from now on are counted. Conversations before now are
          not.
        </li>
        <li>Alert emails start again for the new count.</li>
      </ul>
      <DialogFooter className="gap-2">
        {/* Focus starts on Back: a second Enter must not reset the count. */}
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isSaving}
          autoFocus
        >
          Back
        </Button>
        <Button type="button" onClick={onConfirm} disabled={isSaving}>
          <PendingLabel
            pending={isSaving}
            busy="Saving…"
            idle="Start new count"
          />
        </Button>
      </DialogFooter>
    </>
  );
}

function ConfirmRemove({
  isSaving,
  onBack,
  onConfirm,
}: {
  isSaving: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader className="space-y-2">
        <DialogTitle>Remove conversation limit?</DialogTitle>
        <DialogDescription>
          This organization will have no limit. Conversations are not counted
          and no alert emails are sent. You can set a new limit at any time.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isSaving}
          autoFocus
        >
          Back
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={isSaving}
        >
          <PendingLabel
            pending={isSaving}
            busy="Removing…"
            idle="Remove limit"
          />
        </Button>
      </DialogFooter>
    </>
  );
}
