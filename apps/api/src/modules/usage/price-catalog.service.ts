import { Injectable } from "@nestjs/common";
import type { PriceUnit } from "@prisma/client";

import { AppLogger } from "../../common/logger/app-logger";
import { PrismaService } from "../../services/prisma.service";
import {
  priceCall,
  type PricedCall,
  type UnitPrice,
  type UsageQuantities,
} from "./pricing";

interface CatalogRow extends UnitPrice {
  provider: string;
  model: string;
  effectiveFrom: Date;
}

/** Prices change rarely; a staff edit shows up within this window. */
const REFRESH_MS = 5 * 60_000;

/** OpenAI dated snapshots ('gpt-4.1-mini-2025-04-14') price as their base model. */
const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * In-memory view of `provider_prices` (ADR-0012). Every metered call is priced
 * here, so the table is read once per refresh window, not once per call.
 */
@Injectable()
export class PriceCatalogService {
  private readonly log = new AppLogger(PriceCatalogService.name);
  /** `provider|model|unit` → rows, newest effectiveFrom first. */
  private index = new Map<string, CatalogRow[]>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Price one call as of `at`, using the prices then in effect. */
  async price(
    provider: string,
    model: string,
    quantities: UsageQuantities,
    at: Date,
  ): Promise<PricedCall> {
    await this.ensureFresh();
    return priceCall(provider, quantities, (unit) =>
      this.lookup(provider, model, unit, at),
    );
  }

  /** Drop the cache so the next call reloads (after a price is added). */
  invalidate(): void {
    this.loadedAt = 0;
  }

  private lookup(
    provider: string,
    model: string,
    unit: PriceUnit,
    at: Date,
  ): UnitPrice | undefined {
    const candidates = [model, model.replace(DATE_SUFFIX, ""), "*"];
    for (const m of candidates) {
      const hit = this.index
        .get(`${provider}|${m}|${unit}`)
        ?.find((r) => r.effectiveFrom <= at);
      if (hit) return hit;
    }
    return undefined;
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.loadedAt < REFRESH_MS) return;
    // One load at a time; concurrent callers wait on the same promise.
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.prisma.providerPrice.findMany();
      const index = new Map<string, CatalogRow[]>();
      for (const r of rows) {
        const key = `${r.provider}|${r.model}|${r.unit}`;
        const list = index.get(key) ?? [];
        list.push({
          id: r.id,
          provider: r.provider,
          model: r.model,
          unit: r.unit,
          price: Number(r.price),
          per: r.per,
          currency: r.currency,
          effectiveFrom: r.effectiveFrom,
        });
        index.set(key, list);
      }
      for (const list of index.values()) {
        list.sort(
          (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
        );
      }
      this.index = index;
      this.loadedAt = Date.now();
    } catch (err) {
      // Keep the last good prices. With none loaded, calls are recorded
      // unpriced and show up as such, which is better than dropping them.
      this.log.error(
        "load",
        "price list load failed; keeping previous prices",
        err,
      );
      // Retry in 30 s rather than on every metered call.
      this.loadedAt = Date.now() - REFRESH_MS + 30_000;
    }
  }
}
