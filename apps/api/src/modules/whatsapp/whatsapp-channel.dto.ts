import { z } from 'zod';

/**
 * Payload to connect (or re-connect) a WhatsApp number to an agent.
 *
 * MVP = manual config: the operator pastes the WABA id, phone-number id, and an
 * access token obtained from the Meta dashboard. When Embedded Signup lands, this
 * same endpoint will be fed by the OAuth token exchange instead of a human form.
 */
export const connectWhatsappChannelSchema = z.object({
  /** WhatsApp Business Account id that owns the number. */
  wabaId: z.string().trim().min(1).max(64),
  /** Meta's phone-number id — the webhook routing key. */
  phoneNumberId: z.string().trim().min(1).max(64),
  /** Human-readable number for the dashboard, e.g. "+1 555 010 1234". */
  displayPhone: z.string().trim().min(1).max(32),
  /** Graph API access token — stored encrypted, never returned. */
  accessToken: z.string().trim().min(1).max(1024),
  /** Optional business display name Meta shows to end users. */
  verifiedName: z.string().trim().max(128).optional(),
  /** Optional ISO-8601 token expiry (Embedded Signup tokens are ~60-day). */
  tokenExpiresAt: z.string().datetime().optional(),
  /** Reply to inbound voice notes with a voice note (TTS). Default off. */
  voiceReplyEnabled: z.boolean().optional(),
});

export type ConnectWhatsappChannelDto = z.infer<
  typeof connectWhatsappChannelSchema
>;

/** Patch mutable channel settings (post-connect) — e.g. the voice-reply toggle. */
export const updateWhatsappChannelSchema = z.object({
  voiceReplyEnabled: z.boolean(),
});

export type UpdateWhatsappChannelDto = z.infer<
  typeof updateWhatsappChannelSchema
>;

/** Channel shape returned to the dashboard — never includes the token. */
export interface WhatsappChannelView {
  id: string;
  agentId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string | null;
  status: string;
  voiceReplyEnabled: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
