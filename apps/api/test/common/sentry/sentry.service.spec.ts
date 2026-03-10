import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { SentryService } from '../../../src/common/sentry/sentry.service';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setContext: jest.fn(),
  withScope: jest.fn((cb: (scope: unknown) => void) => {
    const mockScope = { setContext: jest.fn() };
    cb(mockScope);
    return mockScope;
  }),
}));

describe('SentryService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function createModule(envOverrides: Record<string, string | undefined> = {}) {
    const configValues: Record<string, string | undefined> = {
      SENTRY_DSN: undefined,
      SENTRY_ENVIRONMENT: 'test',
      ...envOverrides,
    };

    return Test.createTestingModule({
      providers: [
        SentryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
      ],
    }).compile();
  }

  describe('isEnabled', () => {
    it('should return true when SENTRY_DSN is configured', async () => {
      const module = await createModule({
        SENTRY_DSN: 'https://test@sentry.io/123',
      });
      const service = module.get<SentryService>(SentryService);

      expect(service.isEnabled()).toBe(true);
    });

    it('should return false when SENTRY_DSN is empty', async () => {
      const module = await createModule({ SENTRY_DSN: '' });
      const service = module.get<SentryService>(SentryService);

      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when SENTRY_DSN is missing', async () => {
      const module = await createModule({ SENTRY_DSN: undefined });
      const service = module.get<SentryService>(SentryService);

      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('captureException', () => {
    it('should call Sentry.captureException within withScope when enabled', async () => {
      const module = await createModule({
        SENTRY_DSN: 'https://test@sentry.io/123',
      });
      const service = module.get<SentryService>(SentryService);
      const error = new Error('test error');

      service.captureException(error, { correlationId: 'abc-123' });

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
      // Verify scope.setContext was called via the withScope callback
      const scopeCallback = (Sentry.withScope as jest.Mock).mock.calls[0][0];
      const mockScope = { setContext: jest.fn() };
      scopeCallback(mockScope);
      expect(mockScope.setContext).toHaveBeenCalledWith('extra', {
        correlationId: 'abc-123',
      });
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('should call Sentry.captureException without setting scope context when none provided', async () => {
      const module = await createModule({
        SENTRY_DSN: 'https://test@sentry.io/123',
      });
      const service = module.get<SentryService>(SentryService);
      const error = new Error('test error');

      service.captureException(error);

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
      // Verify scope.setContext was NOT called
      const scopeCallback = (Sentry.withScope as jest.Mock).mock.calls[0][0];
      const mockScope = { setContext: jest.fn() };
      scopeCallback(mockScope);
      expect(mockScope.setContext).not.toHaveBeenCalled();
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('should be a no-op when disabled', async () => {
      const module = await createModule({ SENTRY_DSN: undefined });
      const service = module.get<SentryService>(SentryService);

      service.captureException(new Error('test'));

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.withScope).not.toHaveBeenCalled();
    });
  });

  describe('captureMessage', () => {
    it('should call Sentry.captureMessage when enabled', async () => {
      const module = await createModule({
        SENTRY_DSN: 'https://test@sentry.io/123',
      });
      const service = module.get<SentryService>(SentryService);

      service.captureMessage('test message', 'warning');

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'test message',
        'warning',
      );
    });

    it('should call Sentry.captureMessage without level when not provided', async () => {
      const module = await createModule({
        SENTRY_DSN: 'https://test@sentry.io/123',
      });
      const service = module.get<SentryService>(SentryService);

      service.captureMessage('test message');

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'test message',
        undefined,
      );
    });

    it('should be a no-op when disabled', async () => {
      const module = await createModule({ SENTRY_DSN: undefined });
      const service = module.get<SentryService>(SentryService);

      service.captureMessage('test message', 'error');

      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });
});
