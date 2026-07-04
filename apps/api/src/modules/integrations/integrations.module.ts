import { Module } from '@nestjs/common';

import { LoggerModule } from '../../common/logger/logger.module';
import { PrismaModule } from '../prisma.module';

import { AgentToolsService } from './agent-tools.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ProviderRegistry } from './provider-registry';
import { HubspotProvider } from './providers/hubspot.provider';
import { SlackProvider } from './providers/slack.provider';

/**
 * IntegrationsModule: concrete third-party integrations (HubSpot, Slack) an
 * agent's LLM can call mid-conversation, plus the dashboard connect/test API.
 *
 * AgentToolsService is exported for DirectChatService (AiModule) to load the
 * per-agent ToolSet on the chat hot path. CryptoService is global.
 */
@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [IntegrationsController],
  providers: [
    HubspotProvider,
    SlackProvider,
    ProviderRegistry,
    IntegrationsService,
    AgentToolsService,
  ],
  exports: [AgentToolsService, IntegrationsService],
})
export class IntegrationsModule {}
