import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppLogger } from '../common/logger/app-logger';
import {
  EventLogRetentionService,
  type EventLogCleanupResult,
} from './event-log-retention.service';
import { PrismaService } from './prisma.service';

/** One table's retention outcome. `skipped` = window 0/unset for that table. */
export interface TableRetentionResult {
  deleted: number;
  skipped: boolean;
  retentionDays: number;
  cutoff?: string;
}

export interface RetentionSweepResult {
  chatTraces: TableRetentionResult;
  auditLogs: TableRetentionResult;
  eventLogs: EventLogCleanupResult;
}

/**
 * DPDP retention sweep (S4) — trims aged rows from the PII-bearing
 * observability tables, on the industry-anchored windows from
 * docs/plans/dpdp-compliance-plan.md:
 *
 *   - chat_traces  → CHAT_TRACE_RETENTION_DAYS, default 90 (armed by default:
 *     AI debug traces hold full message text and are only useful fresh)
 *   - audit_logs   → AUDIT_LOG_RETENTION_DAYS, default 0 = keep forever
 *     (accountability trail — arm deliberately, keep ≥ 365 when armed)
 *   - event_logs   → delegated to EventLogRetentionService and its existing
 *     EVENT_LOG_RETENTION_DAYS contract (0/unset = keep; set 365 in prod)
 *
 * Product data (chat_messages, collected_data) is NEVER touched here — it is
 * removed only by the erasure engine (PurgeService) on an explicit request.
 *
 * Driven by an external cron via /internal/retention/run — no in-process
 * scheduler, per the platform's Redis-free internal-cron pattern.
 */
@Injectable()
export class DataRetentionService {
  private readonly log = new AppLogger(DataRetentionService.name);
  /** Bounded batches: never hold one long DELETE lock on a hot table. */
  private static readonly BATCH = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventLogRetention: EventLogRetentionService,
  ) {}

  /** Window in days; `fallback` applies when the var is unset/non-numeric. */
  private resolveDays(envVar: string, fallback: number): number {
    const raw = this.config.get<string>(envVar);
    if (raw == null || String(raw).trim() === '') return fallback;
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async run(): Promise<RetentionSweepResult> {
    const [chatTraces, auditLogs, eventLogs] = [
      await this.sweepChatTraces(),
      await this.sweepAuditLogs(),
      await this.eventLogRetention.cleanup(),
    ];
    this.log.info('run', 'retention sweep complete', {
      chatTraces: chatTraces.deleted,
      auditLogs: auditLogs.deleted,
      eventLogs: eventLogs.deleted,
    });
    return { chatTraces, auditLogs, eventLogs };
  }

  private async sweepChatTraces(): Promise<TableRetentionResult> {
    const retentionDays = this.resolveDays('CHAT_TRACE_RETENTION_DAYS', 90);
    if (retentionDays <= 0) {
      return { deleted: 0, skipped: true, retentionDays: 0 };
    }
    const cutoff = this.cutoff(retentionDays);
    let deleted = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM chat_traces
        WHERE id IN (
          SELECT id FROM chat_traces WHERE "createdAt" < ${cutoff} LIMIT ${DataRetentionService.BATCH}
        )`;
      deleted += n;
      if (n < DataRetentionService.BATCH) break;
    }
    if (deleted > 0) {
      this.log.info('sweepChatTraces', 'deleted expired chat_traces rows', {
        retentionDays,
        cutoff: cutoff.toISOString(),
        deleted,
      });
    }
    return { deleted, skipped: false, retentionDays, cutoff: cutoff.toISOString() };
  }

  private async sweepAuditLogs(): Promise<TableRetentionResult> {
    const retentionDays = this.resolveDays('AUDIT_LOG_RETENTION_DAYS', 0);
    if (retentionDays <= 0) {
      return { deleted: 0, skipped: true, retentionDays: 0 };
    }
    const cutoff = this.cutoff(retentionDays);
    let deleted = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM audit_logs
        WHERE id IN (
          SELECT id FROM audit_logs WHERE "createdAt" < ${cutoff} LIMIT ${DataRetentionService.BATCH}
        )`;
      deleted += n;
      if (n < DataRetentionService.BATCH) break;
    }
    if (deleted > 0) {
      this.log.info('sweepAuditLogs', 'deleted expired audit_logs rows', {
        retentionDays,
        cutoff: cutoff.toISOString(),
        deleted,
      });
    }
    return { deleted, skipped: false, retentionDays, cutoff: cutoff.toISOString() };
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
