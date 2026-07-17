import { Injectable, Logger } from '@nestjs/common';

import { WhatsappConfigService } from './whatsapp-config.service';
import { ProviderEventLogger } from '../../common/events/provider.logger';

/** Mask a phone number for logs — keep only the last 4 digits. */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `***${phone.slice(-4)}`;
}

/**
 * Map a TTS-reported MIME type to one WhatsApp's /media endpoint accepts. Notably
 * providers report MP3 as "audio/mp3" but WhatsApp only accepts "audio/mpeg" (the
 * bytes are identical — it's purely a label). Accepted: audio/aac, audio/mp4,
 * audio/mpeg, audio/amr, audio/ogg, audio/opus. Anything else passes through (and
 * if WhatsApp rejects it, the caller falls back to a text reply).
 */
export function toWhatsappAudioMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio/mpeg';
  if (m.includes('opus')) return 'audio/ogg';
  if (m.includes('ogg')) return 'audio/ogg';
  if (m.includes('aac')) return 'audio/aac';
  if (m.includes('amr')) return 'audio/amr';
  if (m.includes('m4a') || m.includes('mp4')) return 'audio/mp4';
  return mimeType;
}

/** Pick a file extension for a media upload from its (WhatsApp) MIME type. */
function audioExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('amr')) return 'amr';
  return 'mp3';
}

/**
 * Thin Graph API client for outbound WhatsApp calls. Stateless: every method
 * takes the target number's `phoneNumberId` and a decrypted `accessToken`
 * (the caller owns decryption via CryptoService).
 *
 * Uses global fetch (Node 18+). All calls are short JSON POSTs to
 * `${graphBaseUrl}/${phoneNumberId}/messages`.
 */
@Injectable()
export class WhatsappSendService {
  private readonly logger = new Logger(WhatsappSendService.name);

  constructor(
    private readonly config: WhatsappConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {}

  /**
   * Send a plain text message. Returns the sent message's wamid, or null if the
   * response didn't include one. Throws on a non-2xx response so the worker can
   * decide how to handle failure.
   */
  async sendText(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    body: string,
  ): Promise<string | null> {
    return this.providerLog.traced(
      {
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP',
        eventBase: 'META_WHATSAPP_SEND_TEXT',
        visitorId: maskPhone(to),
        requestUrl: `${this.config.graphBaseUrl}/${phoneNumberId}/messages`,
        requestPayload: { to: maskPhone(to), type: 'text', bodyChars: body.length },
        extract: (wamid: string | null) => ({ responsePayload: { wamid } }),
      },
      async () => {
        const res = await fetch(`${this.config.graphBaseUrl}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body },
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          this.logger.error(
            `sendText failed (${res.status}) to ${maskPhone(to)} via ${phoneNumberId}: ${errBody}`,
          );
          throw new Error(`WhatsApp sendText failed: ${res.status}`);
        }

        const json = (await res.json().catch(() => null)) as {
          messages?: Array<{ id: string }>;
        } | null;
        return json?.messages?.[0]?.id ?? null;
      },
    );
  }

  /**
   * Upload an audio clip to WhatsApp and return its media id (for sending back as a
   * voice reply). Multipart POST to the /media endpoint; the Bearer token authorizes
   * it and fetch sets the multipart boundary itself (so we don't set Content-Type).
   */
  async uploadMedia(
    phoneNumberId: string,
    accessToken: string,
    data: Buffer,
    mimeType: string,
  ): Promise<string> {
    // Normalize the MIME to one WhatsApp accepts (e.g. audio/mp3 -> audio/mpeg).
    const mime = toWhatsappAudioMime(mimeType);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append(
      'file',
      // Wrap in Uint8Array: Node's Buffer isn't directly a DOM BlobPart in TS's
      // lib types, but a Uint8Array view over the same bytes is.
      new Blob([new Uint8Array(data)], { type: mime }),
      `audio.${audioExtension(mime)}`,
    );

    const res = await fetch(`${this.config.graphBaseUrl}/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.logger.error(`media upload failed (${res.status}): ${errBody}`);
      throw new Error(`WhatsApp media upload failed: ${res.status}`);
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!json?.id) throw new Error('WhatsApp media upload returned no id');
    return json.id;
  }

  /** Send a previously-uploaded audio clip as a voice message. Returns the wamid. */
  async sendAudio(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    mediaId: string,
  ): Promise<string | null> {
    return this.providerLog.traced(
      {
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP',
        eventBase: 'META_WHATSAPP_SEND_AUDIO',
        visitorId: maskPhone(to),
        requestUrl: `${this.config.graphBaseUrl}/${phoneNumberId}/messages`,
        requestPayload: { to: maskPhone(to), type: 'audio', mediaId },
        extract: (wamid: string | null) => ({ responsePayload: { wamid } }),
      },
      async () => {
        const res = await fetch(`${this.config.graphBaseUrl}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'audio',
            audio: { id: mediaId },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          this.logger.error(
            `sendAudio failed (${res.status}) to ${maskPhone(to)}: ${errBody}`,
          );
          throw new Error(`WhatsApp sendAudio failed: ${res.status}`);
        }
        const json = (await res.json().catch(() => null)) as {
          messages?: Array<{ id: string }>;
        } | null;
        return json?.messages?.[0]?.id ?? null;
      },
    );
  }

  /**
   * Download inbound media (e.g. a voice note) by its WhatsApp media id. Two-step:
   * (1) GET the media object to obtain a short-lived binary URL, (2) GET that URL —
   * both authenticated with the Bearer token (the binary lives on a Meta lookaside
   * host that still requires the token). Returns the raw bytes + reported MIME type.
   */
  async downloadMedia(
    mediaId: string,
    accessToken: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const metaRes = await fetch(`${this.config.graphBaseUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      const errBody = await metaRes.text().catch(() => '');
      this.logger.error(`media lookup failed (${metaRes.status}) for ${mediaId}: ${errBody}`);
      throw new Error(`WhatsApp media lookup failed: ${metaRes.status}`);
    }
    const meta = (await metaRes.json().catch(() => null)) as {
      url?: string;
      mime_type?: string;
    } | null;
    if (!meta?.url) {
      throw new Error('WhatsApp media lookup returned no URL');
    }

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!binRes.ok) {
      const errBody = await binRes.text().catch(() => '');
      this.logger.error(`media download failed (${binRes.status}) for ${mediaId}: ${errBody}`);
      throw new Error(`WhatsApp media download failed: ${binRes.status}`);
    }
    const bytes = Buffer.from(await binRes.arrayBuffer());
    return { buffer: bytes, mimeType: meta.mime_type ?? 'audio/ogg' };
  }

  /**
   * Mark the inbound message as read and show a "typing…" indicator. This is the
   * closest thing WhatsApp has to streaming: it tells the user we're preparing a
   * reply (lasts up to 25s or until we send). Best-effort — failures are logged
   * and swallowed, never blocking the actual reply.
   */
  async markReadAndShowTyping(
    phoneNumberId: string,
    accessToken: string,
    messageId: string,
  ): Promise<void> {
    try {
      const res = await fetch(`${this.config.graphBaseUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: { type: 'text' },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        this.logger.warn(
          `markReadAndShowTyping non-2xx (${res.status}) for ${messageId}: ${errBody}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `markReadAndShowTyping failed for ${messageId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
