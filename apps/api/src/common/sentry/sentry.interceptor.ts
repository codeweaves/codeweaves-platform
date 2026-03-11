import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as Sentry from '@sentry/nestjs';
import { SentryService } from './sentry.service';
import { getRequestContext } from '../tracer/correlation.storage';

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  constructor(private readonly sentryService: SentryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.sentryService.isEnabled()) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, user } = request;
    const reqContext = getRequestContext();
    const correlationId = reqContext?.correlationId;

    // Enrich Sentry scope with user context (Guards have already run)
    if (user) {
      Sentry.setUser({
        id: user.id,
        auth0Id: user.auth0Id,
        organizationId: user.organizationId,
        role: user.role,
      });
    }

    // Attach request context
    Sentry.setContext('request', {
      url: originalUrl,
      method,
      correlationId,
    });

    // Tag for easy filtering in Sentry dashboard
    if (correlationId) {
      Sentry.setTag('correlationId', correlationId);
    }

    // Add HTTP breadcrumb for this request
    Sentry.addBreadcrumb({
      category: 'http',
      message: `${method} ${originalUrl}`,
      level: 'info',
    });

    return next.handle();
  }
}
