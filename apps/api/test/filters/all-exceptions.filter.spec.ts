import { ArgumentsHost, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/filters/all-exceptions.filter';
import {
  requestContextStorage,
  RequestContext,
} from '../../src/common/tracer/correlation.storage';
import { SentryService } from '../../src/common/sentry/sentry.service';
import { TracerService } from '../../src/common/tracer/tracer.service';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockSentryService: jest.Mocked<Pick<SentryService, 'captureException'>>;
  const logEvent = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EVENT_LOG_HTTP_CAPTURE;
    mockSentryService = {
      captureException: jest.fn(),
    };
    filter = new AllExceptionsFilter(
      mockSentryService as unknown as SentryService,
      { logEvent } as unknown as TracerService,
    );
  });

  function createMockHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    const response = { status };
    const request = {
      method: 'GET',
      originalUrl: '/api/klivo/v1/test',
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  }

  it('should return correlationId in error response body', () => {
    const { host, json } = createMockHost();
    const context: RequestContext = { correlationId: 'test-corr-id' };

    requestContextStorage.run(context, () => {
      filter.catch(new HttpException('Bad', 400), host);
    });

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'test-corr-id' }),
    );
  });

  it('should preserve original status/message for HttpException', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new HttpException('Not Found', 404), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not Found',
      }),
    );
  });

  it('should return 500 with generic message for unknown errors', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new Error('unexpected'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });

  it('should include timestamp in response', () => {
    const { host, json } = createMockHost();

    filter.catch(new HttpException('err', 400), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    );
  });

  it('should handle non-Error exceptions gracefully', () => {
    const { host, status, json } = createMockHost();

    filter.catch('string error', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });

  it('should preserve extra fields from structured HttpException responses', () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new HttpException(
        { message: 'Invitation has expired', reissueToken: 'abc-123' },
        400,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Invitation has expired',
        reissueToken: 'abc-123',
      }),
    );
  });

  it('should call sentryService.captureException for 5xx errors', () => {
    const { host } = createMockHost();
    const error = new Error('internal failure');

    const context: RequestContext = { correlationId: 'corr-5xx' };

    requestContextStorage.run(context, () => {
      filter.catch(error, host);
    });

    expect(mockSentryService.captureException).toHaveBeenCalledWith(error, {
      correlationId: 'corr-5xx',
      method: 'GET',
      url: '/api/klivo/v1/test',
    });
  });

  it('should call sentryService.captureException for HttpException with status >= 500', () => {
    const { host } = createMockHost();
    const error = new HttpException('Service Unavailable', 503);

    filter.catch(error, host);

    expect(mockSentryService.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should NOT call sentryService.captureException for 4xx errors', () => {
    const { host } = createMockHost();

    filter.catch(new HttpException('Bad Request', 400), host);

    expect(mockSentryService.captureException).not.toHaveBeenCalled();
  });

  it('should NOT call sentryService.captureException for 404 errors', () => {
    const { host } = createMockHost();

    filter.catch(new HttpException('Not Found', 404), host);

    expect(mockSentryService.captureException).not.toHaveBeenCalled();
  });

  it('writes a failed-request event_logs envelope for 5xx (with stack)', () => {
    const { host } = createMockHost();
    filter.catch(new Error('kaboom'), host);

    expect(logEvent).toHaveBeenCalledTimes(1);
    const arg = logEvent.mock.calls[0][0];
    expect(arg.eventName).toBe('DASHBOARD_HTTP_ERROR');
    expect(arg.responseStatus).toBe(500);
    expect(arg.success).toBe(false);
    expect(arg.errorMessage).toBe('kaboom');
    expect(typeof arg.metadata.stack).toBe('string');
  });

  it('does NOT write an event_logs row for 4xx (handled by the interceptor)', () => {
    const { host } = createMockHost();
    filter.catch(new HttpException('Bad Request', 400), host);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('does not write when EVENT_LOG_HTTP_CAPTURE=false', () => {
    process.env.EVENT_LOG_HTTP_CAPTURE = 'false';
    const { host } = createMockHost();
    filter.catch(new Error('kaboom'), host);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
