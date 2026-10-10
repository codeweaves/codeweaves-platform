import { Injectable } from "@nestjs/common";

import { AppLogger } from "../../common/logger/app-logger";
import { PrismaService } from "../../services/prisma.service";
import { UsageMeterService } from "../usage/usage-meter.service";

import type { WhatsappStatus } from "./interfaces/whatsapp.interfaces";

/** Provider key of Meta's per-message charge in `provider_prices`. */
export const META_WHATSAPP_PROVIDER = "meta_whatsapp";

/** The price list holds India (+91) rates only. */
const PRICED_COUNTRY_PREFIX = "91";

/**
 * Records Meta's per-message WhatsApp charge from status webhooks (ADR-0012).
 *
 * Meta bills the client's own WhatsApp Business Account, so rows are
 * `billedTo = CLIENT`: shown to the client, kept out of our own cost. Meta
 * decides what is billable: messages in the monthly free tier or a free window
 * arrive with `billable: false` and are not recorded.
 *
 * One row per message id (wamid). Meta repeats `pricing` on `sent`,
 * `delivered` and `read`, so duplicates are dropped twice over: an in-memory
 * set catches the burst on this instance, and a ledger lookup catches repeats
 * after a restart or on another instance.
 */
@Injectable()
export class WhatsappUsageService {
  private readonly log = new AppLogger(WhatsappUsageService.name);
  private readonly seen = new Set<string>();
  private static readonly SEEN_CAP = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageMeter: UsageMeterService,
  ) {}

  /** Never throws: called after the webhook has already been acknowledged. */
  async recordStatuses(
    phoneNumberId: string,
    statuses: readonly WhatsappStatus[],
  ): Promise<void> {
    const billable = new Map<string, WhatsappStatus>();
    for (const s of statuses) {
      if (!s?.id || s.status === "failed" || s.pricing?.billable !== true) {
        continue;
      }
      if (this.seen.has(s.id) || billable.has(s.id)) continue;
      billable.set(s.id, s);
    }
    if (billable.size === 0) return;

    // Claim the ids before any await, so a concurrent webhook for the same
    // message on this instance skips them.
    const ids = [...billable.keys()];
    ids.forEach((id) => this.markSeen(id));

    try {
      const [channel, existing] = await Promise.all([
        this.prisma.whatsappChannel.findUnique({
          where: { phoneNumberId },
          select: {
            agentId: true,
            agent: { select: { organizationId: true } },
          },
        }),
        this.prisma.usageRecord.findMany({
          where: {
            provider: META_WHATSAPP_PROVIDER,
            providerRequestId: { in: ids },
          },
          select: { providerRequestId: true },
        }),
      ]);
      if (!channel) {
        // Still recorded: the charge happened even if the channel was removed.
        this.log.warn("recordStatuses", "billable status for unknown channel", {
          phoneNumberId,
        });
      }
      const recorded = new Set(existing.map((r) => r.providerRequestId));

      for (const [wamid, status] of billable) {
        if (recorded.has(wamid)) continue;
        this.usageMeter.record({
          occurredAt: statusTime(status),
          organizationId: channel?.agent.organizationId ?? null,
          agentId: channel?.agentId ?? null,
          channel: "WHATSAPP",
          feature: "WHATSAPP_MESSAGE",
          provider: META_WHATSAPP_PROVIDER,
          model: priceModel(status),
          providerRequestId: wamid,
          quantities: { units: 1 },
          quantitySource: "PROVIDER_REPORTED",
          billedTo: "CLIENT",
        });
      }
    } catch (err) {
      // Let a later status for the same message try again.
      ids.forEach((id) => this.seen.delete(id));
      this.log.error(
        "recordStatuses",
        "failed to record WhatsApp charges",
        err,
        {
          phoneNumberId,
          count: ids.length,
        },
      );
    }
  }

  private markSeen(id: string): void {
    this.seen.add(id);
    if (this.seen.size > WhatsappUsageService.SEEN_CAP) {
      // Insertion-ordered: drop the oldest half.
      const it = this.seen.values();
      for (let i = 0; i < WhatsappUsageService.SEEN_CAP / 2; i++) {
        const oldest = it.next().value;
        if (oldest !== undefined) this.seen.delete(oldest);
      }
    }
  }
}

/**
 * Price-list model for a status. Meta's rate depends on the category and the
 * recipient's country; only India is priced, so other countries get their own
 * model name and are stored unpriced (flagged) rather than at the wrong rate.
 */
export function priceModel(status: WhatsappStatus): string {
  const category = (status.pricing?.category ?? "unknown").toLowerCase();
  return status.recipient_id?.startsWith(PRICED_COUNTRY_PREFIX)
    ? category
    : `${category}:intl`;
}

function statusTime(status: WhatsappStatus): Date | undefined {
  const seconds = Number(status.timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : undefined;
}
