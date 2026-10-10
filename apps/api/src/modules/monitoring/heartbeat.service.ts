import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  PROVIDERS,
  ProviderEventLogger,
} from "../../common/events/provider.logger";
import { AppLogger } from "../../common/logger/app-logger";
import { redactUrlPath } from "./redact-url";

/** Cron job → the env var holding its Better Stack heartbeat URL (ADR-0013). */
export const HEARTBEAT_ENV = {
  CLASSIFIER: "HEARTBEAT_URL_CLASSIFIER",
  DATA_EXTRACTION: "HEARTBEAT_URL_DATA_EXTRACTION",
  HANDOVER_SWEEP: "HEARTBEAT_URL_HANDOVER_SWEEP",
  RETENTION: "HEARTBEAT_URL_RETENTION",
  FX: "HEARTBEAT_URL_FX",
  ALERTS: "HEARTBEAT_URL_ALERTS",
} as const;

export type HeartbeatJob = keyof typeof HEARTBEAT_ENV;

const HEARTBEAT_TIMEOUT_MS = 5_000;

/**
 * Tells Better Stack that a cron job finished. Better Stack alerts when a
 * heartbeat stops arriving, which also covers "the API is down" and "the
 * scheduler stopped calling us", cases our own alert job cannot see.
 *
 * Call `ping()` only after the job SUCCEEDED, and only when the work is done
 * (not when a background run was merely started). Fire-and-forget: it never
 * throws, never awaits, and never changes the job's result. A job with no URL
 * set is a no-op.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit {
  private readonly log = new AppLogger(HeartbeatService.name);
  private readonly urls: Partial<Record<HeartbeatJob, string>> = {};

  constructor(
    config: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {
    for (const job of Object.keys(HEARTBEAT_ENV) as HeartbeatJob[]) {
      const url = config.get<string>(HEARTBEAT_ENV[job])?.trim();
      if (url) this.urls[job] = url;
    }
  }

  onModuleInit(): void {
    const unset = (Object.keys(HEARTBEAT_ENV) as HeartbeatJob[]).filter(
      (job) => !this.urls[job],
    );
    if (unset.length > 0) {
      this.log.info("onModuleInit", "cron heartbeats off for some jobs", {
        unset: unset.map((job) => HEARTBEAT_ENV[job]),
      });
    }
  }

  ping(job: HeartbeatJob): void {
    const url = this.urls[job];
    if (!url) return;
    this.providerLog
      .traced(
        {
          channel: "INTERNAL",
          provider: PROVIDERS.BETTER_STACK,
          eventBase: "BETTER_STACK_HEARTBEAT",
          requestUrl: redactUrlPath(url),
          requestPayload: { job },
          extract: (status) => ({ responseStatus: status }),
        },
        async () => {
          const res = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`heartbeat HTTP ${res.status}`);
          return res.status;
        },
      )
      .catch((err: unknown) => {
        this.log.warn("ping", "heartbeat failed (ignored)", {
          job,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
