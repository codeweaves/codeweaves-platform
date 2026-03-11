import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { scrubSentryEvent } from '../../../src/common/sentry/sentry.scrubber';

function scrub(event: Record<string, unknown>): ErrorEvent {
  return scrubSentryEvent(
    event as unknown as ErrorEvent,
    {} as EventHint,
  ) as ErrorEvent;
}

describe('scrubSentryEvent', () => {
  describe('Authorization header scrubbing', () => {
    it('should strip Authorization header from event.request.headers', () => {
      const result = scrub({
        request: {
          headers: {
            authorization: 'Bearer eyJhbGciOiJSUzI1NiIs...',
            'content-type': 'application/json',
          },
        },
      });

      expect(result.request!.headers!['authorization']).toBe('[REDACTED]');
      expect(result.request!.headers!['content-type']).toBe(
        'application/json',
      );
    });

    it('should handle missing request headers gracefully', () => {
      const result = scrub({});
      expect(result).toEqual({});
    });
  });

  describe('sensitive field redaction', () => {
    it('should redact password fields in request data', () => {
      const result = scrub({
        request: {
          data: {
            email: 'user@test.com',
            password: 'super-secret-123',
          },
        },
      });

      expect(
        (result.request!.data as Record<string, unknown>)['password'],
      ).toBe('[REDACTED]');
      expect((result.request!.data as Record<string, unknown>)['email']).toBe(
        'user@test.com',
      );
    });

    it('should redact secret, token, apiKey, api_key, credential fields', () => {
      const result = scrub({
        request: {
          data: {
            secret: 'my-secret',
            token: 'jwt-token',
            apiKey: 'key-123',
            api_key: 'key-456',
            credential: 'cred-abc',
            safeField: 'visible',
          },
        },
      });
      const data = result.request!.data as Record<string, unknown>;

      expect(data['secret']).toBe('[REDACTED]');
      expect(data['token']).toBe('[REDACTED]');
      expect(data['apiKey']).toBe('[REDACTED]');
      expect(data['api_key']).toBe('[REDACTED]');
      expect(data['credential']).toBe('[REDACTED]');
      expect(data['safeField']).toBe('visible');
    });

    it('should recursively scrub nested objects in request data', () => {
      const result = scrub({
        request: {
          data: {
            user: {
              name: 'Test',
              password: 'nested-secret',
              settings: {
                token: 'deep-token',
                theme: 'dark',
              },
            },
          },
        },
      });
      const data = result.request!.data as Record<string, unknown>;
      const user = data['user'] as Record<string, unknown>;
      const settings = user['settings'] as Record<string, unknown>;

      expect(user['name']).toBe('Test');
      expect(user['password']).toBe('[REDACTED]');
      expect(settings['token']).toBe('[REDACTED]');
      expect(settings['theme']).toBe('dark');
    });

    it('should scrub event.extra objects', () => {
      const result = scrub({
        extra: {
          correlationId: 'abc-123',
          apiKey: 'should-be-hidden',
          details: {
            secret: 'nested-secret',
          },
        },
      });

      expect(result.extra!['correlationId']).toBe('abc-123');
      expect(result.extra!['apiKey']).toBe('[REDACTED]');
      expect(
        (result.extra!['details'] as Record<string, unknown>)['secret'],
      ).toBe('[REDACTED]');
    });

    it('should recursively scrub sensitive fields inside arrays', () => {
      const result = scrub({
        request: {
          data: {
            users: [
              { name: 'Alice', password: 'secret1' },
              { name: 'Bob', token: 'jwt-abc' },
            ],
          },
        },
      });
      const data = result.request!.data as Record<string, unknown>;
      const users = data['users'] as Record<string, unknown>[];

      expect(users[0]!['name']).toBe('Alice');
      expect(users[0]!['password']).toBe('[REDACTED]');
      expect(users[1]!['name']).toBe('Bob');
      expect(users[1]!['token']).toBe('[REDACTED]');
    });

    it('should be case-insensitive for sensitive key matching', () => {
      const result = scrub({
        request: {
          data: {
            Password: 'upper',
            SECRET: 'all-caps',
            Token: 'mixed',
          },
        },
      });
      const data = result.request!.data as Record<string, unknown>;

      expect(data['Password']).toBe('[REDACTED]');
      expect(data['SECRET']).toBe('[REDACTED]');
      expect(data['Token']).toBe('[REDACTED]');
    });
  });

  describe('query string scrubbing', () => {
    it('should redact sensitive keys in query_string', () => {
      const result = scrub({
        request: {
          query_string: 'page=1&token=secret-jwt&apiKey=my-key&safe=ok',
        },
      });

      expect(result.request!.query_string).toBe(
        'page=1&token=[REDACTED]&apiKey=[REDACTED]&safe=ok',
      );
    });

    it('should handle query_string with no sensitive keys', () => {
      const result = scrub({
        request: {
          query_string: 'page=1&limit=10',
        },
      });

      expect(result.request!.query_string).toBe('page=1&limit=10');
    });

    it('should handle missing query_string gracefully', () => {
      const result = scrub({
        request: { headers: {} },
      });

      expect(result.request!.query_string).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle event with no request', () => {
      const result = scrub({ message: 'test' });
      expect(result.message).toBe('test');
    });

    it('should handle event with null request data', () => {
      const result = scrub({
        request: { data: null },
      });
      expect(result.request!.data).toBeNull();
    });

    it('should handle event with string request data', () => {
      const result = scrub({
        request: { data: 'raw-body-string' },
      });
      expect(result.request!.data).toBe('raw-body-string');
    });
  });
});
