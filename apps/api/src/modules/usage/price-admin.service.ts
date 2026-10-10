import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, type ProviderPrice } from "@prisma/client";

import { AppLogger } from "../../common/logger/app-logger";
import { TracerService } from "../../common/tracer/tracer.service";
import type { CurrentUserData } from "../../decorators/current-user.decorator";
import {
  parseUsageInstant,
  type CreateProviderPrice,
} from "../../models/usage.dto";
import { PrismaService } from "../../services/prisma.service";
import { PriceCatalogService } from "./price-catalog.service";

export interface PriceRow {
  id: string;
  provider: string;
  model: string;
  unit: string;
  /** Exact decimal as a string, so no float rounding on the way to the page. */
  price: string;
  per: number;
  currency: string;
  effectiveFrom: string;
  sourceUrl: string;
  note: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface PriceGroup {
  provider: string;
  model: string;
  unit: string;
  /** The row in effect now; null when every row starts in the future. */
  current: PriceRow | null;
  /** Rows that start later than now, soonest first. */
  upcoming: PriceRow[];
  /** Rows replaced by `current`, newest first. */
  previous: PriceRow[];
}

export interface MissingPrice {
  provider: string;
  model: string;
  feature: string;
  rows: number;
  lastSeen: string;
}

export interface PriceList {
  groups: PriceGroup[];
  /** Calls in the last 30 days recorded with no price. */
  missing: MissingPrice[];
}

/** How far back the "calls with no price" list looks. */
const MISSING_LOOKBACK_DAYS = 30;

function toRow(p: ProviderPrice): PriceRow {
  return {
    id: p.id,
    provider: p.provider,
    model: p.model,
    unit: p.unit,
    price: new Prisma.Decimal(p.price).toFixed(),
    per: p.per,
    currency: p.currency,
    effectiveFrom: p.effectiveFrom.toISOString(),
    sourceUrl: p.sourceUrl,
    note: p.note,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * The provider price list for staff (ADR-0012). Rows are append-only: a price
 * change is a new row with a later `effectiveFrom`, so every recorded cost
 * stays reproducible from the row it was priced with.
 */
@Injectable()
export class PriceAdminService {
  private readonly log = new AppLogger(PriceAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PriceCatalogService,
    private readonly tracer: TracerService,
  ) {}

  async list(now: Date = new Date()): Promise<PriceList> {
    // The price table is tens of rows (config, not ledger data), so grouping
    // it here is fine. The unpriced-call count is aggregated in SQL.
    const [prices, missing] = await Promise.all([
      this.prisma.providerPrice.findMany({
        orderBy: [
          { provider: "asc" },
          { model: "asc" },
          { unit: "asc" },
          { effectiveFrom: "desc" },
        ],
      }),
      this.prisma.$queryRaw<
        Array<{
          provider: string;
          model: string;
          feature: string;
          row_count: number;
          last_seen: Date;
        }>
      >`
        SELECT u."provider", u."model", u."feature"::text AS feature,
               COUNT(*)::int AS row_count,
               MAX(u."occurredAt") AS last_seen
        FROM "usage_records" u
        WHERE u."cost" IS NULL
          AND u."occurredAt" >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${MISSING_LOOKBACK_DAYS})
        GROUP BY u."provider", u."model", u."feature"
        ORDER BY row_count DESC
        LIMIT 50`,
    ]);

    const groups = new Map<string, PriceGroup>();
    for (const price of prices) {
      const key = `${price.provider}|${price.model}|${price.unit}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          provider: price.provider,
          model: price.model,
          unit: price.unit,
          current: null,
          upcoming: [],
          previous: [],
        };
        groups.set(key, group);
      }
      const row = toRow(price);
      // Rows arrive newest first, so the first row not in the future is current.
      if (price.effectiveFrom > now) group.upcoming.unshift(row);
      else if (!group.current) group.current = row;
      else group.previous.push(row);
    }

    return {
      groups: [...groups.values()],
      missing: missing.map((m) => ({
        provider: m.provider,
        model: m.model,
        feature: m.feature,
        rows: Number(m.row_count),
        lastSeen: new Date(m.last_seen).toISOString(),
      })),
    };
  }

  /** Add one effective-dated row. Never edits an existing row. */
  async create(
    dto: CreateProviderPrice,
    user: CurrentUserData,
  ): Promise<PriceRow> {
    const effectiveFrom = parseUsageInstant(dto.effectiveFrom);
    let created: ProviderPrice;
    try {
      created = await this.prisma.providerPrice.create({
        data: {
          provider: dto.provider,
          model: dto.model,
          unit: dto.unit,
          price: new Prisma.Decimal(String(dto.price)),
          per: dto.per,
          currency: dto.currency,
          effectiveFrom,
          sourceUrl: dto.sourceUrl,
          note: dto.note ? dto.note : null,
          createdById: user.id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "A price for this provider, model and unit already starts at that time. Pick another effective date.",
        );
      }
      throw error;
    }

    const row = toRow(created);
    // Prices change what every later call costs, so this is an accountable
    // config change. Price data is supplier list prices, never secrets or PII.
    await this.tracer.logAuditEvent(created.id, "PRICE_ADDED", {
      request: {
        provider: row.provider,
        model: row.model,
        unit: row.unit,
        price: row.price,
        per: row.per,
        currency: row.currency,
        effectiveFrom: row.effectiveFrom,
        sourceUrl: row.sourceUrl,
        note: row.note,
      },
      response: { priceId: row.id, userId: user.id },
    });

    // This instance reprices at once; others pick it up within their refresh window.
    this.catalog.invalidate();
    this.log.info("create", "price row added", {
      priceId: created.id,
      provider: created.provider,
      model: created.model,
      unit: created.unit,
    });
    return row;
  }
}
