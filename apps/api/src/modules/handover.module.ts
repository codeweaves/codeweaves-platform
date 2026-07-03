import { Module } from '@nestjs/common';
import { HandoverService } from '../services/handover.service';
import { RealtimeService } from '../services/realtime.service';
import { HandoverController } from '../controllers/handover/handover.controller';
import { HandoverSweepController } from '../controllers/internal/handover-sweep.controller';
import { HandoverGateway } from '../gateways/handover.gateway';
import { PrismaModule } from './prisma.module';
import { WhatsappSendModule } from './whatsapp/whatsapp-send.module';

/**
 * Live human-handover: the authenticated Inbox controller + the service that
 * runs the state machine and triggers, plus the Realtime publisher. Exports
 * HandoverService so the public chat path (ChatModule) can run the AI-pause /
 * keyword-trigger / stall hooks on the hot path.
 */
@Module({
  imports: [PrismaModule, WhatsappSendModule],
  controllers: [HandoverController, HandoverSweepController],
  providers: [HandoverService, RealtimeService, HandoverGateway],
  exports: [HandoverService, RealtimeService],
})
export class HandoverModule {}
