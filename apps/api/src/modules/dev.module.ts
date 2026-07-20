import { Module } from '@nestjs/common';

import { DevAiController } from '../controllers/dev/dev-ai.controller';

import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat.module';
import { PrismaModule } from './prisma.module';

/**
 * DevModule: dev-only surface for exercising internal services end-to-end
 * without UI or external integrations.
 *
 * FAIL-CLOSED opt-in: every endpoint 404s unless `ENABLE_DEV_ROUTES=true`
 * (see DevAiController.assertDevRoutesEnabled). Set that ONLY in a local `.env`.
 * The gate is checked at request time via ConfigService (which has loaded
 * `.env`), so it works locally and can't be tripped by a mis-set NODE_ENV.
 * Safe to leave registered — without the flag the routes are inert.
 */
@Module({
  imports: [PrismaModule, ChatModule, AiModule],
  controllers: [DevAiController],
})
export class DevModule {}
