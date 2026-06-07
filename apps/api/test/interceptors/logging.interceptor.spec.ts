import { ExecutionContext, HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from '../../src/interceptors/logging.interceptor';
import {
  requestContextStorage,
  RequestContext,
} from '../../src/common/tracer/correlation.storage';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
  });

  function createMockContext(user?: { id: string; clerkId: string }) {
    const request = {
      method: 'GET',
      originalUrl: '/api/klivo/v1/organizations',
      user,
    };

    const response = {
      statusCode: 200,
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return { context, request, response };
  }

  it('should log response with status code and duration', (done) => {
    const { context } = createMockContext();
    const next = { handle: () => of({ data: 'test' }) };

    const result = interceptor.intercept(context, next);
    result.subscribe({
      complete: () => done(),
    });
  });

  it('should enrich AsyncLocalStorage with userId when user exists', (done) => {
    const { context } = createMockContext({
      id: 'user-uuid',
      clerkId: 'user_123',
    });
    const next = { handle: () => of({ data: 'test' }) };

    const reqContext: RequestContext = {
      correlationId: 'test-corr',
    };

    requestContextStorage.run(reqContext, () => {
      const result = interceptor.intercept(context, next);
      result.subscribe({
        next: () => {
          const store = requestContextStorage.getStore();
          expect(store!.userId).toBe('user-uuid');
          expect(store!.clerkId).toBe('user_123');
        },
        complete: () => done(),
      });
    });
  });

  it('should not error when request.user is undefined', (done) => {
    const { context } = createMockContext();
    const next = { handle: () => of({ data: 'test' }) };

    const reqContext: RequestContext = {
      correlationId: 'test-corr',
    };

    requestContextStorage.run(reqContext, () => {
      const result = interceptor.intercept(context, next);
      result.subscribe({
        next: () => {
          const store = requestContextStorage.getStore();
          expect(store!.userId).toBeUndefined();
          expect(store!.clerkId).toBeUndefined();
        },
        complete: () => done(),
      });
    });
  });

  it('should log error responses', (done) => {
    const { context } = createMockContext();
    const error = new HttpException('Not Found', 404);
    const next = { handle: () => throwError(() => error) };

    const result = interceptor.intercept(context, next);
    result.subscribe({
      error: () => done(),
    });
  });
});
