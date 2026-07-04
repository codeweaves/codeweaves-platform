/**
 * Validation schemas for per-agent third-party integrations (agentic tools the
 * LLM can call mid-conversation). See `AgentIntegration` in the Prisma schema.
 *
 * Deliberately NOT a generic connector platform: each provider is a concrete,
 * first-class integration with its own credential shape and fixed API host.
 * Adding a provider = one new entry here + one provider class in
 * `apps/api/src/modules/integrations/providers/`.
 */
import { z } from 'zod';

// ============================================
// Providers
// ============================================

export const integrationProviderEnum = z.enum(['hubspot', 'slack']);
export type IntegrationProvider = z.infer<typeof integrationProviderEnum>;

// ============================================
// Per-provider credential schemas
// ============================================

/**
 * HubSpot: authenticated with a Private App access token (`pat-...`).
 * Created by the customer in HubSpot → Settings → Integrations → Private Apps
 * with the `crm.objects.contacts.read` + `crm.objects.contacts.write` scopes.
 * Private-app tokens do not expire, so no refresh machinery is needed —
 * this is the deliberate trade-off vs full OAuth (see integrations plan).
 */
export const hubspotCredentialsSchema = z.object({
  accessToken: z
    .string()
    .trim()
    .min(10, 'HubSpot access token is required')
    .max(512),
});

/**
 * Slack: an Incoming Webhook URL scoped to one channel. No token refresh, no
 * OAuth app review — the customer pastes the URL from Slack's app directory.
 * Host is pinned to hooks.slack.com so this can never be pointed elsewhere.
 */
export const slackCredentialsSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(512)
    .refine(
      (u) => {
        try {
          return new URL(u).hostname === 'hooks.slack.com';
        } catch {
          return false;
        }
      },
      'Must be a Slack incoming webhook URL (https://hooks.slack.com/...)',
    ),
});

export const integrationCredentialsSchemas = {
  hubspot: hubspotCredentialsSchema,
  slack: slackCredentialsSchema,
} as const;

// ============================================
// Connect / update
// ============================================

/**
 * Schema for PUT /agents/:agentId/integrations/:provider — connect or update.
 * `credentials` is validated against the provider-specific schema in the
 * service (Zod discriminated validation at the route level would leak which
 * fields exist per provider into a single mega-schema; keep them separate).
 */
export const upsertIntegrationSchema = z.object({
  credentials: z.record(z.string(), z.unknown()),
  enabled: z.boolean().default(true),
  /** Non-secret provider options (e.g. future: HubSpot pipeline ID). */
  config: z.record(z.string(), z.unknown()).optional(),
});

export type UpsertIntegrationDto = z.infer<typeof upsertIntegrationSchema>;

// ============================================
// Response shape — credentials are NEVER returned, only a masked hint
// ============================================

export const agentIntegrationResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  provider: integrationProviderEnum,
  enabled: z.boolean(),
  /** e.g. "pat-…4f2a" or "hooks.slack.com/…/T0XX" — safe to display. */
  credentialHint: z.string(),
  status: z.enum(['connected', 'error']),
  lastTestedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AgentIntegrationResponse = z.infer<
  typeof agentIntegrationResponseSchema
>;
