import { Module } from '@nestjs/common';
import { AgentsService } from '../services/agents.service';
import { AgentThemesService } from '../services/agent-themes.service';
import { AgentsController } from '../controllers/agents/agents.controller';
import { AgentThemesController } from '../controllers/agents/agent-themes.controller';
import { PrismaModule } from './prisma.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [AgentsController, AgentThemesController],
  providers: [AgentsService, AgentThemesService],
  exports: [AgentsService, AgentThemesService],
})
export class AgentsModule {}
