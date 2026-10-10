"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  PRICE_CURRENCIES,
  PRICE_UNITS,
  createProviderPriceSchema,
  type PriceCurrencyKey,
  type PriceUnitKey,
} from "@repo/validation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAddPrice } from "@/hooks/use-usage";
import { UNIT_LABELS } from "./usage-format";

export interface PriceDraft {
  provider: string;
  model: string;
  unit: PriceUnitKey;
  currency: PriceCurrencyKey;
  per?: string;
}

interface FormState {
  provider: string;
  model: string;
  unit: PriceUnitKey;
  price: string;
  per: string;
  currency: PriceCurrencyKey;
  effectiveFrom: string;
  sourceUrl: string;
  note: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initial(draft?: PriceDraft): FormState {
  return {
    provider: draft?.provider ?? "",
    model: draft?.model ?? "",
    unit: draft?.unit ?? "INPUT_TOKEN",
    price: "",
    per: draft?.per ?? "1000000",
    currency: draft?.currency ?? "USD",
    effectiveFrom: today(),
    sourceUrl: "",
    note: "",
  };
}

/**
 * Adds a new effective-dated price row. Never edits a row: past calls keep the
 * price they were priced with, and new calls use this row from its start date.
 */
export function AddPriceDialog({
  draft,
  trigger,
}: {
  /** Prefill from an existing price or an unpriced model. */
  draft?: PriceDraft;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initial(draft));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addPrice = useAddPrice();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setForm(initial(draft));
      setErrors({});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = createProviderPriceSchema.safeParse({
      provider: form.provider,
      model: form.model,
      unit: form.unit,
      price: form.price.trim() === "" ? Number.NaN : Number(form.price),
      per: form.per.trim() === "" ? Number.NaN : Number(form.per),
      currency: form.currency,
      effectiveFrom: form.effectiveFrom,
      sourceUrl: form.sourceUrl,
      note: form.note.trim() || undefined,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await addPrice.mutateAsync(parsed.data);
      toast.success("Price added");
      setOpen(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : "Failed to add the price",
      });
    }
  };

  const field = (id: keyof FormState) =>
    errors[id] ? (
      <p className="text-xs text-destructive">{errors[id]}</p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <Plus className="size-4" />
            Add price
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add a price</DialogTitle>
            <DialogDescription>
              This adds a new row that applies from its start date. Existing
              rows are never edited, and calls already recorded keep the cost
              they were priced with.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="price-provider">Provider</Label>
              <Input
                id="price-provider"
                placeholder="openai"
                value={form.provider}
                onChange={(e) => set("provider", e.target.value)}
                maxLength={40}
              />
              {field("provider")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-model">Model</Label>
              <Input
                id="price-model"
                placeholder="gpt-4.1-mini, or * for any model"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                maxLength={120}
              />
              {field("model")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-unit">Unit</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => set("unit", v as PriceUnitKey)}
              >
                <SelectTrigger id="price-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-currency">Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => set("currency", v as PriceCurrencyKey)}
              >
                <SelectTrigger id="price-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-amount">Price</Label>
              <Input
                id="price-amount"
                inputMode="decimal"
                placeholder="0.40"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
              />
              {field("price")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-per">Per how many units</Label>
              <Input
                id="price-per"
                inputMode="numeric"
                placeholder="1000000"
                value={form.per}
                onChange={(e) => set("per", e.target.value)}
              />
              {field("per")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-from">Effective from (UTC)</Label>
              <Input
                id="price-from"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => set("effectiveFrom", e.target.value)}
              />
              {field("effectiveFrom")}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price-source">Source URL</Label>
              <Input
                id="price-source"
                type="url"
                placeholder="https://provider.com/pricing"
                value={form.sourceUrl}
                onChange={(e) => set("sourceUrl", e.target.value)}
                maxLength={500}
              />
              {field("sourceUrl")}
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="price-note">Note (optional)</Label>
              <Textarea
                id="price-note"
                rows={2}
                placeholder="For example: invoice for October, GST excluded"
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
                maxLength={500}
              />
              {field("note")}
            </div>
            {errors.form && (
              <p className="text-sm text-destructive sm:col-span-2">
                {errors.form}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={addPrice.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addPrice.isPending}>
              {addPrice.isPending ? "Adding..." : "Add price"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
