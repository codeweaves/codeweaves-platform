import { z } from "zod";

// ============================================
// Usage and cost console (ADR-0012), platform staff only
// ============================================

export const USAGE_FEATURES = [
  "CHAT",
  "SUMMARY",
  "TITLE",
  "CLASSIFIER",
  "DATA_EXTRACTION",
  "RAG",
  "EMBEDDING",
  "STT",
  "TTS",
  "VOICE_PREVIEW",
  "WHATSAPP_MESSAGE",
  "EMAIL",
] as const;
export type UsageFeatureKey = (typeof USAGE_FEATURES)[number];

export const USAGE_CHANNELS = [
  "WIDGET",
  "DASHBOARD",
  "WHATSAPP",
  "VOICE",
  "INTERNAL",
  "SYSTEM",
] as const;
export type UsageChannelKey = (typeof USAGE_CHANNELS)[number];

export const BILLED_TO = ["PLATFORM", "CLIENT"] as const;
export type BilledToKey = (typeof BILLED_TO)[number];

export const PRICE_UNITS = [
  "INPUT_TOKEN",
  "CACHED_INPUT_TOKEN",
  "CACHE_WRITE_TOKEN",
  "OUTPUT_TOKEN",
  "AUDIO_SECOND",
  "CHARACTER",
  "MESSAGE",
  "EMAIL",
] as const;
export type PriceUnitKey = (typeof PRICE_UNITS)[number];

export const PRICE_CURRENCIES = ["USD", "INR"] as const;
export type PriceCurrencyKey = (typeof PRICE_CURRENCIES)[number];

/** Longest range one report may cover. Keeps every query bounded. */
export const USAGE_MAX_RANGE_DAYS = 366;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * `YYYY-MM-DD` (a whole UTC day) or an ISO date-time with an explicit offset.
 * A bare local time is rejected: the server could only guess its zone.
 */
const isoDateOrDateTime = z
  .string()
  .trim()
  .refine((s) => DATE_ONLY.test(s) || DATE_TIME.test(s), {
    message: "Use YYYY-MM-DD or an ISO date-time with an offset",
  })
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid date" });

/** A date-only value is the start of that UTC day. */
export function parseUsageInstant(value: string): Date {
  return new Date(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
}

/**
 * Resolve `from`/`to` to a half-open UTC interval `[start, end)`.
 *
 * A date-only `to` covers that whole day, so `from=2026-10-01&to=2026-10-31`
 * means all of October. A date-time `to` is an exact, exclusive bound.
 */
export function resolveUsageRange(
  from: string,
  to: string,
): { start: Date; end: Date } {
  const start = parseUsageInstant(from);
  const end = DATE_ONLY.test(to)
    ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000)
    : new Date(to);
  return { start, end };
}

const usageFilterShape = {
  from: isoDateOrDateTime,
  to: isoDateOrDateTime,
  organizationId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  provider: z.string().trim().toLowerCase().min(1).max(40).optional(),
  feature: z.enum(USAGE_FEATURES).optional(),
  channel: z.enum(USAGE_CHANNELS).optional(),
  billedTo: z.enum(BILLED_TO).optional(),
};

function checkRange(
  d: { from: string; to: string },
  ctx: z.RefinementCtx,
): void {
  const { start, end } = resolveUsageRange(d.from, d.to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "from must be before to",
      path: ["from"],
    });
    return;
  }
  if (end.getTime() - start.getTime() > USAGE_MAX_RANGE_DAYS * 86_400_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Range may cover at most ${USAGE_MAX_RANGE_DAYS} days`,
      path: ["to"],
    });
  }
}

export const usageQuerySchema = z
  .object(usageFilterShape)
  .superRefine(checkRange);
export type UsageQuery = z.infer<typeof usageQuerySchema>;

export const usageTimeseriesQuerySchema = z
  .object({
    ...usageFilterShape,
    granularity: z.enum(["day"]).default("day"),
  })
  .superRefine(checkRange);
export type UsageTimeseriesQuery = z.infer<typeof usageTimeseriesQuerySchema>;

export const usageRankQuerySchema = z
  .object({
    ...usageFilterShape,
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine(checkRange);
export type UsageRankQuery = z.infer<typeof usageRankQuerySchema>;

/**
 * A new price row. Rows are never edited: a price change is a new row with a
 * later `effectiveFrom`.
 */
export const createProviderPriceSchema = z.object({
  /** Lower-case provider key, e.g. `openai`, `sarvam`. */
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(40)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "Use lower-case letters, digits, dot, dash or underscore",
    ),
  /** Model name without the provider prefix, or `*` for any model. */
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^(\*|[A-Za-z0-9][A-Za-z0-9._:/-]*)$/,
      "Use the model id without spaces, or * for any model",
    ),
  unit: z.enum(PRICE_UNITS),
  /** Amount charged for `per` units, in `currency`. */
  price: z
    .number({ invalid_type_error: "Enter the price as a number" })
    .finite()
    .min(0)
    .max(1_000_000_000),
  per: z
    .number({ invalid_type_error: "Enter how many units the price covers" })
    .int()
    .min(1)
    .max(1_000_000_000),
  currency: z.enum(PRICE_CURRENCIES),
  effectiveFrom: isoDateOrDateTime,
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .url("Enter the full URL of the pricing page or invoice")
    .refine((u) => /^https?:\/\//i.test(u), "Use an http or https URL"),
  note: z.string().trim().max(500).optional(),
});
export type CreateProviderPrice = z.infer<typeof createProviderPriceSchema>;
