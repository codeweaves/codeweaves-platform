import { InjectQueue } from '@nestjs/bullmq';
import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

import { Public } from '../../decorators/public.decorator';
import { SkipRateLimit } from '../../decorators/rate-limit.decorator';

import type {
  WhatsappInboundJob,
  WhatsappWebhookPayload,
} from './interfaces/whatsapp.interfaces';
import { WhatsappConfigService } from './whatsapp-config.service';
import {
  WHATSAPP_INBOUND_JOB,
  WHATSAPP_INBOUND_QUEUE,
} from './whatsapp.constants';

/**
 * Single public webhook for ALL orgs. Meta routes every inbound message here; the
 * payload's `phone_number_id` tells us which agent owns the number.
 *
 * @Public()        — no JWT (Meta is not a logged-in user)
 * @SkipRateLimit()  — Meta sends from a pool of IPs and can fire frequently; the
 *                     HMAC signature is the real auth gate, not IP rate limiting.
 *
 * Flow: verify X-Hub-Signature-256 on the RAW body → enqueue jobs → ACK 200.
 * We enqueue BEFORE acking so a crash can't drop a message (Redis add is ~1ms).
 */
@ApiTags('WhatsApp Webhook')
@Public()
@SkipRateLimit()
@Controller('public/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: WhatsappConfigService,
    @InjectQueue(WHATSAPP_INBOUND_QUEUE) private readonly queue: Queue,
  ) {}

  /** GET verification handshake — Meta calls this once when you register the webhook. */
  @Get('webhook')
  @ApiOperation({ summary: 'WhatsApp webhook verification handshake' })
  verify(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Response {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const verifyToken = this.config.verifyToken;

    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    this.logger.warn('WhatsApp webhook verification failed (token mismatch).');
    return res.status(403).send('Forbidden');
  }

  /** POST event notifications. */
  @Post('webhook')
  @ApiExcludeEndpoint()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<Response> {
    if (!this.config.isConfigured) {
      this.logger.error(
        'WhatsApp not configured (WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN missing).',
      );
      return res.status(503).send();
    }

    const raw = req.rawBody;
    if (!raw || !this.verifySignature(raw, req.headers['x-hub-signature-256'])) {
      this.logger.warn('WhatsApp webhook signature verification failed.');
      return res.status(401).send();
    }

    let payload: WhatsappWebhookPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as WhatsappWebhookPayload;
    } catch {
      // Unparseable — ACK 200 so Meta doesn't retry a body we can never accept.
      this.logger.warn('Unparseable WhatsApp webhook body.');
      return res.status(200).send();
    }

    const jobs = this.extractJobs(payload);
    await Promise.all(
      jobs.map((job) =>
        this.queue
          .add(WHATSAPP_INBOUND_JOB, job, {
            // jobId = wamid → BullMQ ignores duplicate adds, deduping Meta's
            // retried webhook deliveries.
            jobId: job.messageId,
            // No auto-retry: a retry after a partial success could double-send.
            attempts: 1,
            // Keep completed jobs ~1h so the jobId stays reserved (idempotency
            // window) without unbounded growth.
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400 },
          })
          .catch((err: unknown) =>
            this.logger.error(
              `Failed to enqueue WhatsApp job ${job.messageId}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          ),
      ),
    );

    return res.status(200).send();
  }

  /** Verify X-Hub-Signature-256: HMAC-SHA256(rawBody, appSecret), constant-time. */
  private verifySignature(raw: Buffer, header?: string | string[]): boolean {
    const appSecret = this.config.appSecret;
    if (!appSecret || !header || Array.isArray(header)) return false;
    const expected =
      'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(header);
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  /** Pull the inbound text messages out of the (nested) webhook envelope. */
  private extractJobs(payload: WhatsappWebhookPayload): WhatsappInboundJob[] {
    const jobs: WhatsappInboundJob[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId || !value.messages?.length) continue;
        const contactName = value.contacts?.[0]?.profile?.name;
        for (const msg of value.messages) {
          // Text and audio (voice notes) are handled. Images/documents/etc. are
          // ignored for now.
          if (msg.type === 'text' && msg.text?.body) {
            jobs.push({
              phoneNumberId,
              from: msg.from,
              messageId: msg.id,
              type: 'text',
              text: msg.text.body,
              contactName,
            });
          } else if (msg.type === 'audio' && msg.audio?.id) {
            jobs.push({
              phoneNumberId,
              from: msg.from,
              messageId: msg.id,
              type: 'audio',
              mediaId: msg.audio.id,
              contactName,
            });
          }
        }
      }
    }
    return jobs;
  }
}
