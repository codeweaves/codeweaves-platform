/**
 * Typed shapes for the WhatsApp Cloud API webhook payload (only the fields we
 * consume) and the inbound job we enqueue. Full payload reference:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */

/** A single inbound message as Meta delivers it. */
export interface WhatsappInboundMessage {
  /** Sender's phone number in E.164 without '+', e.g. "15550101234". */
  from: string;
  /** Globally-unique message id ("wamid..."). Used as the idempotency key. */
  id: string;
  /** Unix seconds (string). */
  timestamp: string;
  /** "text" | "audio" | "image" | "document" | "interactive" | ... */
  type: string;
  /** Present when type === "text". */
  text?: { body: string };
  /** Present when type === "audio" (voice notes have voice:true). */
  audio?: { id: string; mime_type?: string; voice?: boolean };
}

/** The `value` object inside a `messages` change. */
export interface WhatsappWebhookValue {
  messaging_product: 'whatsapp';
  metadata: {
    display_phone_number: string;
    /** The number that received the message — our routing key to an agent. */
    phone_number_id: string;
  };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: WhatsappInboundMessage[];
  /** Delivery/read receipts — ignored in the MVP (no schema change needed). */
  statuses?: unknown[];
}

/** Top-level webhook envelope. */
export interface WhatsappWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{ field: string; value: WhatsappWebhookValue }>;
  }>;
}

/**
 * Payload enqueued for the inbound worker — one job per inbound text message.
 * Deliberately flat + minimal so the queue stays cheap and the worker self-contained.
 */
export interface WhatsappInboundJob {
  /** Routing key → resolves the owning agent's WhatsappChannel. */
  phoneNumberId: string;
  /** Customer phone (E.164, no '+') — becomes the session visitorId + reply target. */
  from: string;
  /** WhatsApp message id — also used as the BullMQ jobId for idempotency. */
  messageId: string;
  /** Inbound kind. 'audio' = a voice note / audio file we transcribe before running the agent. */
  type: 'text' | 'audio';
  /** The user's text — present when type === 'text'. */
  text?: string;
  /** WhatsApp media id — present when type === 'audio'; downloaded + transcribed. */
  mediaId?: string;
  /** Display name from the contact profile, if Meta provided one. */
  contactName?: string;
}
