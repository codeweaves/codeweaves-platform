import { Module } from '@nestjs/common';
import { OrganizationLoggerService } from './organization.logger';
import { InvitationLoggerService } from './invitation.logger';
import { UserLoggerService } from './user.logger';
import { Auth0LoggerService } from './auth0.logger';
import { EmailLoggerService } from './email.logger';

@Module({
  providers: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    Auth0LoggerService,
    EmailLoggerService,
  ],
  exports: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    Auth0LoggerService,
    EmailLoggerService,
  ],
})
export class LoggerModule {}
