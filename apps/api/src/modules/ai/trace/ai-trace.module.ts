import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma.module';

import { AiTraceService } from './ai-trace.service';

/**
 * Global module: every service in the AI orchestration layer (and the controllers
 * that expose it) needs to emit trace steps, so exporting once as a global module
 * avoids repetitive imports. Follows the same pattern as TracerModule for the
 * audit logger.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AiTraceService],
  exports: [AiTraceService],
})
export class AiTraceModule {}
