import { Module } from '@nestjs/common';
import { AiClassifierService } from './ai-classifier.service';

/**
 * Minimal AI layer for platform-internal classification (post-session
 * categorisation, language detection). Distinct from the chat-time AI
 * orchestration layer (see modules/voice and the planned Phase-3
 * orchestration epic) — those serve agent responses; this one labels
 * data for analytics.
 */
@Module({
  providers: [AiClassifierService],
  exports: [AiClassifierService],
})
export class AiModule {}
