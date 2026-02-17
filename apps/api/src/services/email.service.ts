import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailLoggerService } from '../common/logger/email.logger';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor(
    private configService: ConfigService,
    private readonly emailLogger: EmailLoggerService,
  ) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
  }

  async send(options: { to: string; subject: string; html: string }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.configService.get<string>(
          'EMAIL_FROM',
          'CodeWeaves <noreply@codeweaves.com>',
        ),
        to: [options.to],
        subject: options.subject,
        html: options.html,
      });

      if (error) {
        this.logger.error(`Failed to send email: ${JSON.stringify(error)}`);
        await this.emailLogger.logEmailFailed(options.to, { error, request: { to: options.to, subject: options.subject } });
        return null;
      }

      this.logger.log(`Email sent: ${data?.id}`);
      await this.emailLogger.logEmailSent(options.to, { response: data, request: { to: options.to, subject: options.subject } });
      return data;
    } catch (error) {
      this.logger.error(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await this.emailLogger.logEmailException(options.to, error, { request: { to: options.to, subject: options.subject } });
      // Don't throw - email failure shouldn't block invitation creation
      return null;
    }
  }
}
