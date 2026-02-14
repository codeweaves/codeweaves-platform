import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor(private configService: ConfigService) {
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
        return null;
      }

      this.logger.log(`Email sent: ${data?.id}`);
      return data;
    } catch (error) {
      this.logger.error(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Don't throw - email failure shouldn't block invitation creation
      return null;
    }
  }
}
