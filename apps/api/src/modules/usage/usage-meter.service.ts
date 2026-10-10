import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  Prisma,
  type BilledTo,
  type EventChannel,
  type QuantitySource,
  type UsageFeature,
} from "@prisma/client";

import { AppLogger } from "../../common/logger/app-logger";
import { PrismaService } from "../../services/prisma.service";
import { PriceCatalogService } from "./price-catalog.service";
import type { PricedCall, UsageQuantities } from "./pricing";

/** Tenant scope of a metered call. All optional: platform cost has none. */
export interface UsageScope {
  organizationId?: string | null;
  agentId?: string | null;
  /** Internal ChatSession id (not the public sessionId). */
  chatSessionId?: string | null;
  messageId?: string | null;
  traceId?: string | null;
}

export interface UsageEvent extends UsageScope {
  occurredAt?: Date;
  channel: EventChannel;
  feature: UsageFeature;
  /** Lower-case provider key matching `provider_prices.provider`. */
  provider: string;
  /** Model name without the provider prefix. */
  model: string;
  providerRequestId?: string | null;
  quantities: UsageQuantities;
  quantitySource: QuantitySource;
  billedTo?: BilledTo;
  latencyMs?: number | null;
}

const RETRY_DELAY_MS = 1_000;
const UNPRICED: PricedCall = { cost: null, currency: null, lines: [] };

/**
 * Writes one `usage_records` row per billable provider call (ADR-0012).
 *
 * `record()` is fire-and-forget: it never throws into the request and never
 * blocks it. It never drops a row on purpose:
 * - a pricing failure stores the row unpriced;
 * - a failed insert is retried once;
 * - in-flight writes are awaited on shutdown;
 * - anything still lost is logged as an error with its provider, model and
 *   quantities.
 */
@Injectable()
export class UsageMeterService implements OnModuleDestroy {
  private readonly log = new AppLogger(UsageMeterService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PriceCatalogService,
  ) {}

  record(event: UsageEvent): void {
    const write = this.write(event);
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
  }

  /** A deploy (SIGTERM) must not drop the rows of calls that just finished. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /** Awaitable form, for callers that must know the row exists (and tests). */
  async write(event: UsageEvent): Promise<void> {
    const occurredAt = event.occurredAt ?? new Date();
    const priced = await this.catalog
      .price(event.provider, event.model, event.quantities, occurredAt)
      .catch((err: unknown) => {
        this.log.error(
          "write",
          "pricing failed; recording the call unpriced",
          err,
          {
            provider: event.provider,
            model: event.model,
          },
        );
        return UNPRICED;
      });
    if (priced.cost === null) {
      this.log.warn("write", "no price for metered call; recorded unpriced", {
        provider: event.provider,
        model: event.model,
        feature: event.feature,
      });
    }

    let data = this.toRow(event, occurredAt, priced);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.prisma.usageRecord.create({ data });
        return;
      } catch (err) {
        if (attempt === 2) {
          this.log.error("write", "usage record lost after retry", err, {
            provider: event.provider,
            model: event.model,
            feature: event.feature,
            organizationId: event.organizationId,
            quantities: event.quantities,
          });
          return;
        }
        // The conversation or agent was erased between the call and this
        // write. Keep the cost; drop the links that no longer exist.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2003"
        ) {
          data = {
            ...data,
            chatSessionId: null,
            agentId: null,
            messageId: null,
          };
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  private toRow(
    event: UsageEvent,
    occurredAt: Date,
    priced: PricedCall,
  ): Prisma.UsageRecordUncheckedCreateInput {
    const q = event.quantities;
    return {
      occurredAt,
      organizationId: event.organizationId ?? null,
      agentId: event.agentId ?? null,
      chatSessionId: event.chatSessionId ?? null,
      messageId: event.messageId ?? null,
      traceId: event.traceId ?? null,
      channel: event.channel,
      feature: event.feature,
      provider: event.provider,
      model: event.model,
      providerRequestId: event.providerRequestId ?? null,
      inputTokens: q.inputTokens ?? null,
      cachedInputTokens: q.cachedInputTokens ?? null,
      cacheWriteTokens: q.cacheWriteTokens ?? null,
      outputTokens: q.outputTokens ?? null,
      reasoningTokens: q.reasoningTokens ?? null,
      audioSeconds: q.audioSeconds ?? null,
      characters: q.characters ?? null,
      units: q.units ?? null,
      cost: priced.cost,
      currency: priced.currency,
      pricing: priced.lines as unknown as Prisma.InputJsonValue,
      quantitySource: event.quantitySource,
      billedTo: event.billedTo ?? "PLATFORM",
      latencyMs: event.latencyMs ?? null,
    };
  }
}
