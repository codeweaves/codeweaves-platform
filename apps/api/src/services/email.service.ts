import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailLoggerService } from '../common/logger/email.logger';
import { ProviderEventLogger } from '../common/events/provider.logger';

/** Resend rejects tag values outside `[A-Za-z0-9_-]`, and a rejected tag fails
 *  the whole send — so coerce rather than trust the caller. */
function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'unknown';
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor(
    private configService: ConfigService,
    private readonly emailLogger: EmailLoggerService,
    private readonly providerLog: ProviderEventLogger,
  ) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
  }

  /**
   * Send one transactional email.
   *
   * `to` accepts an array so a single notification reaching a whole team costs
   * one provider call instead of N. Recipients are passed as separate envelope
   * addresses (Resend fans them out) — they are teammates in the same
   * organization, never cross-tenant.
   *
   * Still fire-and-forget: returns null on failure and never throws, because a
   * mail provider hiccup must not fail the business operation that triggered it.
   */
  async send(options: {
    to: string | string[];
    subject: string;
    html: string;
    /** Plain-text alternative. Improves inbox placement — always pass it. */
    text?: string;
    replyTo?: string;
    /** Resend tags for per-template analytics. Values must be ASCII alnum/_/-. */
    tags?: Record<string, string>;
  }) {
    const start = performance.now();
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    // Logged/audited identity for the send. Kept out of the payloads below so
    // we never write a full recipient list into event_logs.
    const toLabel =
      recipients.length === 1
        ? (recipients[0] ?? 'unknown')
        : `${recipients.length} recipients`;
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.configService.get<string>(
          'EMAIL_FROM',
          'CodeWeaves <noreply@codeweaves.com>',
        ),
        to: recipients,
        subject: options.subject,
        html: options.html,
        ...(options.text ? { text: options.text } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.tags
          ? {
              tags: Object.entries(options.tags).map(([name, value]) => ({
                name,
                value: sanitizeTagValue(value),
              })),
            }
          : {}),
      });

      if (error) {
        this.logger.error(`Failed to send email: ${JSON.stringify(error)}`);
        await this.emailLogger.logEmailFailed(toLabel, { error, request: { to: toLabel, subject: options.subject } });
        this.providerLog.log({
          channel: 'DASHBOARD',
          eventName: 'RESEND_EMAIL_FAILED',
          direction: 'OUTBOUND',
          provider: 'RESEND',
          requestPayload: { to: toLabel, subject: options.subject },
          latencyMs: Math.round(performance.now() - start),
          success: false,
          errorMessage: typeof error === 'object' ? JSON.stringify(error) : String(error),
        });
        return null;
      }

      this.logger.log(`Email sent: ${data?.id}`);
      await this.emailLogger.logEmailSent(toLabel, { response: data, request: { to: toLabel, subject: options.subject } });
      this.providerLog.log({
        channel: 'DASHBOARD',
        eventName: 'RESEND_EMAIL_COMPLETED',
        direction: 'OUTBOUND',
        provider: 'RESEND',
        requestPayload: { to: toLabel, subject: options.subject },
        responsePayload: { id: data?.id },
        latencyMs: Math.round(performance.now() - start),
      });
      return data;
    } catch (error) {
      this.logger.error(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await this.emailLogger.logEmailException(toLabel, error, { request: { to: toLabel, subject: options.subject } });
      this.providerLog.log({
        channel: 'DASHBOARD',
        eventName: 'RESEND_EMAIL_FAILED',
        direction: 'OUTBOUND',
        provider: 'RESEND',
        requestPayload: { to: toLabel, subject: options.subject },
        latencyMs: Math.round(performance.now() - start),
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - email failure shouldn't block the operation that triggered it
      return null;
    }
  }
}
