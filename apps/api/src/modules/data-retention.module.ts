import { Module } from '@nestjs/common';

import { DataRetentionController } from '../controllers/internal/data-retention.controller';
import { InternalSecretGuard } from '../guards/internal-secret.guard';
import { DataRetentionService } from '../services/data-retention.service';

import { EventLogRetentionModule } from './event-log-retention.module';
import { PrismaModule } from './prisma.module';

/**
 * DPDP retention sweep (S4). Imports EventLogRetentionModule to reuse its
 * service (one sweep endpoint covers all three tables); the standalone
 * /internal/event-logs/cleanup endpoint keeps working unchanged.
 */
@Module({
  imports: [PrismaModule, EventLogRetentionModule],
  controllers: [DataRetentionController],
  providers: [DataRetentionService, InternalSecretGuard],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
