import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { getRequestContext } from '../common/tracer/correlation.storage';
import { SentryService } from '../common/sentry/sentry.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly sentryService: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const context = getRequestContext();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      this.logger.error(
        `[${context?.correlationId?.slice(0, 8) ?? 'no-ctx'}] ${request.method} ${request.originalUrl} — ${exception}`,
        exception instanceof Error ? exception.stack : undefined,
      );

      this.sentryService.captureException(exception, {
        correlationId: context?.correlationId,
        method: request.method,
        url: request.originalUrl,
      });
    }

    // Preserve structured HttpException responses (e.g. { message, reissueToken })
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? ((exceptionResponse as Record<string, unknown>)['message'] ??
              'Internal server error')
          : 'Internal server error';

    const body: Record<string, unknown> = {
      statusCode: status,
      message,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    };

    // Merge extra fields from structured HttpException responses
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const extra = Object.fromEntries(
        Object.entries(exceptionResponse as Record<string, unknown>).filter(
          ([key]) => !['statusCode', 'message', 'error'].includes(key),
        ),
      );
      Object.assign(body, extra);
    }

    response.status(status).json(body);
  }
}
