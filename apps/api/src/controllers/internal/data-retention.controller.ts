import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";

import { Public } from "../../decorators/public.decorator";
import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { HeartbeatService } from "../../modules/monitoring/heartbeat.service";
import {
  DataRetentionService,
  type RetentionSweepResult,
} from "../../services/data-retention.service";

/**
 * Internal trigger for the DPDP retention sweep (S4): one call trims
 * chat_traces, audit_logs and event_logs on their configured windows.
 *
 * Same auth + shape as the classifier / handover / event-log crons — an
 * external scheduler POSTs here daily with the shared secret:
 *
 *   curl -X POST https://<api-host>/internal/retention/run \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * Windows (days; 0 = keep forever):
 *   CHAT_TRACE_RETENTION_DAYS (default 90) · AUDIT_LOG_RETENTION_DAYS
 *   (default 0) · EVENT_LOG_RETENTION_DAYS (default 0 — set 365 in prod).
 */
@ApiTags("Internal")
@Public()
@UseGuards(InternalSecretGuard)
@Controller("internal/retention")
export class DataRetentionController {
  constructor(
    private readonly retention: DataRetentionService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  @Post("run")
  @ApiExcludeEndpoint()
  async run(): Promise<RetentionSweepResult> {
    const result = await this.retention.run();
    // Awaited run, so a successful return here is the finished sweep.
    this.heartbeat.ping("RETENTION");
    return result;
  }
}
