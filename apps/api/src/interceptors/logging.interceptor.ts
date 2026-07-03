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

/** High-frequency endpoints kept out of the success log (errors still log). */
const QUIET_PATHS = /\/poll(\?|$)/;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, user } = request;
    const now = Date.now();
    const quiet = QUIET_PATHS.test(originalUrl);

    // Enrich AsyncLocalStorage with user context (Guards have already run)
    const store = getRequestContext();
    if (store && user) {
      store.userId = user.id;
      store.clerkId = user.clerkId;
    }

    return next.handle().pipe(
      tap({
        next: () => {
          if (quiet) return;
          const res = context.switchToHttp().getResponse();
          this.logger.log(
            `← ${method} ${originalUrl} ${res.statusCode} ${Date.now() - now}ms`,
          );
        },
        error: (err: unknown) => {
          const status =
            err instanceof HttpException ? err.getStatus() : 500;
          const message =
            err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(
            `← ${method} ${originalUrl} ${status} ${Date.now() - now}ms — ${message}`,
          );
        },
      }),
    );
  }
}
