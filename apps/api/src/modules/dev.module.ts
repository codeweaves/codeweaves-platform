import { Module } from '@nestjs/common';

import { DevAiController } from '../controllers/dev/dev-ai.controller';

import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat.module';
import { PrismaModule } from './prisma.module';

/**
 * DevModule: dev-only surface for exercising internal services end-to-end
 * without UI or external integrations. Endpoints gate themselves on
 * NODE_ENV at runtime (see DevAiController.assertNotProduction).
 *
 * Safe to leave registered in app.module.ts — the endpoints 404 in prod.
 * Could alternatively be conditionally imported, but that complicates CI
 * builds that use NODE_ENV=test.
 */
@Module({
  imports: [PrismaModule, ChatModule, AiModule],
  controllers: [DevAiController],
})
export class DevModule {}
