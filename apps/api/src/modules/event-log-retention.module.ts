import { Module } from '@nestjs/common';

import { EventLogRetentionController } from '../controllers/internal/event-log-retention.controller';
import { InternalSecretGuard } from '../guards/internal-secret.guard';
import { EventLogRetentionService } from '../services/event-log-retention.service';
import { PrismaModule } from './prisma.module';

/**
 * Event-log retention (observability Phase 8).
 *
 * Exposes the internal-secret-guarded `/internal/event-logs/cleanup` endpoint an
 * external scheduler can POST to. Ships disabled (`EVENT_LOG_RETENTION_DAYS=0` =
 * keep forever); flip the env var to a positive number to arm the sweep.
 *
 * PrismaService is global, but we import PrismaModule for parity with the other
 * internal-cron modules. `InternalSecretGuard` is provided so @UseGuards on the
 * controller can resolve it (it depends on the global ConfigService).
 */
@Module({
  imports: [PrismaModule],
  controllers: [EventLogRetentionController],
  providers: [EventLogRetentionService, InternalSecretGuard],
  exports: [EventLogRetentionService],
})
export class EventLogRetentionModule {}
