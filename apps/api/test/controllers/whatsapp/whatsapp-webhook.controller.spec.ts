import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';

import type { WhatsappConfigService } from '../../../src/modules/whatsapp/whatsapp-config.service';
import type { WhatsappInboundService } from '../../../src/modules/whatsapp/whatsapp-inbound.service';
import { WhatsappWebhookController } from '../../../src/modules/whatsapp/whatsapp-webhook.controller';

const APP_SECRET = 'app-secret';
const VERIFY_TOKEN = 'verify-token';

/** Build a chainable res mock: res.status(n).send(x). */
function makeRes() {
  const send = jest.fn().mockReturnValue('RES');
  const status = jest.fn().mockReturnValue({ send });
  return { res: { status } as unknown as Response, status, send };
}

function signedReq(payload: unknown, secret = APP_SECRET): Request {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return {
    rawBody: raw,
    headers: { 'x-hub-signature-256': sig },
  } as unknown as Request;
}

/** Flush microtasks so fire-and-forget handleInbound() calls settle. */
const flush = () => new Promise((r) => setImmediate(r));

function buildPayload(messageId = 'wamid.in') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+1', phone_number_id: 'PNID' },
              contacts: [{ profile: { name: 'Jane' }, wa_id: '15551234567' }],
              messages: [
                {
                  from: '15551234567',
                  id: messageId,
                  timestamp: '1',
                  type: 'text',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsappWebhookController', () => {
  let config: { isConfigured: boolean; appSecret: string; verifyToken: string };
  let inbound: { handleInbound: jest.Mock };
  let controller: WhatsappWebhookController;

  beforeEach(() => {
    config = {
      isConfigured: true,
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
    };
    inbound = { handleInbound: jest.fn().mockResolvedValue(undefined) };
    controller = new WhatsappWebhookController(
      config as unknown as WhatsappConfigService,
      inbound as unknown as WhatsappInboundService,
    );
  });

  describe('verify (GET handshake)', () => {
    it('echoes the challenge when the token matches', () => {
      const { res, status, send } = makeRes();
      controller.verify(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': 'CHALLENGE',
        },
        res,
      );
      expect(status).toHaveBeenCalledWith(200);
      expect(send).toHaveBeenCalledWith('CHALLENGE');
    });

    it('returns 403 when the token does not match', () => {
      const { res, status } = makeRes();
      controller.verify(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': 'CHALLENGE',
        },
        res,
      );
      expect(status).toHaveBeenCalledWith(403);
    });
  });

  describe('receive (POST events)', () => {
    it('acks 200 then processes text messages inline on a valid signature', async () => {
      const { res, status } = makeRes();
      await controller.receive(signedReq(buildPayload()), res);
      await flush();

      // ACK happens before/independent of processing.
      expect(status).toHaveBeenCalledWith(200);
      expect(inbound.handleInbound).toHaveBeenCalledTimes(1);
      expect(inbound.handleInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumberId: 'PNID',
          from: '15551234567',
          messageId: 'wamid.in',
          type: 'text',
          text: 'hello',
          contactName: 'Jane',
        }),
      );
    });

    it('returns 401 and processes nothing on a bad signature', async () => {
      const { res, status } = makeRes();
      await controller.receive(signedReq(buildPayload(), 'wrong-secret'), res);
      await flush();

      expect(status).toHaveBeenCalledWith(401);
      expect(inbound.handleInbound).not.toHaveBeenCalled();
    });

    it('returns 503 when WhatsApp is not configured', async () => {
      config.isConfigured = false;
      const { res, status } = makeRes();
      await controller.receive(signedReq(buildPayload()), res);
      await flush();

      expect(status).toHaveBeenCalledWith(503);
      expect(inbound.handleInbound).not.toHaveBeenCalled();
    });

    it('processes voice notes (audio) as an audio job', async () => {
      const audio = JSON.parse(JSON.stringify(buildPayload()));
      audio.entry[0].changes[0].value.messages[0] = {
        from: '15551234567',
        id: 'wamid.audio',
        timestamp: '1',
        type: 'audio',
        audio: { id: 'media-id', mime_type: 'audio/ogg', voice: true },
      };
      const { res, status } = makeRes();
      await controller.receive(signedReq(audio), res);
      await flush();

      expect(inbound.handleInbound).toHaveBeenCalledTimes(1);
      expect(inbound.handleInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'audio',
          mediaId: 'media-id',
          messageId: 'wamid.audio',
        }),
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it('ignores unsupported types (e.g. image) but still acks 200', async () => {
      const image = JSON.parse(JSON.stringify(buildPayload()));
      image.entry[0].changes[0].value.messages[0] = {
        from: '15551234567',
        id: 'wamid.img',
        timestamp: '1',
        type: 'image',
        image: { id: 'media-id' },
      };
      const { res, status } = makeRes();
      await controller.receive(signedReq(image), res);
      await flush();

      expect(inbound.handleInbound).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it('acks 200 (no retry storm) on an unparseable body with a valid signature', async () => {
      const raw = Buffer.from('not json');
      const sig =
        'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
      const req = {
        rawBody: raw,
        headers: { 'x-hub-signature-256': sig },
      } as unknown as Request;

      const { res, status } = makeRes();
      await controller.receive(req, res);
      await flush();

      expect(status).toHaveBeenCalledWith(200);
      expect(inbound.handleInbound).not.toHaveBeenCalled();
    });

    it('dedupes a duplicate delivery of the same message id', async () => {
      await controller.receive(signedReq(buildPayload('wamid.dup')), makeRes().res);
      await flush();
      await controller.receive(signedReq(buildPayload('wamid.dup')), makeRes().res);
      await flush();

      // Same wamid twice → handled once (in-memory dedup).
      expect(inbound.handleInbound).toHaveBeenCalledTimes(1);
    });
  });
});
