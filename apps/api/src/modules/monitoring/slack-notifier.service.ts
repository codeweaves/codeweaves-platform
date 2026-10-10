import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  PROVIDERS,
  ProviderEventLogger,
} from "../../common/events/provider.logger";
import { AppLogger } from "../../common/logger/app-logger";
import { redactUrlPath } from "./redact-url";

export interface SlackField {
  label: string;
  value: string;
}

export interface SlackMessage {
  /** Slack mrkdwn. Escape any user-controlled part with `escapeSlack()`. */
  text: string;
  /** Rendered as a two-column fields block. Escaped here. */
  fields?: SlackField[];
}

const SLACK_TIMEOUT_MS = 10_000;
/** Slack caps a section's text at 3000 chars and a fields block at 10 fields. */
const MAX_TEXT_CHARS = 3_000;
const MAX_FIELDS = 10;
const MAX_FIELD_CHARS = 1_900;

/**
 * Escape text for Slack mrkdwn. `<`, `>` and `&` are the control characters:
 * without this an organization named `<!channel>` would ping the whole channel.
 */
export function escapeSlack(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Posts ops alerts to one Slack incoming webhook (`SLACK_ALERTS_WEBHOOK_URL`,
 * the #klivo-alerts channel; ADR-0013). Unset → every send is a no-op.
 *
 * `send()` never throws: it resolves `true` when Slack accepted the message
 * and `false` otherwise, so a Slack outage can never break the caller.
 */
@Injectable()
export class SlackNotifierService implements OnModuleInit {
  private readonly log = new AppLogger(SlackNotifierService.name);
  private readonly webhookUrl: string | undefined;

  constructor(
    config: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {
    this.webhookUrl =
      config.get<string>("SLACK_ALERTS_WEBHOOK_URL")?.trim() || undefined;
  }

  onModuleInit(): void {
    if (!this.webhookUrl) {
      this.log.info(
        "onModuleInit",
        "SLACK_ALERTS_WEBHOOK_URL is not set: Slack alerts are off",
      );
    }
  }

  isConfigured(): boolean {
    return this.webhookUrl !== undefined;
  }

  async send(message: SlackMessage): Promise<boolean> {
    const url = this.webhookUrl;
    if (!url) return false;
    try {
      await this.providerLog.traced(
        {
          channel: "INTERNAL",
          provider: PROVIDERS.SLACK,
          eventBase: "SLACK_WEBHOOK_POST",
          requestUrl: redactUrlPath(url),
          requestPayload: { textChars: message.text.length },
          extract: (status) => ({ responseStatus: status }),
        },
        async () => {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(this.toPayload(message)),
            signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
          });
          if (!res.ok) {
            const reason = await res.text().catch(() => "");
            throw new Error(`Slack HTTP ${res.status} ${clip(reason, 200)}`);
          }
          return res.status;
        },
      );
      return true;
    } catch (err) {
      this.log.warn("send", "Slack alert not delivered", {
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private toPayload(message: SlackMessage): Record<string, unknown> {
    const text = clip(message.text, MAX_TEXT_CHARS);
    const blocks: Record<string, unknown>[] = [
      { type: "section", text: { type: "mrkdwn", text } },
    ];
    const fields = (message.fields ?? []).slice(0, MAX_FIELDS);
    if (fields.length > 0) {
      blocks.push({
        type: "section",
        fields: fields.map((f) => ({
          type: "mrkdwn",
          text: clip(
            `*${escapeSlack(f.label)}*\n${escapeSlack(f.value)}`,
            MAX_FIELD_CHARS,
          ),
        })),
      });
    }
    // `text` is the push-notification and fallback body; blocks render in-app.
    return { text, blocks };
  }
}
