import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

import { Public } from '../../decorators/public.decorator';
import { AppLogger } from '../../common/logger/app-logger';
import { WhatsappEventLogger } from '../../common/events/whatsapp.logger';

import type {
  WhatsappInboundJob,
  WhatsappWebhookPayload,
} from './interfaces/whatsapp.interfaces';
import { WhatsappConfigService } from './whatsapp-config.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';

/**
 * Single public webhook for ALL orgs. Meta routes every inbound message here; the
 * payload's `phone_number_id` tells us which agent owns the number.
 *
 * @Public()  — no JWT (Meta is not a logged-in user). Rate limiting is opt-in,
 *              and we deliberately do NOT add @RateLimit() here: Meta sends from
 *              a pool of IPs and the HMAC signature is the real auth gate.
 *
 * Flow: verify X-Hub-Signature-256 on the RAW body → ACK 200 immediately →
 * process inline in the background. We ACK first (before processing) so Meta
 * gets its fast 200 and never retries — which is what keeps duplicate
 * deliveries away now that there's no BullMQ jobId to dedupe on. A short
 * in-memory ring of seen message ids guards against the rare genuine duplicate
 * within this instance. No Redis, no queue.
 */
@ApiTags('WhatsApp Webhook')
@Public()
@Controller('public/whatsapp')
export class WhatsappWebhookController {
  private readonly log = new AppLogger(WhatsappWebhookController.name);

  /**
   * Recently-processed inbound message ids (wamid), for best-effort dedup of
   * the rare duplicate webhook delivery. Per-instance only — acceptable because
   * fast ACK already prevents Meta retries; if true cross-instance dedup is ever
   * needed, add a unique index on the inbound message id at persistence time.
   */
  private readonly seenMessageIds = new Set<string>();
  private static readonly SEEN_CAP = 1000;

  constructor(
    private readonly config: WhatsappConfigService,
    private readonly inbound: WhatsappInboundService,
    private readonly whatsappLog: WhatsappEventLogger,
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
      // Semantic event: Meta successfully verified the webhook. Fire-and-forget.
      this.whatsappLog.logWebhookVerified();
      this.log.info('verify', 'webhook verification succeeded');
      return res.status(200).send(challenge);
    }
    this.log.warn('verify', 'webhook verification failed (token mismatch)');
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
      this.log.error(
        'receive',
        'WhatsApp not configured (WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN missing)',
      );
      this.whatsappLog.logWebhookRejected('not_configured');
      return res.status(503).send();
    }

    const raw = req.rawBody;
    if (!raw || !this.verifySignature(raw, req.headers['x-hub-signature-256'])) {
      this.log.warn('receive', 'signature verification failed');
      this.whatsappLog.logWebhookRejected('signature_verification_failed');
      return res.status(401).send();
    }

    let payload: WhatsappWebhookPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as WhatsappWebhookPayload;
    } catch {
      // Unparseable — ACK 200 so Meta doesn't retry a body we can never accept.
      this.log.warn('receive', 'unparseable webhook body');
      this.whatsappLog.logWebhookRejected('unparseable_body');
      return res.status(200).send();
    }

    const jobs = this.extractJobs(payload);

    // ACK Meta immediately, BEFORE processing. A fast 200 stops Meta retrying,
    // which is what prevents duplicate deliveries now that there's no queue.
    res.status(200).send();

    // Process each message inline in the background — the response is already
    // sent, so nothing here adds webhook latency. Errors are swallowed-and-logged
    // (WhatsappInboundService already best-effort replies to the user on failure).
    for (const job of jobs) {
      if (!this.markSeen(job.messageId)) {
        this.log.debug('receive', 'duplicate WhatsApp delivery — skipping', {
          messageId: job.messageId,
        });
        continue;
      }
      void this.inbound.handleInbound(job).catch((err: unknown) =>
        this.log.error(
          'receive',
          'inbound processing failed',
          err,
          { messageId: job.messageId },
        ),
      );
    }

    return res;
  }

  /**
   * Best-effort dedup: returns `true` the first time a message id is seen (i.e.
   * "process it"), `false` for a repeat. Bounded so the Set can't grow without
   * limit — when full, we drop the oldest half (insertion-ordered).
   */
  private markSeen(messageId: string): boolean {
    if (this.seenMessageIds.has(messageId)) return false;
    this.seenMessageIds.add(messageId);
    if (this.seenMessageIds.size > WhatsappWebhookController.SEEN_CAP) {
      const iterator = this.seenMessageIds.values();
      const toDrop = Math.floor(WhatsappWebhookController.SEEN_CAP / 2);
      for (let i = 0; i < toDrop; i++) {
        const oldest = iterator.next().value;
        if (oldest !== undefined) this.seenMessageIds.delete(oldest);
      }
    }
    return true;
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
