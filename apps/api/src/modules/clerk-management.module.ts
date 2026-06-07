import { Module } from '@nestjs/common';
import { ClerkManagementService } from '../services/clerk-management.service';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [ClerkManagementService],
  exports: [ClerkManagementService],
})
export class ClerkManagementModule {}
