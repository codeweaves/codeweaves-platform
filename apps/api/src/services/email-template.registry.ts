/**
 * The variables each email template may use.
 *
 * This registry is the contract between the code that SENDS an email and the
 * SUPER_ADMIN who EDITS its copy in the dashboard:
 *
 *   - the editor renders these as clickable chips, so nobody has to remember or
 *     guess a variable name;
 *   - `sample` powers the live preview, so a template can be checked without
 *     triggering a real event;
 *   - any `{{placeholder}}` not listed here renders as an empty string (see
 *     EmailTemplateService), so a typo degrades to a blank rather than leaking
 *     a raw `{{foo}}` into a customer's inbox.
 *
 * Adding a template = add a key here + a seeded row in a migration + a caller.
 * The API deliberately exposes no create/delete, so this list and the DB rows
 * stay in lockstep.
 */
export const TEMPLATE_VARIABLES = {
  HANDOVER_REQUESTED: [
    { key: 'orgName', label: 'Organization name', sample: 'Acme Corp' },
    { key: 'agentName', label: 'Agent name', sample: 'Support Bot' },
    // Filled by NotificationService, not the producer. Links by notification id
    // (which grants nothing without a login) rather than by session id — see
    // NotificationService.deepLink for why that distinction matters.
    {
      key: 'conversationUrl',
      label: 'Link to the chat',
      sample: 'https://app.klivo.ai/dashboard/inbox?n=1f0c…',
    },
  ],
  TEAM_INVITATION: [
    { key: 'orgName', label: 'Organization name', sample: 'Acme Corp' },
    { key: 'actionUrl', label: 'Accept-invite link', sample: 'https://app.klivo.ai/signup?token=abc123' },
    { key: 'actionLabel', label: 'Button label', sample: 'Set Your Password' },
    { key: 'expiresIn', label: 'Expiry text', sample: '7 days' },
  ],
} as const;

export type EmailTemplateKey = keyof typeof TEMPLATE_VARIABLES;

export const EMAIL_TEMPLATE_KEYS = Object.keys(TEMPLATE_VARIABLES) as EmailTemplateKey[];

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_VARIABLES, value);
}

/** Variable descriptors for a key — safe to hand to the editor UI. */
export function templateVariables(
  key: EmailTemplateKey,
): ReadonlyArray<{ key: string; label: string; sample: string }> {
  return TEMPLATE_VARIABLES[key];
}

/** `{ orgName: 'Acme Corp', ... }` — used to render the editor preview. */
export function templateSampleVars(key: EmailTemplateKey): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARIABLES[key].map((v) => [v.key, v.sample]));
}
