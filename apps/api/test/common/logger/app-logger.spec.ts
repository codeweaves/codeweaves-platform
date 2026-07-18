import { Logger } from '@nestjs/common';
import { AppLogger } from '../../../src/common/logger/app-logger';
import { requestContextStorage } from '../../../src/common/tracer/correlation.storage';

describe('AppLogger', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('formats info as "[fn] - message"', () => {
    new AppLogger('MyService').info('doThing', 'started');
    expect(logSpy).toHaveBeenCalledWith('[doThing] - started');
  });

  it('appends redacted meta', () => {
    new AppLogger('MyService').info('doThing', 'ok', { agentId: 'a1', token: 'secret' });
    const msg = logSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[doThing] - ok');
    expect(msg).toContain('"agentId":"a1"');
    expect(msg).toContain('[REDACTED]');
    expect(msg).not.toContain('secret');
  });

  it('error appends the error message and passes the stack', () => {
    const err = new Error('boom');
    new AppLogger('MyService').error('doThing', 'failed', err);
    const [message, stack] = errorSpy.mock.calls[0];
    expect(message).toContain('[doThing] - failed — boom');
    expect(stack).toBe(err.stack);
  });

  it('includes the short correlation id when in a request context', () => {
    requestContextStorage.run(
      { correlationId: 'abcd1234-5678-9012' },
      () => new AppLogger('MyService').warn('doThing', 'degraded'),
    );
    expect(warnSpy).toHaveBeenCalledWith('[doThing] - degraded (corr:abcd1234)');
  });

  it('omits the corr tail outside a request context', () => {
    new AppLogger('MyService').info('doThing', 'no ctx');
    expect(logSpy).toHaveBeenCalledWith('[doThing] - no ctx');
  });
});
