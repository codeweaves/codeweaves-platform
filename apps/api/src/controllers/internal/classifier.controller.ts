import { Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';

import { Public } from '../../decorators/public.decorator';
import { InternalSecretGuard } from '../../guards/internal-secret.guard';
import { ConversationClassifierService } from '../../services/conversation-classifier.service';

/**
 * Internal trigger for the conversation-classifier batch pass.
 *
 * Replaces the in-process BullMQ repeatable job (which kept a worker polling
 * Redis 24/7). An external scheduler — Render Cron, GitHub Actions, cron-job.org,
 * Upstash QStash, etc. — POSTs here on whatever schedule you configure
 * (recommended: daily `0 2 * * *`) with the shared secret header.
 *
 *   curl -X POST https://<api-host>/internal/classifier/run \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public()                    — no JWT (the caller is a cron, not a user)
 * @UseGuards(InternalSecretGuard) — the real auth gate (shared secret)
 * Rate limiting is opt-in, so the absence of @RateLimit() means zero Redis.
 *
 * `runBatch()` is idempotent, so overlapping/duplicate invocations are safe.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalSecretGuard)
@Controller('internal/classifier')
export class ClassifierController {
  private readonly logger = new Logger(ClassifierController.name);

  constructor(
    private readonly classifier: ConversationClassifierService,
  ) {}

  @Post('run')
  @ApiExcludeEndpoint()
  run(): { started: boolean } {
    // Start the batch in the background and ACK immediately. A daily pass over
    // up to 200 sessions runs far longer than the scheduler's HTTP timeout
    // (Supabase caps it at 5s); the work continues server-side. runBatch() is
    // idempotent and overlap-guarded, so a duplicate trigger is a safe no-op.
    const started = this.classifier.triggerBatch();
    this.logger.log(
      `Classifier trigger: pass ${started ? 'started' : 'already running'}.`,
    );
    return { started };
  }
}
