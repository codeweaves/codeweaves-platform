import { Module } from '@nestjs/common';
import { OrganizationLoggerService } from './organization.logger';
import { InvitationLoggerService } from './invitation.logger';
import { UserLoggerService } from './user.logger';
import { ClerkLoggerService } from './clerk.logger';
import { EmailLoggerService } from './email.logger';
import { AgentLoggerService } from './agent.logger';
import { RagLoggerService } from './rag.logger';
import { IntegrationLoggerService } from './integration.logger';

@Module({
  providers: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    ClerkLoggerService,
    EmailLoggerService,
    AgentLoggerService,
    RagLoggerService,
    IntegrationLoggerService,
  ],
  exports: [
    OrganizationLoggerService,
    InvitationLoggerService,
    UserLoggerService,
    ClerkLoggerService,
    EmailLoggerService,
    AgentLoggerService,
    RagLoggerService,
    IntegrationLoggerService,
  ],
})
export class LoggerModule {}
