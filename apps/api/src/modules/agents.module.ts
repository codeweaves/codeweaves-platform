import { Module } from '@nestjs/common';
import { AgentsService } from '../services/agents.service';
import { AgentKnowledgeService } from '../services/agent-knowledge.service';
import { AgentThemesService } from '../services/agent-themes.service';
import { FilesService } from '../services/files.service';
import { AgentsController } from '../controllers/agents/agents.controller';
import { AgentKnowledgeController } from '../controllers/agents/agent-knowledge.controller';
import { AgentThemesController } from '../controllers/agents/agent-themes.controller';
import { AgentFilesController } from '../controllers/agents/agent-files.controller';
import { PublicAgentsController } from '../controllers/public/public-agents.controller';
import { PrismaModule } from './prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AiSdkModule } from './ai/ai-sdk.module';

/**
 * AgentsModule exposes CRUD + configuration for agents and their sub-resources
 * (themes, files, knowledge base).
 *
 * Imports AiSdkModule to use TokenCounterService for computing + caching the
 * token count of uploaded knowledge content.
 */
@Module({
  imports: [PrismaModule, LoggerModule, AiSdkModule],
  controllers: [
    AgentsController,
    AgentThemesController,
    AgentFilesController,
    AgentKnowledgeController,
    PublicAgentsController,
  ],
  providers: [
    AgentsService,
    AgentThemesService,
    AgentKnowledgeService,
    FilesService,
  ],
  exports: [AgentsService, AgentThemesService, AgentKnowledgeService],
})
export class AgentsModule {}
