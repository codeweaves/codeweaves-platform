/**
 * WhatsApp channel constants.
 *
 * The Cloud API integration is webhook-driven: Meta POSTs inbound messages to a
 * single webhook, we ACK fast and run the agent INLINE in the background (no
 * queue/Redis), then send the reply. See docs/plans/whatsapp-integration-plan.md.
 */

/**
 * Default Graph API version. Overridable via WHATSAPP_GRAPH_API_VERSION so we can
 * bump it without a code change when Meta deprecates a version.
 */
export const DEFAULT_GRAPH_API_VERSION = 'v21.0';

/** Graph API host (version is appended). */
export const GRAPH_API_HOST = 'https://graph.facebook.com';
