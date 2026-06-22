import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';

import { Public } from '../../decorators/public.decorator';
import { InternalSecretGuard } from '../../guards/internal-secret.guard';
import { DataExtractionService } from '../../services/data-extraction.service';

/**
 * Internal trigger for background data capture. An external scheduler (Render
 * Cron, cron-job.org, Cloud Scheduler, QStash…) POSTs here on a schedule with
 * the shared secret header:
 *
 *   curl -X POST https://<api-host>/internal/data-extraction/run \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * Pass `{ "sessionId": "<id>" }` to extract one conversation immediately
 * (skips the debounce timer) — handy for manual testing/debugging.
 *
 * @Public()                       — no JWT (the caller is a cron, not a user)
 * @UseGuards(InternalSecretGuard) — the real auth gate (shared secret),
 *                                   same guard the classifier endpoint uses.
 *
 * Note: local feature testing usually goes through the in-process poll timer in
 * DataExtractionService, which calls runDuePass() directly and needs no secret.
 * This endpoint is for the prod cron trigger + on-demand extraction.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalSecretGuard)
@Controller('internal/data-extraction')
export class DataExtractionController {
  private readonly logger = new Logger(DataExtractionController.name);

  constructor(private readonly extraction: DataExtractionService) {}

  @Post('run')
  @ApiExcludeEndpoint()
  async run(
    @Body() body: { sessionId?: string } | undefined,
  ): Promise<
    | { mode: 'single'; sessionId: string; outcome: string }
    | { mode: 'due-pass'; started: boolean }
  > {
    // On-demand single extraction (bypasses the debounce) — for manual testing.
    // One session, fast enough to await within the cron's 5s timeout.
    if (body?.sessionId) {
      const outcome = await this.extraction.extractForSession(body.sessionId);
      return { mode: 'single', sessionId: body.sessionId, outcome };
    }

    // Cron trigger: start the pass in the background and ACK immediately. The
    // batch can take longer than the scheduler's HTTP timeout (Supabase caps it
    // at 5s); the work continues server-side. Overlap-guarded, so a tick that
    // lands while a pass is still running is a harmless no-op.
    const started = this.extraction.triggerDuePass();
    this.logger.log(`Data-extraction trigger: pass ${started ? 'started' : 'already running'}.`);
    return { mode: 'due-pass', started };
  }
}
