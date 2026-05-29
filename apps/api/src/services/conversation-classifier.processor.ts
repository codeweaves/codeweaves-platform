import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConversationClassifierService } from './conversation-classifier.service';
import { CLASSIFIER_QUEUE } from '../modules/conversation-classifier.constants';

/**
 * BullMQ worker for the `conversation-classifier` queue. Triggered by the
 * twice-daily repeatable job declared in ConversationClassifierModule, or by
 * any future manual enqueue (e.g., an admin "re-run now" trigger).
 *
 * Keeps zero logic — just defers to `ConversationClassifierService.runBatch`,
 * which is independently unit-tested.
 */
@Processor(CLASSIFIER_QUEUE)
export class ConversationClassifierProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversationClassifierProcessor.name);

  constructor(
    private readonly classifier: ConversationClassifierService,
  ) {
    super();
  }

  async process(): Promise<{ processed: number }> {
    const processed = await this.classifier.runBatch();
    if (processed > 0) {
      this.logger.log(`Classified ${processed} session(s).`);
    }
    return { processed };
  }
}
