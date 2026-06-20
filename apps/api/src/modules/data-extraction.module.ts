import { Module } from '@nestjs/common';

import { AiModule } from '../common/ai/ai.module';
import { DataExtractionController } from '../controllers/data-extraction/data-extraction.controller';
import { DataExtractionService } from '../services/data-extraction.service';

import { PrismaModule } from './prisma.module';

/**
 * Data-capture extraction. Postgres-only — no BullMQ/Redis. The debounce lives
 * in `ChatSession.extractionDueAt` (a column), and extraction runs when the
 * internal endpoint is called (external cron in prod; by hand in local/testing).
 *
 * Exports DataExtractionService so DirectChatService can stamp the due time
 * after a reply.
 */
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [DataExtractionController],
  providers: [DataExtractionService],
  exports: [DataExtractionService],
})
export class DataExtractionModule {}
