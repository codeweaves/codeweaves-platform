export type ChatSourceLike = 'WIDGET' | 'WHATSAPP' | 'DEMO' | string;

/**
 * How to label a visitor in the Inbox and Conversations lists.
 *
 * `ChatSession.visitorId` means two different things depending on the channel,
 * which is easy to get wrong (and was):
 *
 *  - WIDGET / DEMO / VOICE → a hashed IP (`vh_…`, see CryptoService.hashVisitorIp).
 *    Unreadable, not an identifier anyone can act on, so it is not shown.
 *  - WHATSAPP → the customer's actual phone number. That IS useful: it's who
 *    you're talking to, it's what the outbound reply is addressed to
 *    (HandoverService passes it straight to WhatsappOutboundService), and it's
 *    the value an operator needs for the DPDP access/erasure endpoints
 *    (`/privacy/visitors/:visitorId`). See PurgeService's doc comment, which
 *    states the same split.
 *
 * So: show the phone, hide the hash.
 */
export function visitorLabel(
  source: ChatSourceLike | null | undefined,
  visitorId: string | null | undefined,
): string {
  if (source === 'WHATSAPP' && visitorId?.trim()) return visitorId.trim();
  return 'Visitor';
}
