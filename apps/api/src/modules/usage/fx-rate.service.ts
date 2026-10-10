import { Injectable } from "@nestjs/common";

import { InternalEventLogger } from "../../common/events/internal.logger";
import {
  PROVIDERS,
  ProviderEventLogger,
} from "../../common/events/provider.logger";
import { AppLogger } from "../../common/logger/app-logger";
import { PrismaService } from "../../services/prisma.service";

/** Free central-bank reference rates, no key (https://frankfurter.dev). */
const FX_URL = "https://api.frankfurter.dev/v2/rate/usd/inr";

interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

/**
 * Keeps one USD→INR rate per day in `fx_rates` (ADR-0012). Reports convert
 * USD costs to INR with the rate for the call's date (or the nearest earlier
 * day), so a missed day only means the previous day's rate is used.
 */
@Injectable()
export class FxRateService {
  private readonly log = new AppLogger(FxRateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerLog: ProviderEventLogger,
    private readonly internalLog: InternalEventLogger,
  ) {}

  /** Fetch today's rate and store it. Idempotent: re-running a day overwrites it. */
  async refresh(): Promise<{ date: string; usdToInr: number }> {
    try {
      const body = await this.providerLog.traced<FrankfurterRate>(
        {
          channel: "INTERNAL",
          provider: PROVIDERS.FRANKFURTER,
          eventBase: "FRANKFURTER_FX_RATE",
          requestUrl: FX_URL,
          extract: (r) => ({ responsePayload: { date: r.date, rate: r.rate } }),
        },
        async () => {
          const res = await fetch(FX_URL, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`FX rate HTTP ${res.status}`);
          return (await res.json()) as FrankfurterRate;
        },
      );
      if (body.base !== "USD" || body.quote !== "INR" || !(body.rate > 0)) {
        throw new Error(`unexpected FX payload: ${JSON.stringify(body)}`);
      }

      const date = new Date(`${body.date}T00:00:00Z`);
      await this.prisma.fxRate.upsert({
        where: { date },
        create: { date, usdToInr: body.rate, source: "frankfurter" },
        update: {
          usdToInr: body.rate,
          source: "frankfurter",
          fetchedAt: new Date(),
        },
      });
      this.internalLog.logCompleted("FX_RATE_RUN_COMPLETED", {
        metadata: { date: body.date, usdToInr: body.rate },
      });
      return { date: body.date, usdToInr: body.rate };
    } catch (err) {
      this.log.error("refresh", "USD-INR rate refresh failed", err);
      this.internalLog.logFailed("FX_RATE_RUN_FAILED", err);
      throw err;
    }
  }
}
