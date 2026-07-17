import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getRequestContext } from '../common/tracer/correlation.storage';
import { TracerService } from '../common/tracer/tracer.service';
import {
  resolveChannel,
  extractEntityIds,
} from '../common/events/resolve-channel';

/** High-frequency endpoints kept out of the success log (errors still log). */
const QUIET_PATHS = /\/poll(\?|$)/;

/** Only these methods get an event_logs envelope row (reads are console-only). */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly tracer: TracerService) {}

  private get httpCaptureEnabled(): boolean {
    return process.env.EVENT_LOG_HTTP_CAPTURE !== 'false';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, user } = request;
    const now = Date.now();
    const quiet = QUIET_PATHS.test(originalUrl);

    // Enrich AsyncLocalStorage with user context (Guards have already run)
    const store = getRequestContext();
    if (store) {
      store.ip = request.ip;
      if (user) {
        store.userId = user.id;
        store.clerkId = user.clerkId;
        store.organizationId = user.organizationId;
      }
    }

    const captureEnvelope = MUTATING.has(method) && this.httpCaptureEnabled;

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const res = context.switchToHttp().getResponse();
          if (!quiet) {
            this.logger.log(
              `← ${method} ${originalUrl} ${res.statusCode} ${Date.now() - now}ms`,
            );
          }
          if (captureEnvelope) {
            this.writeEnvelope(request, res.statusCode, body, now);
          }
        },
        error: (err: unknown) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(
            `← ${method} ${originalUrl} ${status} ${Date.now() - now}ms — ${message}`,
          );
          // 5xx are written by AllExceptionsFilter (with the stack); here we
          // capture 4xx business rejections on mutating routes so they're audited too.
          if (captureEnvelope && status < 500) {
            this.writeEnvelope(request, status, undefined, now, message);
          }
        },
      }),
    );
  }

  /** Fire-and-forget: one event_logs row per mutating request. Never throws. */
  private writeEnvelope(
    request: {
      method: string;
      originalUrl: string;
      params?: Record<string, string | undefined>;
      headers?: Record<string, unknown>;
      body?: unknown;
    },
    statusCode: number,
    responseBody: unknown,
    startedAt: number,
    errorMessage?: string,
  ): void {
    const channel = resolveChannel(request.originalUrl);
    const { agentId, organizationId } = extractEntityIds(
      request.originalUrl,
      request.params ?? {},
    );
    void this.tracer.logEvent({
      channel,
      eventName: `${channel}_HTTP_${request.method}`,
      direction: 'INBOUND',
      agentId,
      organizationId,
      requestUrl: request.originalUrl,
      requestHeaders: request.headers,
      requestPayload: request.body,
      responseStatus: statusCode,
      responsePayload: responseBody,
      latencyMs: Date.now() - startedAt,
      success: statusCode < 400,
      errorMessage,
    });
  }
}
