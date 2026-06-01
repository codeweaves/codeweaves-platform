import { Injectable } from '@nestjs/common';
import type { Agent } from '@prisma/client';

/**
 * Template context available for `{{variable}}` resolution in agent system
 * prompts. All fields are optional — unresolved variables are left as-is
 * in the output (safe default — no broken `{{...}}` literals leak to users
 * because the caller curates what's supplied).
 */
export interface PromptTemplateContext {
  agent?: Agent;
  organization?: { name?: string | null };
  /** Number of messages in the current session (for `{{conversation.messageCount}}`). */
  messageCount?: number;
  /** Detected or configured conversation language (for `{{language}}`). */
  language?: string;
  /**
   * Previous conversation summary (for `{{conversation.summary}}`). Useful
   * when an agent's prompt wants to reference summary content explicitly
   * instead of relying on HybridContextStrategy's automatic prepend.
   */
  summary?: string;
}

/**
 * PromptTemplateService: resolve `{{variable}}` placeholders in agent system
 * prompts at runtime.
 *
 * Supported variables (strings are case-insensitive on the variable path):
 *   {{date}}                         e.g. "2026-04-18"
 *   {{time}}                         e.g. "15:30 UTC"
 *   {{datetime}}                     e.g. "2026-04-18T15:30:00Z"
 *   {{agent.name}}                   Agent's display name
 *   {{agent.id}}                     Agent's UUID
 *   {{organization.name}}            Agent's org name
 *   {{conversation.messageCount}}    Messages in the current session
 *   {{conversation.summary}}         Summary of earlier conversation (if any)
 *   {{language}}                     Detected/configured conversation language
 *
 * Design choices:
 *   - Simple regex + lookup table. No eval, no injection surface.
 *   - Unresolved variables pass through untouched. This is safer than
 *     throwing (a deployment with an outdated prompt shouldn't break the
 *     agent) and also catches typos visibly: operators see `{{dat}}` in the
 *     output and fix the typo.
 *   - No user-supplied variables — the context is constructed by the
 *     orchestrator from trusted sources. No way for a chat user to inject
 *     `{{admin_only_var}}` into anything.
 *
 * NOT responsible for:
 *   - Escaping user content. System prompts are authored by operators, not
 *     end users, so traditional injection-escaping doesn't apply.
 *   - i18n / locale-specific date formats. If agents care about presentation,
 *     they supply their own preferred format in the prompt.
 */
@Injectable()
export class PromptTemplateService {
  /**
   * Resolve all supported `{{variable}}` placeholders in the template string.
   * If the template has no placeholders, returns the input unchanged (cheap
   * no-op path for prompts that don't use templating).
   */
  resolve(template: string, context: PromptTemplateContext = {}): string {
    if (!template || !template.includes('{{')) return template;

    const values = this.buildValueMap(context);

    // Match `{{variable}}` where variable is [a-z0-9._]+ (case-insensitive).
    // The spaces around the name are optional: `{{ date }}` also works.
    return template.replace(
      /\{\{\s*([a-z0-9._]+)\s*\}\}/gi,
      (match, name: string) => {
        const key = name.toLowerCase();
        const resolved = values.get(key);
        return resolved !== undefined ? resolved : match;
      },
    );
  }

  /**
   * Build the lookup map. Done once per resolve() call rather than on each
   * regex replacement so repeated placeholders don't re-compute the same
   * timestamp (consistency: {{time}} appearing twice shows the same value).
   */
  private buildValueMap(ctx: PromptTemplateContext): Map<string, string> {
    const now = new Date();
    const values = new Map<string, string>();

    // Date / time — UTC so everyone sees the same clock regardless of
    // server timezone. Agents can explicitly offset in their prompt if needed.
    values.set('date', now.toISOString().slice(0, 10)); // YYYY-MM-DD
    values.set('time', now.toISOString().slice(11, 16) + ' UTC'); // HH:MM UTC
    values.set('datetime', now.toISOString());

    if (ctx.agent) {
      values.set('agent.name', ctx.agent.name);
      values.set('agent.id', ctx.agent.id);
    }
    if (ctx.organization?.name) {
      values.set('organization.name', ctx.organization.name);
    }
    if (typeof ctx.messageCount === 'number') {
      values.set('conversation.messagecount', String(ctx.messageCount));
    }
    if (ctx.summary) {
      values.set('conversation.summary', ctx.summary);
    }
    if (ctx.language) {
      values.set('language', ctx.language);
    }
    return values;
  }
}
