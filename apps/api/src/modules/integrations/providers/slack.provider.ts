import { Injectable, Logger } from '@nestjs/common';
import { tool, type ToolSet } from 'ai';
import { slackCredentialsSchema } from '@repo/validation';
import { z } from 'zod';

import {
  TOOL_CALL_TIMEOUT_MS,
  type ConnectionTestResult,
  type IntegrationProviderDef,
  type ToolStepMeta,
} from './provider.interface';

/**
 * Slack integration via an Incoming Webhook URL — one channel, no OAuth, no
 * token refresh. The credential schema pins the host to hooks.slack.com and
 * we re-verify at send time (defense in depth: a tampered DB row still can't
 * turn this into an open SSRF relay).
 *
 * Tool exposed to the LLM:
 *   - slack_notify_team (write) — post a short notification to the customer's
 *     chosen Slack channel (hot lead, urgent issue, human requested…).
 */
@Injectable()
export class SlackProvider implements IntegrationProviderDef {
  readonly provider = 'slack' as const;
  private readonly logger = new Logger(SlackProvider.name);

  readonly toolStepMeta: Record<string, ToolStepMeta> = {
    slack_notify_team: {
      activeLabel: 'Notifying the team…',
      doneLabel: 'Notified the team on Slack',
      errorLabel: 'Team notification failed',
    },
  };

  parseCredentials(raw: unknown): Record<string, string> {
    return slackCredentialsSchema.parse(raw);
  }

  credentialHint(credentials: Record<string, string>): string {
    try {
      const url = new URL(credentials.webhookUrl!);
      // /services/T0XXX/B0YYY/secret → show the team/bot part, mask the secret.
      const [, , team, bot] = url.pathname.split('/');
      return `hooks.slack.com/…/${team ?? ''}/${bot ?? ''}`.slice(0, 120);
    } catch {
      return 'hooks.slack.com/…';
    }
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<ConnectionTestResult> {
    const result = await this.post(
      credentials.webhookUrl!,
      '✅ CodeWeaves connection test — your AI agent can now send notifications to this channel.',
    );
    return result.ok
      ? { ok: true, message: 'Test message sent to your Slack channel.' }
      : { ok: false, message: result.error };
  }

  buildTools(credentials: Record<string, string>): ToolSet {
    const webhookUrl = credentials.webhookUrl!;
    return {
      slack_notify_team: tool({
        description:
          "Send a short notification to the company's team Slack channel. Use ONLY for things a human should act on soon: a qualified/hot lead, an urgent or unresolved complaint, or an explicit request the bot cannot fulfil. Never use it for casual conversation, and never more than once per conversation unless something new and important happens.",
        inputSchema: z.object({
          message: z
            .string()
            .min(1)
            .max(1500)
            .describe(
              'The notification text. Lead with what the team should do, then 1-3 lines of context (who the visitor is, what they need). Plain text.',
            ),
        }),
        execute: async ({ message }) => {
          const result = await this.post(webhookUrl, `🤖 ${message}`);
          return result.ok
            ? 'Notification delivered to the team Slack channel.'
            : `Notification failed: ${result.error}`;
        },
      }),
    };
  }

  private async post(
    webhookUrl: string,
    text: string,
  ): Promise<{ ok: true; error?: never } | { ok: false; error: string }> {
    // Re-validate the pinned host at call time (see class doc).
    try {
      if (new URL(webhookUrl).hostname !== 'hooks.slack.com') {
        return { ok: false, error: 'Webhook host is not hooks.slack.com.' };
      }
    } catch {
      return { ok: false, error: 'Invalid webhook URL.' };
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        // Codebase-standard timeout (rejects with name 'TimeoutError').
        signal: AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        // Slack webhook errors are short plain-text bodies ("no_service", …).
        const body = (await res.text()).slice(0, 200);
        return { ok: false, error: `Slack returned HTTP ${res.status}: ${body}` };
      }
      return { ok: true };
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      this.logger.warn(
        `Slack webhook post failed: ${timedOut ? 'timeout' : err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        error: timedOut
          ? `Slack did not respond within ${TOOL_CALL_TIMEOUT_MS / 1000}s.`
          : 'Network error reaching Slack.',
      };
    }
  }
}
