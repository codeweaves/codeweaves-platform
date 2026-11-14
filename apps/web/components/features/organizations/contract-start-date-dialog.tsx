"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateOrganizationContract } from "@/hooks/use-organizations";
import { formatDay, parseDay, toDay } from "./contract-format";

interface ContractStartDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** 'YYYY-MM-DD' or null. */
  currentDate: string | null;
}

/**
 * Edits the contract start date. The date is for records only: the server
 * counts usage from the moment the limit was set, never from this date.
 */
export function ContractStartDateDialog({
  open,
  onOpenChange,
  organizationId,
  currentDate,
}: ContractStartDateDialogProps) {
  const updateContract = useUpdateOrganizationContract();
  const isSaving = updateContract.isPending;

  const save = async (contractStartDate: string | null) => {
    try {
      await updateContract.mutateAsync({
        id: organizationId,
        data: { contractStartDate },
      });
      toast.success(
        contractStartDate === null
          ? "Contract start date cleared"
          : "Contract start date saved",
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save the contract start date",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSaving && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        {/* DialogContent unmounts when closed, so the picked date resets on every open. */}
        <StartDateForm
          currentDate={currentDate}
          isSaving={isSaving}
          onSave={save}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const FIRST_YEAR = 2015;

function StartDateForm({
  currentDate,
  isSaving,
  onSave,
  onCancel,
}: {
  currentDate: string | null;
  isSaving: boolean;
  onSave: (day: string | null) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentDate);
  // Read the clock once per open, not on every render.
  const [today] = useState(() => new Date());
  const labelId = useId();
  const selectedDate = selected ? parseDay(selected) : undefined;
  const isUnchanged = selected === currentDate;
  const lastYear = today.getFullYear() + 5;

  return (
    <>
      <DialogHeader className="space-y-2">
        <DialogTitle>Contract start date</DialogTitle>
        <DialogDescription>
          This date is for your records. It does not change how conversations
          are counted.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-4">
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex justify-center"
        >
          <span id={labelId} className="sr-only">
            Contract start date
          </span>
          <Calendar
            mode="single"
            captionLayout="dropdown"
            startMonth={new Date(FIRST_YEAR, 0)}
            endMonth={new Date(lastYear, 11)}
            defaultMonth={selectedDate ?? today}
            selected={selectedDate}
            onSelect={(date) => setSelected(date ? toDay(date) : null)}
            disabled={isSaving}
            className="rounded-md border"
          />
        </div>
        <p className="text-center text-sm" aria-live="polite">
          {selected ? (
            <>
              <span className="text-muted-foreground">Selected: </span>
              <span className="font-medium">{formatDay(selected)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No date selected</span>
          )}
        </p>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelected(null)}
            disabled={isSaving}
          >
            Clear date
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
          <Button
            type="button"
            onClick={() => onSave(selected)}
            disabled={isUnchanged || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
