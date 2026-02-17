import { Module } from '@nestjs/common';
import { EmailService } from '../services/email.service';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
