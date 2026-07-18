import { EventChannel } from '@prisma/client';

/**
 * Map a request URL to its EventChannel. Used by the HTTP auto-capture
 * interceptor + exception filter so every mutating request lands in the right
 * channel bucket. See docs/plans/observability-everywhere-plan.md §8.
 */
export function resolveChannel(url: string): EventChannel {
  // Match on the PUBLIC route prefix, not bare substrings — otherwise dashboard
  // routes like /agents/:id/whatsapp or /voices would be misbucketed as
  // WHATSAPP/VOICE. Internal is checked first so cron routes never fall through.
  if (url.includes('/internal/')) return 'INTERNAL';
  if (url.includes('/public/voice')) return 'VOICE';
  if (url.includes('/public/whatsapp') || url.includes('/whatsapp/webhook'))
    return 'WHATSAPP';
  if (url.includes('/public/chat') || url.includes('/public/agents')) return 'WIDGET';
  return 'DASHBOARD';
}

/**
 * Whether a mutating request on this channel gets an auto HTTP-envelope row.
 *
 * WIDGET / VOICE / WHATSAPP are EXCLUDED: they already emit dedicated channel
 * events (with char/byte counts), and their request bodies carry raw visitor
 * conversation text + repeat every turn — capturing the envelope too would
 * duplicate rows and store the full message text we deliberately keep out.
 * DASHBOARD (agent editor, CRUD) + INTERNAL (cron) have no dedicated events and
 * carry config/ids, so the envelope is where their audit trail lives.
 */
export function capturesHttpEnvelope(channel: EventChannel): boolean {
  return channel === 'DASHBOARD' || channel === 'INTERNAL';
}

/**
 * Pull agentId / organizationId into their DEDICATED columns ONLY when the route
 * is actually scoped to that entity. The agent-editor routes name the param
 * inconsistently (`:id` on /agents/:id, /agents/:id/theme, /agents/:id/files;
 * `:agentId` on /agents/:agentId/knowledge, /agents/:agentId/data-fields), so we
 * accept both — but we must NOT blindly take `params.id`, or `PATCH /organizations/:id`
 * would drop an org id into the agentId column. The route prefix decides the column.
 */
export function extractEntityIds(
  url: string,
  // Accepts Express's ParamsDictionary ({ [k]: string }) and looser shapes.
  params: Record<string, string | string[] | undefined> = {},
): { agentId?: string; organizationId?: string } {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const out: { agentId?: string; organizationId?: string } = {};
  if (url.includes('/agents/')) {
    out.agentId = first(params.agentId) ?? first(params.id);
  }
  if (url.includes('/organizations/')) {
    out.organizationId =
      first(params.organizationId) ?? first(params.orgId) ?? first(params.id);
  }
  return out;
}
