import { Test } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import * as Sentry from '@sentry/nestjs';
import { SentryInterceptor } from '../../../src/common/sentry/sentry.interceptor';
import { SentryService } from '../../../src/common/sentry/sentry.service';
import * as correlationStorage from '../../../src/common/tracer/correlation.storage';

jest.mock('@sentry/nestjs', () => ({
  setUser: jest.fn(),
  setContext: jest.fn(),
  setTag: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('../../../src/common/tracer/correlation.storage', () => ({
  getRequestContext: jest.fn(),
}));

describe('SentryInterceptor', () => {
  let interceptor: SentryInterceptor;
  let sentryService: { isEnabled: jest.Mock };
  let mockCallHandler: CallHandler;

  function createMockContext(overrides: {
    user?: Record<string, unknown>;
    method?: string;
    originalUrl?: string;
  } = {}): ExecutionContext {
    const request = {
      method: overrides.method ?? 'GET',
      originalUrl: overrides.originalUrl ?? '/api/klivo/v1/test',
      user: overrides.user,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    sentryService = { isEnabled: jest.fn().mockReturnValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        SentryInterceptor,
        { provide: SentryService, useValue: sentryService },
      ],
    }).compile();

    interceptor = module.get<SentryInterceptor>(SentryInterceptor);
    mockCallHandler = { handle: () => of('response') };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('when Sentry is enabled', () => {
    beforeEach(() => {
      (correlationStorage.getRequestContext as jest.Mock).mockReturnValue({
        correlationId: 'corr-123-abc',
      });
    });

    it('should call Sentry.setUser with correct fields when request.user exists', (done) => {
      const user = {
        id: 'user-uuid-1',
        clerkId: 'user_abc123',
        organizationId: 'org-uuid-1',
        role: 'admin',
      };
      const ctx = createMockContext({ user });

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setUser).toHaveBeenCalledWith({
            id: 'user-uuid-1',
            clerkId: 'user_abc123',
            organizationId: 'org-uuid-1',
            role: 'admin',
          });
          done();
        },
      });
    });

    it('should call Sentry.setContext with URL, method, and correlationId', (done) => {
      const ctx = createMockContext({
        method: 'POST',
        originalUrl: '/api/klivo/v1/agents',
      });

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setContext).toHaveBeenCalledWith('request', {
            url: '/api/klivo/v1/agents',
            method: 'POST',
            correlationId: 'corr-123-abc',
          });
          done();
        },
      });
    });

    it('should call Sentry.setTag with correlationId', (done) => {
      const ctx = createMockContext();

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setTag).toHaveBeenCalledWith(
            'correlationId',
            'corr-123-abc',
          );
          done();
        },
      });
    });

    it('should add HTTP breadcrumb for the request', (done) => {
      const ctx = createMockContext({
        method: 'DELETE',
        originalUrl: '/api/klivo/v1/items/5',
      });

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
            category: 'http',
            message: 'DELETE /api/klivo/v1/items/5',
            level: 'info',
          });
          done();
        },
      });
    });

    it('should handle missing request.user gracefully (public routes)', (done) => {
      const ctx = createMockContext({ user: undefined });

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setUser).not.toHaveBeenCalled();
          // Request context should still be set
          expect(Sentry.setContext).toHaveBeenCalledWith(
            'request',
            expect.objectContaining({ method: 'GET' }),
          );
          done();
        },
      });
    });

    it('should not call setTag when getRequestContext returns undefined (no store)', (done) => {
      (correlationStorage.getRequestContext as jest.Mock).mockReturnValue(
        undefined,
      );
      const ctx = createMockContext();

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setTag).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should not call setTag when store exists but correlationId is undefined', (done) => {
      (correlationStorage.getRequestContext as jest.Mock).mockReturnValue({
        correlationId: undefined,
      });
      const ctx = createMockContext();

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setTag).not.toHaveBeenCalled();
          expect(Sentry.setContext).toHaveBeenCalledWith('request', {
            url: '/api/klivo/v1/test',
            method: 'GET',
            correlationId: undefined,
          });
          done();
        },
      });
    });
  });

  describe('when Sentry is disabled', () => {
    beforeEach(() => {
      sentryService.isEnabled.mockReturnValue(false);
    });

    it('should NOT call any Sentry methods', (done) => {
      const ctx = createMockContext({
        user: { id: 'user-1', clerkId: 'user_x', organizationId: 'org-1' },
      });

      interceptor.intercept(ctx, mockCallHandler).subscribe({
        complete: () => {
          expect(Sentry.setUser).not.toHaveBeenCalled();
          expect(Sentry.setContext).not.toHaveBeenCalled();
          expect(Sentry.setTag).not.toHaveBeenCalled();
          expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should still call next.handle() to continue the pipeline', (done) => {
      const ctx = createMockContext();
      const handleSpy = jest.fn(() => of('result'));
      const handler: CallHandler = { handle: handleSpy };

      interceptor.intercept(ctx, handler).subscribe({
        next: (val) => {
          expect(val).toBe('result');
        },
        complete: () => {
          expect(handleSpy).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });
  });
});
