import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLogger } from "../../common/logger/app-logger";
import { TracerService } from "../../common/tracer/tracer.service";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import {
  resolveUsageRange,
  type UsageQuery,
  type UsageRankQuery,
  type UsageTimeseriesQuery,
} from "../../models/usage.dto";
import { PrismaService } from "../../services/prisma.service";
import { CSV_BOM, csvRow } from "../../utils/csv";
import type { PricingLine } from "./pricing";

/** Native amounts per currency. Zero when there is nothing in that currency. */
export interface NativeAmounts {
  USD: number;
  INR: number;
}

/**
 * The money columns every breakdown shares. `costInr` is OUR cost (billed to
 * the platform); WhatsApp-style pass-through billed to the client is kept apart
 * in the `client*` fields so it never inflates our cost.
 *
 * Every `*Inr` field is null when `fx_rates` is empty (see `FxInfo.available`).
 */
export interface CostBreakdown {
  rows: number;
  unpricedRows: number;
  costInr: number | null;
  native: NativeAmounts;
  clientRows: number;
  clientCostInr: number | null;
  clientNative: NativeAmounts;
}

export interface FxInfo {
  /** False when `fx_rates` has no row: USD costs cannot be converted. */
  available: boolean;
  latestDate: string | null;
  latestUsdToInr: number | null;
}

export type CostCategory = "LLM" | "STT" | "TTS" | "OTHER";

export interface UsageSummary {
  range: { from: string; to: string };
  fx: FxInfo;
  totals: CostBreakdown & { conversations: number };
  quantitySources: {
    PROVIDER_REPORTED: number;
    MEASURED: number;
    ESTIMATED: number;
  };
  byCategory: Record<CostCategory, { rows: number; costInr: number | null }>;
  byProviderModel: Array<
    CostBreakdown & {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      audioSeconds: number;
      characters: number;
      units: number;
    }
  >;
  byFeature: Array<CostBreakdown & { feature: string }>;
  byChannel: Array<CostBreakdown & { channel: string }>;
}

export interface UsageTimeseries {
  granularity: "day";
  fx: FxInfo;
  features: string[];
  days: Array<{
    date: string;
    totalInr: number | null;
    byFeature: Record<string, number | null>;
  }>;
}

export interface RankedRow extends CostBreakdown {
  conversations: number;
  costPerConversationInr: number | null;
}

export interface OrganizationUsageRow extends RankedRow {
  organizationId: string | null;
  organizationName: string | null;
}

export interface AgentUsageRow extends RankedRow {
  agentId: string | null;
  agentName: string | null;
  organizationId: string | null;
  organizationName: string | null;
}

export interface ConversationUsageLine {
  id: string;
  occurredAt: string;
  channel: string;
  feature: string;
  provider: string;
  model: string;
  quantitySource: string;
  billedTo: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  audioSeconds: number | null;
  characters: number | null;
  units: number | null;
  cost: number | null;
  currency: string | null;
  pricing: PricingLine[] | null;
  /** USD→INR rate applied; null for INR rows (no conversion) and unpriced rows. */
  fxRate: number | null;
  /** The `fx_rates` day the rate came from. */
  fxDate: string | null;
  costInr: number | null;
  latencyMs: number | null;
}

export interface ConversationUsage {
  chatSessionId: string;
  organizationId: string | null;
  organizationName: string | null;
  agentId: string | null;
  agentName: string | null;
  fx: FxInfo;
  lines: ConversationUsageLine[];
  /** Platform cost only; client pass-through is in `clientTotalInr`. */
  totalInr: number | null;
  clientTotalInr: number | null;
  unpricedLines: number;
}

export interface UnitEconomics {
  fx: FxInfo;
  perConversation: {
    conversations: number;
    avgInr: number | null;
    p50Inr: number | null;
    p90Inr: number | null;
    maxInr: number | null;
  };
  voice: {
    conversations: number;
    audioMinutes: number;
    sttInr: number | null;
    ttsInr: number | null;
    llmInr: number | null;
    totalInr: number | null;
    costPerMinuteInr: number | null;
    unpricedRows: number;
  };
  /** The most expensive conversations in range, for drill-down. */
  topConversations: Array<{
    chatSessionId: string;
    organizationName: string | null;
    agentName: string | null;
    calls: number;
    costInr: number | null;
    lastAt: string;
  }>;
}

/** How many conversations the drill-down list shows. */
const TOP_CONVERSATIONS = 10;

/** Filters after parsing: a half-open UTC interval plus optional narrowing. */
interface ResolvedFilters {
  start: Date;
  end: Date;
  organizationId?: string;
  agentId?: string;
  provider?: string;
  feature?: string;
  channel?: string;
  billedTo?: string;
}

