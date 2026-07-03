import { Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';

import { Public } from '../../decorators/public.decorator';
import { InternalSecretGuard } from '../../guards/internal-secret.guard';
import { HandoverService } from '../../services/handover.service';

/**
 * Internal trigger for the idle-handover sweep — auto-resolves abandoned live
 * chats (no activity for HANDOVER_IDLE_MINUTES) back to the AI, so nobody has
 * to remember to click "Resolve" and the Inbox doesn't fill with ghosts.
 *
 * Same pattern + auth as the classifier: an external scheduler (Supabase
 * pg_cron recommended, every ~5 min) POSTs here with the shared secret:
 *
 *   curl -X POST https://<api-host>/internal/handover/sweep \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public() — no JWT (the caller is a cron). InternalSecretGuard is the gate.
 * The sweep is a fast bounded DB pass (<=200 rows) + best-effort realtime, so
 * we await it and return the count rather than fire-and-forget.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalSecretGuard)
@Controller('internal/handover')
export class HandoverSweepController {
  private readonly logger = new Logger(HandoverSweepController.name);

  constructor(private readonly handover: HandoverService) {}

  @Post('sweep')
  @ApiExcludeEndpoint()
  async sweep(): Promise<{ resolved: number }> {
    const result = await this.handover.sweepIdleHandovers();
    return result;
  }
}
