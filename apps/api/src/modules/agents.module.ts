import { Module } from '@nestjs/common';
import { AgentsService } from '../services/agents.service';
import { AgentsController } from '../controllers/agents/agents.controller';
import { PrismaModule } from './prisma.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
