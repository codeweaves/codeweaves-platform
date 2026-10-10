import type { Currency, PriceUnit } from "@prisma/client";

/**
 * Pure cost math for one provider call (ADR-0012). No I/O: the caller supplies
 * the quantities the provider reported and a lookup for the unit prices.
 *
 * Token conventions (docs/research/provider-costs/llm.md): every provider we
 * use, and the AI SDK, report input tokens INCLUSIVE of cache reads and cache
 * writes, and output tokens INCLUSIVE of reasoning/thinking tokens. So the
 * uncached input is `input - cached - cacheWrite`, and reasoning is never billed
 * on top of output.
 */
export interface UsageQuantities {
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
  /** Informational only: already inside outputTokens. */
  reasoningTokens?: number | null;
  audioSeconds?: number | null;
  characters?: number | null;
  /** Messages or emails. */
  units?: number | null;
}

export interface UnitPrice {
  id: string;
  unit: PriceUnit;
  /** Amount for `per` units, in `currency`. */
  price: number;
  per: number;
  currency: Currency;
}

/** One line of the per-call breakdown, stored as `usage_records.pricing`. */
export interface PricingLine {
  unit: PriceUnit;
  quantity: number;
  priceId: string | null;
  price: number | null;
  per: number | null;
  amount: number | null;
}

export interface PricedCall {
  /** Null when a billed unit has no price, or prices mix currencies. */
  cost: number | null;
  currency: Currency | null;
  lines: PricingLine[];
}

/**
 * How a provider rounds billed audio. Sarvam bills whole seconds with a 1 s
 * minimum; Deepgram and ElevenLabs bill the exact duration
 * (docs/research/provider-costs/voice.md).
 */
const AUDIO_ROUNDING: Record<string, (seconds: number) => number> = {
  sarvam: (s) => Math.ceil(Math.max(s, 1)),
};

const nonNegative = (n: number | null | undefined): number =>
  n && n > 0 ? n : 0;

/** The quantity billed for each unit, before prices. Zero units are left out. */
export function billableQuantities(
  provider: string,
  q: UsageQuantities,
): Partial<Record<PriceUnit, number>> {
  const cached = nonNegative(q.cachedInputTokens);
  const cacheWrite = nonNegative(q.cacheWriteTokens);
  const uncachedInput = Math.max(
    nonNegative(q.inputTokens) - cached - cacheWrite,
    0,
  );
  const audio = nonNegative(q.audioSeconds);
  const round = AUDIO_ROUNDING[provider] ?? ((s: number) => s);

  const out: Partial<Record<PriceUnit, number>> = {
    INPUT_TOKEN: uncachedInput,
    CACHED_INPUT_TOKEN: cached,
    CACHE_WRITE_TOKEN: cacheWrite,
    OUTPUT_TOKEN: nonNegative(q.outputTokens),
    AUDIO_SECOND: audio > 0 ? round(audio) : 0,
    CHARACTER: nonNegative(q.characters),
  };
  // `units` is a message or an email count; the caller's price decides which.
  if (nonNegative(q.units) > 0) {
    out.MESSAGE = nonNegative(q.units);
    out.EMAIL = nonNegative(q.units);
  }
  for (const unit of Object.keys(out) as PriceUnit[]) {
    if (!out[unit]) delete out[unit];
  }
  return out;
}

const round8 = (n: number): number => Math.round(n * 1e8) / 1e8;

/**
 * Price one call. `lookup` returns the price for a unit, or undefined. For
 * `units`, MESSAGE and EMAIL are both offered and whichever has a price is
 * used: a provider bills one or the other, never both.
 */
export function priceCall(
  provider: string,
  q: UsageQuantities,
  lookup: (unit: PriceUnit) => UnitPrice | undefined,
): PricedCall {
  const quantities = billableQuantities(provider, q);
  const lines: PricingLine[] = [];
  const currencies = new Set<Currency>();
  let missing = false;

  for (const [unit, quantity] of Object.entries(quantities) as Array<
    [PriceUnit, number]
  >) {
    const p = lookup(unit);
    if (!p) {
      // MESSAGE/EMAIL are alternatives for `units`; only one is priced.
      if (unit === "MESSAGE" || unit === "EMAIL") continue;
      missing = true;
      lines.push({
        unit,
        quantity,
        priceId: null,
        price: null,
        per: null,
        amount: null,
      });
      continue;
    }
    currencies.add(p.currency);
    lines.push({
      unit,
      quantity,
      priceId: p.id,
      price: p.price,
      per: p.per,
      amount: round8((quantity * p.price) / p.per),
    });
  }

  if (
    q.units &&
    !lines.some((l) => l.unit === "MESSAGE" || l.unit === "EMAIL")
  ) {
    missing = true;
    lines.push({
      unit: "MESSAGE",
      quantity: nonNegative(q.units),
      priceId: null,
      price: null,
      per: null,
      amount: null,
    });
  }

  // Nothing billable (e.g. a call that returned zero tokens) costs nothing.
  if (lines.length === 0) return { cost: 0, currency: null, lines };

  if (missing || currencies.size > 1) {
    return { cost: null, currency: null, lines };
  }
  const cost = round8(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
  return { cost, currency: [...currencies][0] ?? null, lines };
}
