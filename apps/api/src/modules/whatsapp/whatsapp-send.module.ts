import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma.module';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappOutboundService } from './whatsapp-outbound.service';
import { WhatsappSendService } from './whatsapp-send.service';

/**
 * Leaf module for outbound WhatsApp delivery: the thin Graph API client
 * (WhatsappSendService) + its env config + a small orchestrator that delivers
 * a human-handover reply to a visitor's phone (WhatsappOutboundService).
 *
 * Deliberately depends ONLY on PrismaModule (+ the global CryptoService) — NOT
 * on ChatModule or HandoverModule. That's what lets BOTH the WhatsApp channel
 * (WhatsappModule, inbound) AND HandoverModule import it without recreating the
 * dependency cycle (handover → whatsapp → chat → handover).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    WhatsappConfigService,
    WhatsappSendService,
    WhatsappOutboundService,
  ],
  exports: [
    WhatsappConfigService,
    WhatsappSendService,
    WhatsappOutboundService,
  ],
})
export class WhatsappSendModule {}
