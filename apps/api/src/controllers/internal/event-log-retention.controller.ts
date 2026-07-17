import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';

import { Public } from '../../decorators/public.decorator';
import { InternalSecretGuard } from '../../guards/internal-secret.guard';
import {
  EventLogRetentionService,
  type EventLogCleanupResult,
} from '../../services/event-log-retention.service';

/**
 * Internal trigger for the event-log retention sweep (observability Phase 8).
 *
 * Same auth + shape as the classifier / handover-sweep crons: an external
 * scheduler (Supabase pg_cron, Render Cron, cron-job.org…) POSTs here with the
 * shared secret. Ships as a no-op — `EVENT_LOG_RETENTION_DAYS=0` (default) keeps
 * rows forever; set it to a positive number to arm deletion.
 *
 *   curl -X POST https://<api-host>/internal/event-logs/cleanup \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public()                       — no JWT (the caller is a cron, not a user)
 * @UseGuards(InternalSecretGuard) — the real auth gate (shared secret header)
 * Rate limiting is opt-in, so the absence of @RateLimit() means zero Redis.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalSecretGuard)
@Controller('internal/event-logs')
export class EventLogRetentionController {
  constructor(private readonly retention: EventLogRetentionService) {}

  @Post('cleanup')
  @ApiExcludeEndpoint()
  cleanup(): Promise<EventLogCleanupResult> {
    // Bounded single DELETE (or a no-op when disabled), so we await + return the
    // outcome rather than fire-and-forget.
    return this.retention.cleanup();
  }
}
