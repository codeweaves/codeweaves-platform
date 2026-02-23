import { Module } from '@nestjs/common';
import { AgentsService } from '../services/agents.service';
import { AgentThemesService } from '../services/agent-themes.service';
import { FilesService } from '../services/files.service';
import { AgentsController } from '../controllers/agents/agents.controller';
import { AgentThemesController } from '../controllers/agents/agent-themes.controller';
import { AgentFilesController } from '../controllers/agents/agent-files.controller';
import { PublicAgentsController } from '../controllers/public/public-agents.controller';
import { PrismaModule } from './prisma.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [AgentsController, AgentThemesController, AgentFilesController, PublicAgentsController],
  providers: [AgentsService, AgentThemesService, FilesService],
  exports: [AgentsService, AgentThemesService],
})
export class AgentsModule {}
