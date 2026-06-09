/**
 * WhatsApp channel constants.
 *
 * The Cloud API integration is webhook-driven and async: Meta POSTs inbound
 * messages to a single webhook, we ACK fast and enqueue, a BullMQ worker runs the
 * agent and sends the reply. See docs/plans/whatsapp-integration-plan.md.
 */

/** BullMQ queue that buffers inbound WhatsApp messages for async processing. */
export const WHATSAPP_INBOUND_QUEUE = 'whatsapp-inbound';

/** Job name for a single inbound text message. */
export const WHATSAPP_INBOUND_JOB = 'process-inbound-message';

/**
 * Default Graph API version. Overridable via WHATSAPP_GRAPH_API_VERSION so we can
 * bump it without a code change when Meta deprecates a version.
 */
export const DEFAULT_GRAPH_API_VERSION = 'v21.0';

/** Graph API host (version is appended). */
export const GRAPH_API_HOST = 'https://graph.facebook.com';
