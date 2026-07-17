import { ExecutionContext, HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from '../../src/interceptors/logging.interceptor';
import { TracerService } from '../../src/common/tracer/tracer.service';
import {
  requestContextStorage,
  RequestContext,
} from '../../src/common/tracer/correlation.storage';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  const logEvent = jest.fn().mockResolvedValue(undefined);
  const tracer = { logEvent } as unknown as TracerService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EVENT_LOG_HTTP_CAPTURE;
    interceptor = new LoggingInterceptor(tracer);
  });

  function createMockContext(opts?: {
    method?: string;
    originalUrl?: string;
    params?: Record<string, string>;
    body?: unknown;
    user?: { id: string; clerkId: string; organizationId?: string };
    statusCode?: number;
  }) {
    const request = {
      method: opts?.method ?? 'GET',
      originalUrl: opts?.originalUrl ?? '/api/klivo/v1/organizations',
      params: opts?.params ?? {},
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: opts?.body,
      ip: '1.2.3.4',
      user: opts?.user,
    };
    const response = { statusCode: opts?.statusCode ?? 200 };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, request, response };
  }

  it('logs response with status code and duration', (done) => {
    const { context } = createMockContext();
    const next = { handle: () => of({ data: 'test' }) };
    interceptor.intercept(context, next).subscribe({ complete: () => done() });
  });

  it('enriches AsyncLocalStorage with userId/clerkId/organizationId + ip', (done) => {
    const { context } = createMockContext({
      user: { id: 'user-uuid', clerkId: 'user_123', organizationId: 'org-1' },
    });
    const next = { handle: () => of({ data: 'test' }) };
    requestContextStorage.run({ correlationId: 'c' } as RequestContext, () => {
      interceptor.intercept(context, next).subscribe({
        next: () => {
          const store = requestContextStorage.getStore()!;
          expect(store.userId).toBe('user-uuid');
          expect(store.clerkId).toBe('user_123');
          expect(store.organizationId).toBe('org-1');
          expect(store.ip).toBe('1.2.3.4');
        },
        complete: () => done(),
      });
    });
  });

  it('does NOT write an event_logs row for GET requests', (done) => {
    const { context } = createMockContext({ method: 'GET' });
    const next = { handle: () => of({ ok: true }) };
    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logEvent).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('writes a DASHBOARD_HTTP_POST envelope for a mutating dashboard request', (done) => {
    const { context } = createMockContext({
      method: 'POST',
      originalUrl: '/api/klivo/v1/agents',
      body: { name: 'New Agent' },
      statusCode: 201,
    });
    const next = { handle: () => of({ id: 'agent-1' }) };
    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logEvent).toHaveBeenCalledTimes(1);
        const arg = logEvent.mock.calls[0][0];
        expect(arg.channel).toBe('DASHBOARD');
        expect(arg.eventName).toBe('DASHBOARD_HTTP_POST');
        expect(arg.responseStatus).toBe(201);
        expect(arg.success).toBe(true);
        expect(arg.requestPayload).toEqual({ name: 'New Agent' });
        done();
      },
    });
  });

  it('resolves channel + agentId for the agent editor (PATCH /agents/:id)', (done) => {
    const { context } = createMockContext({
      method: 'PATCH',
      originalUrl: '/api/klivo/v1/agents/agent-42',
      params: { id: 'agent-42' },
      body: { name: 'Renamed' },
    });
    const next = { handle: () => of({ id: 'agent-42' }) };
    interceptor.intercept(context, next).subscribe({
      complete: () => {
        const arg = logEvent.mock.calls[0][0];
        expect(arg.channel).toBe('DASHBOARD');
        expect(arg.agentId).toBe('agent-42');
        done();
      },
    });
  });

  it('resolves WIDGET channel for public chat POSTs', (done) => {
    const { context } = createMockContext({
      method: 'POST',
      originalUrl: '/api/klivo/v1/public/chat/message',
      body: { message: 'hi' },
    });
    const next = { handle: () => of({}) };
    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logEvent.mock.calls[0][0].channel).toBe('WIDGET');
        done();
      },
    });
  });

  it('does not capture when EVENT_LOG_HTTP_CAPTURE=false', (done) => {
    process.env.EVENT_LOG_HTTP_CAPTURE = 'false';
    interceptor = new LoggingInterceptor(tracer);
    const { context } = createMockContext({ method: 'POST' });
    const next = { handle: () => of({}) };
    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logEvent).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('captures a 4xx business rejection on a mutating route (success=false)', (done) => {
    const { context } = createMockContext({ method: 'POST', originalUrl: '/api/klivo/v1/agents' });
    const error = new HttpException('Bad Request', 400);
    const next = { handle: () => throwError(() => error) };
    interceptor.intercept(context, next).subscribe({
      error: () => {
        const arg = logEvent.mock.calls[0][0];
        expect(arg.responseStatus).toBe(400);
        expect(arg.success).toBe(false);
        expect(arg.errorMessage).toBe('Bad Request');
        done();
      },
    });
  });

  it('does NOT write a row for a 5xx (left to AllExceptionsFilter)', (done) => {
    const { context } = createMockContext({ method: 'POST' });
    const next = { handle: () => throwError(() => new Error('boom')) };
    interceptor.intercept(context, next).subscribe({
      error: () => {
        expect(logEvent).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
