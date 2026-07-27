import { Module } from '@nestjs/common';
import { EmailService } from '../services/email.service';
import { EmailTemplateService } from '../services/email-template.service';
import { EmailTemplatesController } from '../controllers/email-templates/email-templates.controller';
import { LoggerModule } from '../common/logger/logger.module';
import { PrismaModule } from './prisma.module';

/**
 * Email: the Resend transport plus the DB-backed template layer that the
 * founders edit in Utilities → Email.
 *
 * EmailTemplateService is exported so any sender (invitations, notifications)
 * renders from the same cached, escaped code path rather than hand-rolling HTML.
 */
@Module({
  imports: [LoggerModule, PrismaModule],
  controllers: [EmailTemplatesController],
  providers: [EmailService, EmailTemplateService],
  exports: [EmailService, EmailTemplateService],
})
export class EmailModule {}
