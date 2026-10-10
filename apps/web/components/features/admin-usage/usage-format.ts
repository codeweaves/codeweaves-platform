import type { CostCategory, NativeAmounts } from "@/hooks/use-usage";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrSmallFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const numberFormatter = new Intl.NumberFormat("en-IN");

/** INR with paise; values under ₹1 keep 4 decimals so tiny calls do not read as ₹0.00. */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  if (value !== 0 && Math.abs(value) < 1)
    return inrSmallFormatter.format(value);
  return inrFormatter.format(value);
}

/** A native amount in its own currency, with enough decimals for per-call costs. */
export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || !currency) return "n/a";
  const digits = Math.abs(value) < 1 && value !== 0 ? 6 : 2;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

/** "$1.20 + ₹20.00", leaving out a currency with nothing in it. */
export function formatNative(native: NativeAmounts): string {
  const parts: string[] = [];
  if (native.USD) parts.push(formatMoney(native.USD, "USD"));
  if (native.INR) parts.push(formatMoney(native.INR, "INR"));
  return parts.length ? parts.join(" + ") : "n/a";
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return numberFormatter.format(Math.round(value));
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const FEATURE_LABELS: Record<string, string> = {
  CHAT: "Chat reply",
  SUMMARY: "Summary",
  TITLE: "Title",
  CLASSIFIER: "Classifier",
  DATA_EXTRACTION: "Data extraction",
  RAG: "Retrieval",
  EMBEDDING: "Embedding",
  STT: "Speech to text",
  TTS: "Text to speech",
  VOICE_PREVIEW: "Voice preview",
  WHATSAPP_MESSAGE: "WhatsApp message",
  EMAIL: "Email",
};

export const CHANNEL_LABELS: Record<string, string> = {
  WIDGET: "Widget",
  DASHBOARD: "Dashboard",
  WHATSAPP: "WhatsApp",
  VOICE: "Voice",
  INTERNAL: "Background jobs",
  SYSTEM: "System",
};

export const UNIT_LABELS: Record<string, string> = {
  INPUT_TOKEN: "Input token",
  CACHED_INPUT_TOKEN: "Cached input token",
  CACHE_WRITE_TOKEN: "Cache write token",
  OUTPUT_TOKEN: "Output token",
  AUDIO_SECOND: "Audio second",
  CHARACTER: "Character",
  MESSAGE: "Message",
  EMAIL: "Email",
};

export const QUANTITY_SOURCE_LABELS: Record<string, string> = {
  PROVIDER_REPORTED: "Provider reported",
  MEASURED: "Measured by us",
  ESTIMATED: "Estimated",
};

/** Same grouping the API uses for its LLM / STT / TTS / other split. */
export const FEATURE_CATEGORY: Record<string, CostCategory> = {
  CHAT: "LLM",
  SUMMARY: "LLM",
  TITLE: "LLM",
  CLASSIFIER: "LLM",
  DATA_EXTRACTION: "LLM",
  RAG: "LLM",
  EMBEDDING: "LLM",
  STT: "STT",
  TTS: "TTS",
  VOICE_PREVIEW: "TTS",
  WHATSAPP_MESSAGE: "OTHER",
  EMAIL: "OTHER",
};

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  LLM: "LLM",
  STT: "Speech to text",
  TTS: "Text to speech",
  OTHER: "Other",
};

export const CATEGORY_COLORS: Record<CostCategory, string> = {
  LLM: "var(--chart-1)",
  STT: "var(--chart-3)",
  TTS: "var(--chart-4)",
  OTHER: "var(--chart-5)",
};

/** One line of a call's usage, as plain words: "1,200 in / 300 out tokens". */
export function describeQuantity(line: {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  audioSeconds: number | null;
  characters: number | null;
  units: number | null;
}): string {
  const parts: string[] = [];
  if (line.inputTokens) {
    const cached = line.cachedInputTokens
      ? ` (${formatCount(line.cachedInputTokens)} cached)`
      : "";
    parts.push(`${formatCount(line.inputTokens)} in${cached}`);
  }
  if (line.outputTokens) parts.push(`${formatCount(line.outputTokens)} out`);
  if (parts.length) parts[parts.length - 1] += " tokens";
  if (line.audioSeconds) parts.push(`${line.audioSeconds.toFixed(1)} s audio`);
  if (line.characters) parts.push(`${formatCount(line.characters)} characters`);
  if (line.units) parts.push(`${formatCount(line.units)} units`);
  return parts.join(", ") || "n/a";
}
