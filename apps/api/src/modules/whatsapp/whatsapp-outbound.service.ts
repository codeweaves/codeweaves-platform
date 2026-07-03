import { Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../services/prisma.service';
import { WhatsappSendService } from './whatsapp-send.service';

/**
 * Delivers a human teammate's handover reply OUT to a WhatsApp visitor's phone,
 * reusing the exact Graph API sender the bot already uses (WhatsappSendService).
 *
 * Lives in the leaf WhatsappSendModule (no ChatModule/HandoverModule deps) so
 * HandoverService can call it without the dependency cycle
 * (handover → whatsapp → chat → handover).
 *
 * Best-effort by design: a delivery failure must NEVER break the dashboard
 * reply — that's already persisted and shown to the agent. (Widget + voice
 * need no equivalent: those visitors receive the human's reply via the widget
 * poll, since voice runs inside the widget.)
 */
@Injectable()
export class WhatsappOutboundService {
  private readonly logger = new Logger(WhatsappOutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly send: WhatsappSendService,
  ) {}

  /**
   * @param agentId  the session's agent (resolves the WhatsApp channel + creds)
   * @param toPhone  the visitor's WhatsApp number (= session.visitorId for WA)
   * @param text     the human's plain-text reply (sent verbatim)
   */
  async deliverHumanReply(
    agentId: string,
    toPhone: string,
    text: string,
  ): Promise<void> {
    try {
      const channel = await this.prisma.whatsappChannel.findFirst({
        where: { agentId, status: 'CONNECTED' },
      });
      if (!channel) {
        this.logger.warn(
          `No connected WhatsApp channel for agent ${agentId} — human reply not delivered.`,
        );
        return;
      }
      const accessToken = this.crypto.decrypt(channel.accessTokenEnc);
      await this.send.sendText(channel.phoneNumberId, accessToken, toPhone, text);
    } catch (err) {
      this.logger.warn(
        `WhatsApp human-reply delivery failed (agent=${agentId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
