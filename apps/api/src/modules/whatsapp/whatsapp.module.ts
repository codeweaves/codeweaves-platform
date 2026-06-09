import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AgentsModule } from '../agents.module';
import { AiModule } from '../ai/ai.module';
import { ChatModule } from '../chat.module';
import { PrismaModule } from '../prisma.module';
import { VoiceModule } from '../voice/voice.module';

import { WhatsappChannelController } from './whatsapp-channel.controller';
import { WhatsappChannelService } from './whatsapp-channel.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappInboundProcessor } from './whatsapp-inbound.processor';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WhatsappSendService } from './whatsapp-send.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WHATSAPP_INBOUND_QUEUE } from './whatsapp.constants';

/**
 * WhatsApp channel: a second front-end onto the same agents the widget serves.
 * Inbound is webhook-driven + queue-backed (BullMQ on the shared Redis, root
 * config registered globally by ConversationClassifierModule).
 *
 * Imports:
 *   ChatModule  → ChatService (sessions + message persistence)
 *   AgentsModule→ AgentsService (org-scoped authorization for the dashboard)
 *   AiModule    → DirectChatService (the buffered LLM turn)
 * CryptoService (token encryption) and RbacService (RolesGuard) are global.
 */
@Module({
  imports: [
    PrismaModule,
    ChatModule,
    AgentsModule,
    AiModule,
    VoiceModule, // VoiceService — transcribes inbound voice notes
    BullModule.registerQueue({ name: WHATSAPP_INBOUND_QUEUE }),
  ],
  controllers: [WhatsappWebhookController, WhatsappChannelController],
  providers: [
    WhatsappConfigService,
    WhatsappSendService,
    WhatsappChannelService,
    WhatsappInboundService,
    WhatsappInboundProcessor,
  ],
})
export class WhatsappModule {}
