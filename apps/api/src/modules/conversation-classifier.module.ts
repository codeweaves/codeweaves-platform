import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ConversationClassifierService } from '../services/conversation-classifier.service';
import { ConversationClassifierProcessor } from '../services/conversation-classifier.processor';
import { AiModule } from '../common/ai/ai.module';
import { PrismaModule } from './prisma.module';
import { CLASSIFIER_QUEUE, CLASSIFIER_JOB } from './conversation-classifier.constants';

// ============================================================================
// TODO (production hardening — revisit before scaling beyond a single backend
// instance):
//
// The BullMQ worker currently runs INSIDE the API process. For an MVP at one
// Render web instance this is fine — Redis-based locking already prevents
// double-firing if you accidentally bring up a second instance, and the
// scheduled job lives in Redis (not in process memory) so it survives
// restarts.
//
// Before going to real production scale (multiple web instances, or any time
// the worker workload competes with HTTP latency), split the worker into a
// separate Render Background Worker service that boots only this module:
//   1. Add a `worker.ts` entrypoint that loads ClassifierQueueModule (no AppModule HTTP)
//   2. Deploy as a Render "Background Worker" service pointing at the same repo
//   3. Set the web service's BullModule to register the queue WITHOUT a Worker
//      (the worker process owns processing; the web process only enqueues)
//
// Until then: worker runs in-process, gated by Redis. Safe, simple.
// ============================================================================

@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (!redisUrl) {
          throw new Error('REDIS_URL is required for the classifier queue');
        }
        // BullMQ accepts a URL string directly. Reusing the same env var the
        // existing RedisService uses keeps deployment config in one place.
        return { connection: { url: redisUrl } };
      },
    }),
    BullModule.registerQueue({ name: CLASSIFIER_QUEUE }),
  ],
  providers: [ConversationClassifierService, ConversationClassifierProcessor],
  exports: [ConversationClassifierService],
})
export class ConversationClassifierModule implements OnModuleInit {
  private readonly logger = new Logger(ConversationClassifierModule.name);

  constructor(
    @InjectQueue(CLASSIFIER_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Define ONE repeatable job. BullMQ keys repeatable jobs by (name, pattern,
    // jobId) so calling this on every boot is idempotent — the same schedule
    // doesn't get duplicated when N instances start.
    //
    // Schedule: 02:00 UTC daily (once a day). With per-agent session
    // lifetimes ranging 6-24h, this gives every session a chance to expire
    // before the next sweep. Worst-case end-to-end lag from session-end to
    // classification is ~24h, which is fine for an analytics dashboard.
    await this.queue.add(
      CLASSIFIER_JOB,
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'classifier-repeatable',
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    );
    this.logger.log(
      `Registered repeatable job "${CLASSIFIER_JOB}" (cron: 0 2 * * *)`,
    );
  }
}
