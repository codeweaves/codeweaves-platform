import { Module } from '@nestjs/common';

import { ClassifierController } from '../controllers/internal/classifier.controller';
import { InternalSecretGuard } from '../guards/internal-secret.guard';
import { ConversationClassifierService } from '../services/conversation-classifier.service';
import { AiModule } from '../common/ai/ai.module';
import { PrismaModule } from './prisma.module';

/**
 * Conversation classifier.
 *
 * Scheduling is external-cron-driven — NO BullMQ, NO in-process worker, NO
 * Redis. Previously a BullMQ repeatable job ran the batch, but the worker
 * polled Redis around the clock (BZPOPMIN + stalled-job EVALSHA) even with no
 * jobs, which dominated our Upstash command bill. Now an external scheduler
 * POSTs `/internal/classifier/run` (guarded by INTERNAL_API_SECRET) on a daily
 * cadence. See docs/plans/redis-usage-reduction.md.
 *
 * `ConversationClassifierService.runBatch()` is idempotent, so a missed or
 * duplicated cron tick is harmless.
 */
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [ClassifierController],
  providers: [ConversationClassifierService, InternalSecretGuard],
  exports: [ConversationClassifierService],
})
export class ConversationClassifierModule {}
