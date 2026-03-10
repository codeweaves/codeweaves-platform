import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const dsn = this.configService.get<string>('SENTRY_DSN');
    this.enabled = !!dsn;

    if (!this.enabled) {
      this.logger.warn('Sentry disabled — SENTRY_DSN not configured');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  captureException(
    exception: unknown,
    context?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;

    Sentry.withScope((scope) => {
      if (context) {
        scope.setContext('extra', context);
      }
      Sentry.captureException(exception);
    });
  }

  captureMessage(message: string, level?: Sentry.SeverityLevel): void {
    if (!this.enabled) return;

    Sentry.captureMessage(message, level);
  }
}
