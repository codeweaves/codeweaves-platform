import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { WhatsappInboundJob } from './interfaces/whatsapp.interfaces';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { WHATSAPP_INBOUND_QUEUE } from './whatsapp.constants';

/**
 * BullMQ worker for the `whatsapp-inbound` queue. Mirrors the conversation
 * classifier processor: zero logic, defers to WhatsappInboundService (which is
 * independently unit-tested).
 *
 * Jobs are enqueued with `jobId = wamid` and `attempts: 1` — see the webhook
 * controller for the idempotency rationale.
 */
@Processor(WHATSAPP_INBOUND_QUEUE)
export class WhatsappInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappInboundProcessor.name);

  constructor(private readonly inbound: WhatsappInboundService) {
    super();
  }

  async process(job: Job<WhatsappInboundJob>): Promise<void> {
    await this.inbound.handleInbound(job.data);
  }
}