/** Columns every grouped query returns (see `AGGREGATES`). */
interface AggregateRow {
  row_count: number;
  unpriced_count: number;
  client_rows: number;
  inr: number | null;
  usd: number | null;
  inr_native: number | null;
  client_inr: number | null;
  client_usd: number | null;
  client_inr_native: number | null;
}

const FEATURE_CATEGORY: Record<string, CostCategory> = {
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

/**
 * Money aggregates shared by every breakdown. Platform and client (pass-through)
 * spend are split with FILTER so one scan yields both.
 */
const AGGREGATES = Prisma.sql`
  COUNT(*)::int AS row_count,
  COUNT(*) FILTER (WHERE r."cost" IS NULL)::int AS unpriced_count,
  COUNT(*) FILTER (WHERE r."billedTo" = 'CLIENT')::int AS client_rows,
  (SUM(r.inr) FILTER (WHERE r."billedTo" = 'PLATFORM'))::float8 AS inr,
  (SUM(r."cost") FILTER (WHERE r."billedTo" = 'PLATFORM' AND r."currency" = 'USD'))::float8 AS usd,
  (SUM(r."cost") FILTER (WHERE r."billedTo" = 'PLATFORM' AND r."currency" = 'INR'))::float8 AS inr_native,
  (SUM(r.inr) FILTER (WHERE r."billedTo" = 'CLIENT'))::float8 AS client_inr,
  (SUM(r."cost") FILTER (WHERE r."billedTo" = 'CLIENT' AND r."currency" = 'USD'))::float8 AS client_usd,
  (SUM(r."cost") FILTER (WHERE r."billedTo" = 'CLIENT' AND r."currency" = 'INR'))::float8 AS client_inr_native`;

/** Rows per CSV page. One page in flight at a time. */
const EXPORT_BATCH_SIZE = 1000;
/** A conversation never has this many calls; the cap only bounds a bad id. */
const CONVERSATION_MAX_LINES = 2000;

const DAY_MS = 86_400_000;

/** `pg` returns COUNT as bigint and NUMERIC as Decimal unless cast; accept all. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Usage and cost reports over `usage_records` (ADR-0012).
 *
 * Everything is aggregated in Postgres; Node only reshapes the handful of
 * grouped rows that come back. Costs stay in the provider's currency in the
 * ledger and are converted to INR here, at query time, with the stored daily
 * USD→INR rate for each call's UTC date (the nearest earlier day when a day is
 * missing, or the earliest rate for calls older than every stored rate).
 */
@Injectable()
export class UsageReportService {
  /** Hard cap so one click cannot stream the whole ledger. */
  static EXPORT_MAX_ROWS = 100_000;

  private readonly log = new AppLogger(UsageReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracer: TracerService,
  ) {}

  async getSummary(query: UsageQuery): Promise<UsageSummary> {
    const f = this.resolve(query);
    const base = this.filtered(f);

    const [fx, totals, byProviderModel, byFeature, byChannel] =
      await Promise.all([
        this.fxInfo(),
        this.prisma.$queryRaw<
          Array<
            AggregateRow & {
              conversations: number;
              qs_provider: number;
              qs_measured: number;
              qs_estimated: number;
            }
          >
        >`${base}
          SELECT ${AGGREGATES},
            COUNT(DISTINCT r."chatSessionId")::int AS conversations,
            COUNT(*) FILTER (WHERE r."quantitySource" = 'PROVIDER_REPORTED')::int AS qs_provider,
            COUNT(*) FILTER (WHERE r."quantitySource" = 'MEASURED')::int AS qs_measured,
            COUNT(*) FILTER (WHERE r."quantitySource" = 'ESTIMATED')::int AS qs_estimated
          FROM r`,
        this.prisma.$queryRaw<
          Array<
            AggregateRow & {
              provider: string;
              model: string;
              input_tokens: number | null;
              output_tokens: number | null;
              audio_seconds: number | null;
              characters: number | null;
              units: number | null;
            }
          >
        >`${base}
          SELECT r."provider", r."model", ${AGGREGATES},
            SUM(r."inputTokens")::float8 AS input_tokens,
            SUM(r."outputTokens")::float8 AS output_tokens,
            SUM(r."audioSeconds")::float8 AS audio_seconds,
            SUM(r."characters")::float8 AS characters,
            SUM(r."units")::float8 AS units
          FROM r
          GROUP BY r."provider", r."model"
          ORDER BY inr DESC NULLS LAST, row_count DESC
          LIMIT 200`,
        this.prisma.$queryRaw<Array<AggregateRow & { feature: string }>>`${base}
          SELECT r."feature"::text AS feature, ${AGGREGATES}
          FROM r
          GROUP BY r."feature"
          ORDER BY inr DESC NULLS LAST, row_count DESC`,
        this.prisma.$queryRaw<Array<AggregateRow & { channel: string }>>`${base}
          SELECT r."channel"::text AS channel, ${AGGREGATES}
          FROM r
          GROUP BY r."channel"
          ORDER BY inr DESC NULLS LAST, row_count DESC`,
      ]);

    const t = totals[0];
    const features = byFeature.map((row) => ({
      feature: row.feature,
      ...this.breakdown(row, fx.available),
    }));

    return {
      range: { from: f.start.toISOString(), to: f.end.toISOString() },
      fx,
      totals: {
        ...this.breakdown(t, fx.available),
        conversations: num(t?.conversations) ?? 0,
      },
      quantitySources: {
        PROVIDER_REPORTED: num(t?.qs_provider) ?? 0,
        MEASURED: num(t?.qs_measured) ?? 0,
        ESTIMATED: num(t?.qs_estimated) ?? 0,
      },
      byCategory: this.categorize(features, fx.available),
      byProviderModel: byProviderModel.map((row) => ({
        provider: row.provider,
        model: row.model,
        ...this.breakdown(row, fx.available),
        inputTokens: num(row.input_tokens) ?? 0,
        outputTokens: num(row.output_tokens) ?? 0,
        audioSeconds: num(row.audio_seconds) ?? 0,
        characters: num(row.characters) ?? 0,
        units: num(row.units) ?? 0,
      })),
      byFeature: features,
      byChannel: byChannel.map((row) => ({
        channel: row.channel,
        ...this.breakdown(row, fx.available),
      })),
    };
  }

  /**
   * Daily INR cost by feature. Our own cost unless the caller asked for client
   * pass-through explicitly, so the chart never mixes the two.
   */
  async getTimeseries(query: UsageTimeseriesQuery): Promise<UsageTimeseries> {
    const f = this.resolve({
      ...query,
      billedTo: query.billedTo ?? "PLATFORM",
    });

    const [fx, rows] = await Promise.all([
      this.fxInfo(),
      this.prisma.$queryRaw<
        Array<{ day: string; feature: string; inr: number | null }>
      >`${this.filtered(f)}
        SELECT to_char(r."occurredAt"::date, 'YYYY-MM-DD') AS day,
               r."feature"::text AS feature,
               SUM(r.inr)::float8 AS inr
        FROM r
        GROUP BY 1, 2
        ORDER BY 1, 2`,
    ]);

    const byDay = new Map<string, Record<string, number | null>>();
    const features = new Set<string>();
    for (const row of rows) {
      features.add(row.feature);
      const entry = byDay.get(row.day) ?? {};
      entry[row.feature] = fx.available ? (num(row.inr) ?? 0) : null;
      byDay.set(row.day, entry);
    }

    // Fill every day in the range so the chart has no gaps.
    const days: UsageTimeseries["days"] = [];
    const lastDay = new Date(f.end.getTime() - 1);
    for (
      let d = new Date(`${isoDay(f.start)}T00:00:00Z`);
      d <= lastDay;
      d = new Date(d.getTime() + DAY_MS)
    ) {
      const date = isoDay(d);
      const byFeature = byDay.get(date) ?? {};
      const values = Object.values(byFeature);
      days.push({
        date,
        totalInr: fx.available
          ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
          : null,
        byFeature,
      });
    }

    return { granularity: "day", fx, features: [...features].sort(), days };
  }

  async getOrganizations(
    query: UsageRankQuery,
  ): Promise<{ fx: FxInfo; rows: OrganizationUsageRow[] }> {
    const f = this.resolve(query);
    const [fx, rows] = await Promise.all([
      this.fxInfo(),
      this.prisma.$queryRaw<
        Array<
          AggregateRow & {
            organization_id: string | null;
            organization_name: string | null;
            conversations: number;
            cost_per_conversation: number | null;
          }
        >
      >`${this.filtered(f)}
        SELECT r."organizationId" AS organization_id,
               o."name" AS organization_name,
               ${AGGREGATES},
               COUNT(DISTINCT r."chatSessionId")::int AS conversations,
               ((SUM(r.inr) FILTER (WHERE r."billedTo" = 'PLATFORM'))
                 / NULLIF(COUNT(DISTINCT r."chatSessionId"), 0))::float8 AS cost_per_conversation
        FROM r
        LEFT JOIN "organizations" o ON o."id" = r."organizationId"
        GROUP BY r."organizationId", o."name"
        ORDER BY inr DESC NULLS LAST, row_count DESC
        LIMIT ${query.limit}`,
    ]);

    return {
      fx,
      rows: rows.map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        ...this.ranked(row, fx.available),
      })),
    };
  }

  async getAgents(
    query: UsageRankQuery,
  ): Promise<{ fx: FxInfo; rows: AgentUsageRow[] }> {
    const f = this.resolve(query);
    const [fx, rows] = await Promise.all([
      this.fxInfo(),
      this.prisma.$queryRaw<
        Array<
          AggregateRow & {
            agent_id: string | null;
            agent_name: string | null;
            organization_id: string | null;
            organization_name: string | null;
            conversations: number;
            cost_per_conversation: number | null;
          }
        >
      >`${this.filtered(f)}
        SELECT r."agentId" AS agent_id,
               a."name" AS agent_name,
               r."organizationId" AS organization_id,
               o."name" AS organization_name,
               ${AGGREGATES},
               COUNT(DISTINCT r."chatSessionId")::int AS conversations,
               ((SUM(r.inr) FILTER (WHERE r."billedTo" = 'PLATFORM'))
                 / NULLIF(COUNT(DISTINCT r."chatSessionId"), 0))::float8 AS cost_per_conversation
        FROM r
        LEFT JOIN "agents" a ON a."id" = r."agentId"
        LEFT JOIN "organizations" o ON o."id" = r."organizationId"
        GROUP BY r."agentId", a."name", r."organizationId", o."name"
        ORDER BY inr DESC NULLS LAST, row_count DESC
        LIMIT ${query.limit}`,
    ]);

    return {
      fx,
      rows: rows.map((row) => ({
        agentId: row.agent_id,
        agentName: row.agent_name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        ...this.ranked(row, fx.available),
      })),
    };
  }

  /** Every metered call of one conversation, line by line, with its INR cost. */
  async getConversation(chatSessionId: string): Promise<ConversationUsage> {
    const [fx, rows] = await Promise.all([
      this.fxInfo(),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          occurred_at: Date;
          organization_id: string | null;
          organization_name: string | null;
          agent_id: string | null;
          agent_name: string | null;
          channel: string;
          feature: string;
          provider: string;
          model: string;
          quantity_source: string;
          billed_to: string;
          input_tokens: number | null;
          cached_input_tokens: number | null;
          cache_write_tokens: number | null;
          output_tokens: number | null;
          reasoning_tokens: number | null;
          audio_seconds: number | null;
          characters: number | null;
          units: number | null;
          cost: number | null;
          currency: string | null;
          pricing: unknown;
          latency_ms: number | null;
          fx_rate: number | null;
          fx_date: string | null;
          inr: number | null;
        }>
      >`
        SELECT u."id",
               u."occurredAt" AS occurred_at,
               u."organizationId" AS organization_id,
               o."name" AS organization_name,
               u."agentId" AS agent_id,
               a."name" AS agent_name,
               u."channel"::text AS channel,
               u."feature"::text AS feature,
               u."provider",
               u."model",
               u."quantitySource"::text AS quantity_source,
               u."billedTo"::text AS billed_to,
               u."inputTokens" AS input_tokens,
               u."cachedInputTokens" AS cached_input_tokens,
               u."cacheWriteTokens" AS cache_write_tokens,
               u."outputTokens" AS output_tokens,
               u."reasoningTokens" AS reasoning_tokens,
               u."audioSeconds"::float8 AS audio_seconds,
               u."characters",
               u."units",
               u."cost"::float8 AS cost,
               u."currency"::text AS currency,
               u."pricing",
               u."latencyMs" AS latency_ms,
               CASE WHEN u."currency" = 'USD' AND u."cost" IS NOT NULL
                    THEN COALESCE(prev.rate, earliest.rate) END::float8 AS fx_rate,
               CASE WHEN u."currency" = 'USD' AND u."cost" IS NOT NULL
                    THEN to_char(COALESCE(prev.day, earliest.day), 'YYYY-MM-DD') END AS fx_date,
               (CASE u."currency"
                  WHEN 'INR' THEN u."cost"
                  WHEN 'USD' THEN u."cost" * COALESCE(prev.rate, earliest.rate)
                END)::float8 AS inr
        FROM "usage_records" u
        LEFT JOIN "organizations" o ON o."id" = u."organizationId"
        LEFT JOIN "agents" a ON a."id" = u."agentId"
        LEFT JOIN LATERAL (
          SELECT f."usdToInr" AS rate, f."date" AS day FROM "fx_rates" f
          WHERE f."date" <= u."occurredAt"::date
          ORDER BY f."date" DESC LIMIT 1
        ) prev ON true
        LEFT JOIN LATERAL (
          SELECT f."usdToInr" AS rate, f."date" AS day FROM "fx_rates" f
          ORDER BY f."date" ASC LIMIT 1
        ) earliest ON true
        WHERE u."chatSessionId" = ${chatSessionId}
        ORDER BY u."occurredAt" ASC, u."id" ASC
        LIMIT ${CONVERSATION_MAX_LINES}`,
    ]);

    if (rows.length === 0) {
      throw new NotFoundException("No usage recorded for this conversation");
    }

    const lines: ConversationUsageLine[] = rows.map((r) => ({
      id: r.id,
      occurredAt: new Date(r.occurred_at).toISOString(),
      channel: r.channel,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      quantitySource: r.quantity_source,
      billedTo: r.billed_to,
      inputTokens: num(r.input_tokens),
      cachedInputTokens: num(r.cached_input_tokens),
      cacheWriteTokens: num(r.cache_write_tokens),
      outputTokens: num(r.output_tokens),
      reasoningTokens: num(r.reasoning_tokens),
      audioSeconds: num(r.audio_seconds),
      characters: num(r.characters),
      units: num(r.units),
      cost: num(r.cost),
      currency: r.currency,
      pricing: Array.isArray(r.pricing) ? (r.pricing as PricingLine[]) : null,
      fxRate: num(r.fx_rate),
      fxDate: r.fx_date,
      costInr: fx.available ? num(r.inr) : null,
      latencyMs: num(r.latency_ms),
    }));

    // The lines are already here for display; summing a few dozen of them is
    // not an aggregation over the ledger.
    const sum = (billedTo: string): number | null => {
      if (!fx.available) return null;
      return lines
        .filter((l) => l.billedTo === billedTo)
        .reduce((acc, l) => acc + (l.costInr ?? 0), 0);
    };
    const first = rows[0]!;

    return {
      chatSessionId,
      organizationId: first.organization_id,
      organizationName: first.organization_name,
      agentId: first.agent_id,
      agentName: first.agent_name,
      fx,
      lines,
      totalInr: sum("PLATFORM"),
      clientTotalInr: sum("CLIENT"),
      unpricedLines: lines.filter((l) => l.cost === null).length,
    };
  }

  /**
   * Cost per conversation (average and percentiles over per-conversation sums)
   * and cost per voice minute. Our own cost unless client pass-through is
   * asked for explicitly.
   *
   * A voice minute is a minute of caller audio sent to STT. Voice-channel rows
   * carry no audio length until the voice metering lands, so the per-minute
   * figure is null until then.
   */
  async getUnitEconomics(query: UsageQuery): Promise<UnitEconomics> {
    const f = this.resolve({
      ...query,
      billedTo: query.billedTo ?? "PLATFORM",
    });
    const base = this.filtered(f);

    const [fx, conv, voice, top] = await Promise.all([
      this.fxInfo(),
      this.prisma.$queryRaw<
        Array<{
          conversations: number;
          avg: number | null;
          p50: number | null;
          p90: number | null;
          max: number | null;
        }>
      >`${base},
        per_conv AS (
          SELECT r."chatSessionId", SUM(r.inr) AS inr
          FROM r
          WHERE r."chatSessionId" IS NOT NULL
          GROUP BY r."chatSessionId"
        )
        SELECT COUNT(*)::int AS conversations,
               AVG(inr)::float8 AS avg,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY inr)::float8 AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY inr)::float8 AS p90,
               MAX(inr)::float8 AS max
        FROM per_conv`,
      this.prisma.$queryRaw<
        Array<{
          conversations: number;
          stt_seconds: number | null;
          stt_inr: number | null;
          tts_inr: number | null;
          llm_inr: number | null;
          unpriced_count: number;
        }>
      >`${base}
        SELECT COUNT(DISTINCT r."chatSessionId")::int AS conversations,
               (SUM(r."audioSeconds") FILTER (WHERE r."feature" = 'STT'))::float8 AS stt_seconds,
               (SUM(r.inr) FILTER (WHERE r."feature" = 'STT'))::float8 AS stt_inr,
               (SUM(r.inr) FILTER (WHERE r."feature" = 'TTS'))::float8 AS tts_inr,
               (SUM(r.inr) FILTER (WHERE r."feature" NOT IN ('STT', 'TTS')))::float8 AS llm_inr,
               COUNT(*) FILTER (WHERE r."cost" IS NULL)::int AS unpriced_count
        FROM r
        WHERE r."channel" = 'VOICE'`,
      this.prisma.$queryRaw<
        Array<{
          chat_session_id: string;
          organization_name: string | null;
          agent_name: string | null;
          calls: number;
          inr: number | null;
          last_at: Date;
        }>
      >`${base},
        top AS (
          SELECT r."chatSessionId", MAX(r."organizationId") AS organization_id,
                 MAX(r."agentId") AS agent_id, COUNT(*)::int AS calls,
                 SUM(r.inr) AS inr, MAX(r."occurredAt") AS last_at
          FROM r
          WHERE r."chatSessionId" IS NOT NULL
          GROUP BY r."chatSessionId"
          ORDER BY SUM(r.inr) DESC NULLS LAST, COUNT(*) DESC
          LIMIT ${TOP_CONVERSATIONS}
        )
        SELECT t."chatSessionId" AS chat_session_id,
               o."name" AS organization_name,
               a."name" AS agent_name,
               t.calls,
               t.inr::float8 AS inr,
               t.last_at
        FROM top t
        LEFT JOIN "organizations" o ON o."id" = t.organization_id
        LEFT JOIN "agents" a ON a."id" = t.agent_id
        ORDER BY t.inr DESC NULLS LAST, t.calls DESC`,
    ]);

    const c = conv[0];
    const v = voice[0];
    const inr = (value: unknown): number | null =>
      fx.available ? (num(value) ?? 0) : null;
    // Percentiles over an empty set stay null rather than reading as ₹0.
    const stat = (value: unknown): number | null =>
      fx.available ? num(value) : null;

    const audioMinutes = (num(v?.stt_seconds) ?? 0) / 60;
    const sttInr = inr(v?.stt_inr);
    const ttsInr = inr(v?.tts_inr);
    const llmInr = inr(v?.llm_inr);
    const totalInr =
      sttInr === null || ttsInr === null || llmInr === null
        ? null
        : sttInr + ttsInr + llmInr;

    return {
      fx,
      perConversation: {
        conversations: num(c?.conversations) ?? 0,
        avgInr: stat(c?.avg),
        p50Inr: stat(c?.p50),
        p90Inr: stat(c?.p90),
        maxInr: stat(c?.max),
      },
      voice: {
        conversations: num(v?.conversations) ?? 0,
        audioMinutes,
        sttInr,
        ttsInr,
        llmInr,
        totalInr,
        costPerMinuteInr:
          totalInr !== null && audioMinutes > 0
            ? totalInr / audioMinutes
            : null,
        unpricedRows: num(v?.unpriced_count) ?? 0,
      },
      topConversations: top.map((t) => ({
        chatSessionId: t.chat_session_id,
        organizationName: t.organization_name,
        agentName: t.agent_name,
        calls: num(t.calls) ?? 0,
        costInr: inr(t.inr),
        lastAt: new Date(t.last_at).toISOString(),
      })),
    };
  }

  /**
   * Validate the export and hand back a lazy CSV stream. Nothing here can fail
   * after the controller starts writing, so an error still renders as JSON.
   */
  prepareExport(
    query: UsageQuery,
    user: CurrentUserData,
  ): { filename: string; stream: AsyncGenerator<string> } {
    const f = this.resolve(query);
    const lastDay = isoDay(new Date(f.end.getTime() - 1));
    return {
      filename: `usage-${isoDay(f.start)}-to-${lastDay}.csv`,
      stream: this.streamCsv(f, query, user),
    };
  }

  /**
   * Keyset-paged CSV: `(occurredAt, id)` is the cursor, so a deep page costs
   * the same as the first one. Audit-logged in `finally`, so an aborted
   * download is still recorded.
   */
  private async *streamCsv(
    f: ResolvedFilters,
    query: UsageQuery,
    user: CurrentUserData,
  ): AsyncGenerator<string> {
    let rowCount = 0;
    let truncated = false;
    let cursor: { at: Date; id: string } | null = null;

    try {
      yield CSV_BOM +
        csvRow([
          "Occurred at (UTC)",
          "Organization ID",
          "Organization",
          "Agent ID",
          "Agent",
          "Conversation ID",
          "Channel",
          "Feature",
          "Provider",
          "Model",
          "Quantity source",
          "Billed to",
          "Input tokens",
          "Cached input tokens",
          "Cache write tokens",
          "Output tokens",
          "Reasoning tokens",
          "Audio seconds",
          "Characters",
          "Units",
          "Cost",
          "Currency",
          "USD to INR rate",
          "Cost INR",
          "Latency ms",
        ]);

      for (;;) {
        const extra: Prisma.Sql[] = cursor
          ? [
              Prisma.sql`(u."occurredAt", u."id") > ((${cursor.at.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${cursor.id})`,
            ]
          : [];
        const batch = await this.prisma.$queryRaw<
          Array<{
            id: string;
            occurred_at: Date;
            organization_id: string | null;
            organization_name: string | null;
            agent_id: string | null;
            agent_name: string | null;
            chat_session_id: string | null;
            channel: string;
            feature: string;
            provider: string;
            model: string;
            quantity_source: string;
            billed_to: string;
            input_tokens: number | null;
            cached_input_tokens: number | null;
            cache_write_tokens: number | null;
            output_tokens: number | null;
            reasoning_tokens: number | null;
            audio_seconds: string | null;
            characters: number | null;
            units: number | null;
            cost: string | null;
            currency: string | null;
            fx_rate: string | null;
            inr: string | null;
            latency_ms: number | null;
          }>
        >`${this.filtered(f, extra)}
          SELECT r."id",
                 r."occurredAt" AS occurred_at,
                 r."organizationId" AS organization_id,
                 o."name" AS organization_name,
                 r."agentId" AS agent_id,
                 a."name" AS agent_name,
                 r."chatSessionId" AS chat_session_id,
                 r."channel"::text AS channel,
                 r."feature"::text AS feature,
                 r."provider",
                 r."model",
                 r."quantitySource"::text AS quantity_source,
                 r."billedTo"::text AS billed_to,
                 r."inputTokens" AS input_tokens,
                 r."cachedInputTokens" AS cached_input_tokens,
                 r."cacheWriteTokens" AS cache_write_tokens,
                 r."outputTokens" AS output_tokens,
                 r."reasoningTokens" AS reasoning_tokens,
                 r."audioSeconds"::text AS audio_seconds,
                 r."characters",
                 r."units",
                 r."cost"::text AS cost,
                 r."currency"::text AS currency,
                 r.fx_rate::text AS fx_rate,
                 round(r.inr, 6)::text AS inr,
                 r."latencyMs" AS latency_ms
          FROM r
          LEFT JOIN "organizations" o ON o."id" = r."organizationId"
          LEFT JOIN "agents" a ON a."id" = r."agentId"
          ORDER BY r."occurredAt" ASC, r."id" ASC
          LIMIT ${EXPORT_BATCH_SIZE}`;
        if (batch.length === 0) break;

        let chunk = "";
        for (const row of batch) {
          chunk += csvRow([
            new Date(row.occurred_at).toISOString(),
            row.organization_id,
            row.organization_name,
            row.agent_id,
            row.agent_name,
            row.chat_session_id,
            row.channel,
            row.feature,
            row.provider,
            row.model,
            row.quantity_source,
            row.billed_to,
            row.input_tokens,
            row.cached_input_tokens,
            row.cache_write_tokens,
            row.output_tokens,
            row.reasoning_tokens,
            row.audio_seconds,
            row.characters,
            row.units,
            row.cost,
            row.currency,
            row.fx_rate,
            row.inr,
            row.latency_ms,
          ]);
          rowCount += 1;
          if (rowCount >= UsageReportService.EXPORT_MAX_ROWS) {
            truncated = true;
            break;
          }
        }
        yield chunk;

        if (truncated) {
          yield csvRow([
            `Export truncated at ${UsageReportService.EXPORT_MAX_ROWS} rows. Narrow the date range or filters for the rest.`,
          ]);
          break;
        }
        if (batch.length < EXPORT_BATCH_SIZE) break;
        const last = batch[batch.length - 1]!;
        cursor = { at: new Date(last.occurred_at), id: last.id };
      }
    } finally {
      // Never throws: by now the file has (at least partly) left the platform.
      try {
        await this.tracer.logAuditEvent(
          user.id,
          "USAGE_EXPORTED",
          {
            request: {
              from: query.from,
              to: query.to,
              organizationId: query.organizationId ?? null,
              agentId: query.agentId ?? null,
              provider: query.provider ?? null,
              feature: query.feature ?? null,
              channel: query.channel ?? null,
              billedTo: query.billedTo ?? null,
            },
            response: { rowCount, truncated, userId: user.id },
          },
          { organizationId: query.organizationId, agentId: query.agentId },
        );
      } catch (error) {
        this.log.warn("streamCsv", "usage export audit log failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.log.info("streamCsv", "usage CSV exported", { rowCount, truncated });
    }
  }

  /** The newest stored rate, and whether any rate exists at all. */
  private async fxInfo(): Promise<FxInfo> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: string; rate: number }>
    >`SELECT to_char(f."date", 'YYYY-MM-DD') AS date, f."usdToInr"::float8 AS rate
      FROM "fx_rates" f
      ORDER BY f."date" DESC
      LIMIT 1`;
    const latest = rows[0];
    return {
      available: latest !== undefined,
      latestDate: latest?.date ?? null,
      latestUsdToInr: latest ? num(latest.rate) : null,
    };
  }

  private resolve(query: UsageQuery): ResolvedFilters {
    const { start, end } = resolveUsageRange(query.from, query.to);
    return {
      start,
      end,
      organizationId: query.organizationId,
      agentId: query.agentId,
      provider: query.provider,
      feature: query.feature,
      channel: query.channel,
      billedTo: query.billedTo,
    };
  }

  /**
   * `WITH fx AS (...), r AS (...)`: the filtered ledger rows with their INR
   * amount. Callers append the SELECT (or more CTEs after a comma).
   *
   * `fx` holds one rate per UTC day of the range, resolved once per day
   * (at most 366 index lookups) instead of once per row. Bounds are compared
   * as UTC timestamps because `occurredAt` is stored without a zone.
   */
  private filtered(f: ResolvedFilters, extra: Prisma.Sql[] = []): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`u."occurredAt" >= (${f.start.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      Prisma.sql`u."occurredAt" < (${f.end.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
    ];
    if (f.organizationId) {
      conditions.push(Prisma.sql`u."organizationId" = ${f.organizationId}`);
    }
    if (f.agentId) conditions.push(Prisma.sql`u."agentId" = ${f.agentId}`);
    if (f.provider) conditions.push(Prisma.sql`u."provider" = ${f.provider}`);
    if (f.feature) {
      conditions.push(Prisma.sql`u."feature"::text = ${f.feature}`);
    }
    if (f.channel) {
      conditions.push(Prisma.sql`u."channel"::text = ${f.channel}`);
    }
    if (f.billedTo) {
      conditions.push(Prisma.sql`u."billedTo"::text = ${f.billedTo}`);
    }
    conditions.push(...extra);

    const firstDay = isoDay(f.start);
    const lastDay = isoDay(new Date(f.end.getTime() - 1));

    return Prisma.sql`
      WITH fx AS (
        SELECT d::date AS day,
               COALESCE(
                 (SELECT x."usdToInr" FROM "fx_rates" x
                  WHERE x."date" <= d::date
                  ORDER BY x."date" DESC LIMIT 1),
                 (SELECT x."usdToInr" FROM "fx_rates" x
                  ORDER BY x."date" ASC LIMIT 1)
               ) AS rate
        FROM generate_series(${firstDay}::timestamp, ${lastDay}::timestamp, interval '1 day') AS d
      ),
      r AS (
        SELECT u."id", u."occurredAt", u."organizationId", u."agentId",
               u."chatSessionId", u."channel", u."feature", u."provider",
               u."model", u."quantitySource", u."billedTo",
               u."inputTokens", u."cachedInputTokens", u."cacheWriteTokens",
               u."outputTokens", u."reasoningTokens", u."audioSeconds",
               u."characters", u."units", u."cost", u."currency", u."latencyMs",
               CASE WHEN u."currency" = 'USD' THEN fx.rate END AS fx_rate,
               CASE u."currency"
                 WHEN 'INR' THEN u."cost"
                 WHEN 'USD' THEN u."cost" * fx.rate
               END AS inr
        FROM "usage_records" u
        LEFT JOIN fx ON fx.day = u."occurredAt"::date
        WHERE ${Prisma.join(conditions, " AND ")}
      )`;
  }

  private breakdown(
    row: AggregateRow | undefined,
    fxAvailable: boolean,
  ): CostBreakdown {
    const inr = (value: unknown): number | null =>
      fxAvailable ? (num(value) ?? 0) : null;
    return {
      rows: num(row?.row_count) ?? 0,
      unpricedRows: num(row?.unpriced_count) ?? 0,
      costInr: inr(row?.inr),
      native: { USD: num(row?.usd) ?? 0, INR: num(row?.inr_native) ?? 0 },
      clientRows: num(row?.client_rows) ?? 0,
      clientCostInr: inr(row?.client_inr),
      clientNative: {
        USD: num(row?.client_usd) ?? 0,
        INR: num(row?.client_inr_native) ?? 0,
      },
    };
  }

  private ranked(
    row: AggregateRow & {
      conversations: number;
      cost_per_conversation: number | null;
    },
    fxAvailable: boolean,
  ): RankedRow {
    return {
      ...this.breakdown(row, fxAvailable),
      conversations: num(row.conversations) ?? 0,
      costPerConversationInr: fxAvailable
        ? num(row.cost_per_conversation)
        : null,
    };
  }

  /** LLM / STT / TTS / other, from the per-feature rows already aggregated. */
  private categorize(
    features: Array<CostBreakdown & { feature: string }>,
    fxAvailable: boolean,
  ): UsageSummary["byCategory"] {
    const out: UsageSummary["byCategory"] = {
      LLM: { rows: 0, costInr: fxAvailable ? 0 : null },
      STT: { rows: 0, costInr: fxAvailable ? 0 : null },
      TTS: { rows: 0, costInr: fxAvailable ? 0 : null },
      OTHER: { rows: 0, costInr: fxAvailable ? 0 : null },
    };
    for (const row of features) {
      const bucket = out[FEATURE_CATEGORY[row.feature] ?? "OTHER"];
      bucket.rows += row.rows - row.clientRows;
      if (bucket.costInr !== null) bucket.costInr += row.costInr ?? 0;
    }
    return out;
  }
}
