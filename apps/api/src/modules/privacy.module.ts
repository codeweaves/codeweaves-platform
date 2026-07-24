import { Module } from '@nestjs/common';

import { PrivacyController } from '../controllers/privacy/privacy.controller';
import { PurgeService } from '../services/purge.service';

import { PrismaModule } from './prisma.module';

/**
 * Privacy / data-subject rights (DPDP): the erasure engine and its endpoints.
 * TracerService and SupabaseStorageService are global. Exports PurgeService
 * so future flows (e.g. scheduled erasure requests) can reuse the engine.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PrivacyController],
  providers: [PurgeService],
  exports: [PurgeService],
})
export class PrivacyModule {}
