import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppLogger } from "../common/logger/app-logger";
import { InternalEventLogger } from "../common/events/internal.logger";
import { PrismaService } from "./prisma.service";

/** Result of a retention pass. `skipped` = retention disabled (keep forever). */
export interface EventLogCleanupResult {
  deleted: number;
  skipped: boolean;
  retentionDays: number;
  cutoff?: string;
}

/**
 * Phase-8 retention for the unified `event_logs` table.
 *
 * Ships DISABLED: `EVENT_LOG_RETENTION_DAYS=0` (the default) = keep forever, so
 * `cleanup()` is a pure no-op — it never issues a DELETE. Only a value that
 * parses to a positive integer arms the sweep, deleting rows older than that
 * many days. Driven by an external cron via the internal-secret endpoint, the
 * same pattern as the classifier / handover sweep.
 */
@Injectable()
export class EventLogRetentionService {
  private readonly log = new AppLogger(EventLogRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly internalLog: InternalEventLogger,
  ) {}

  /**
   * Parsed retention window in days. 0 (or unset / non-numeric / negative) means
   * "keep forever" → cleanup is disabled.
   */
  private resolveRetentionDays(): number {
    const raw = this.config.get<string>("EVENT_LOG_RETENTION_DAYS");
    const parsed = raw != null ? Number.parseInt(String(raw), 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /**
   * Delete `event_logs` rows older than the configured retention window.
   * No-op (returns `{ deleted: 0, skipped: true }`) when retention is 0/disabled.
   */
  async cleanup(): Promise<EventLogCleanupResult> {
    // Every pass, no-op or not, is recorded so the ops console can show when
    // the cron last ran. Fire-and-forget: logging never fails the sweep.
    const start = Date.now();
    try {
      const result = await this.sweep();
      this.internalLog.logCompleted("EVENT_LOG_CLEANUP_COMPLETED", {
        latencyMs: Date.now() - start,
        metadata: { ...result },
      });
      return result;
    } catch (err) {
      this.internalLog.logFailed("EVENT_LOG_CLEANUP_FAILED", err, {
        metadata: { latencyMs: Date.now() - start },
      });
      throw err;
    }
  }

  private async sweep(): Promise<EventLogCleanupResult> {
    const retentionDays = this.resolveRetentionDays();
    if (retentionDays <= 0) {
      this.log.info("cleanup", "retention disabled (keep forever) — skipping", {
        retentionDays,
      });
      return { deleted: 0, skipped: true, retentionDays: 0 };
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    // Delete in bounded batches (id-subselect + LIMIT) rather than one giant
    // DELETE. A first sweep over months of accumulation must not hold a single
    // long lock on the hot-write event_logs table; each batch commits + releases.
    const BATCH = 5_000;
    let deleted = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM event_logs
        WHERE id IN (
          SELECT id FROM event_logs WHERE "createdAt" < ${cutoff} LIMIT ${BATCH}
        )`;
      deleted += n;
      if (n < BATCH) break;
    }
    this.log.info("cleanup", "deleted expired event_logs rows", {
      retentionDays,
      cutoff: cutoff.toISOString(),
      deleted,
    });
    return {
      deleted,
      skipped: false,
      retentionDays,
      cutoff: cutoff.toISOString(),
    };
  }
}
