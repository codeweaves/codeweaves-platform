import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents.module';
import { AiModule } from '../ai/ai.module';
import { ChatModule } from '../chat.module';
import { PrismaModule } from '../prisma.module';
import { VoiceModule } from '../voice/voice.module';

import { WhatsappChannelController } from './whatsapp-channel.controller';
import { WhatsappChannelService } from './whatsapp-channel.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappSendService } from './whatsapp-send.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

/**
 * WhatsApp channel: a second front-end onto the same agents the widget serves.
 * Inbound is webhook-driven and processed INLINE — no BullMQ, no Redis. The
 * webhook ACKs Meta immediately, then runs the agent in the background (see
 * WhatsappWebhookController). We dropped the queue because its worker polled
 * Redis around the clock even when idle. See docs/plans/redis-usage-reduction.md.
 *
 * Imports:
 *   ChatModule  → ChatService (sessions + message persistence)
 *   AgentsModule→ AgentsService (org-scoped authorization for the dashboard)
 *   AiModule    → DirectChatService (the buffered LLM turn)
 *   VoiceModule → VoiceService (transcribes inbound voice notes)
 * CryptoService (token encryption) and RbacService (RolesGuard) are global.
 */
@Module({
  imports: [PrismaModule, ChatModule, AgentsModule, AiModule, VoiceModule],
  controllers: [WhatsappWebhookController, WhatsappChannelController],
  providers: [
    WhatsappConfigService,
    WhatsappSendService,
    WhatsappChannelService,
    WhatsappInboundService,
  ],
})
export class WhatsappModule {}
