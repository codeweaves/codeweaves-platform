import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../modules/prisma.module';
import { RedisModule } from '../redis/redis.module';

import { AgentCacheService } from './agent-cache.service';

/**
 * Global module: `AgentCacheService` is used across the chat hot path
 * (DirectChatService), voice flow, knowledge-update writes, etc. Exposing
 * as a global module avoids threading explicit imports through every
 * consuming module.
 *
 * Follows the same pattern as AiTraceModule and TracerModule.
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [AgentCacheService],
  exports: [AgentCacheService],
})
export class AgentCacheModule {}
