import { Module } from '@nestjs/common';
import { OrganizationLoggerService } from './organization.logger';
import { InvitationLoggerService } from './invitation.logger';
import { UserLoggerService } from './user.logger';
import { ClerkLoggerService } from './clerk.logger';
import { EmailLoggerService } from './email.logger';
import { AgentLoggerService } from './agent.logger';

@Module({
  providers: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    ClerkLoggerService,
    EmailLoggerService,
    AgentLoggerService,
  ],
  exports: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    ClerkLoggerService,
    EmailLoggerService,
    AgentLoggerService,
  ],
})
export class LoggerModule {}
