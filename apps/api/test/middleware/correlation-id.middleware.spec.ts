import { CorrelationIdMiddleware } from '../../src/middleware/correlation-id.middleware';
import { requestContextStorage } from '../../src/common/tracer/correlation.storage';
import { Request, Response } from 'express';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  function createMockReqRes(headers: Record<string, string> = {}) {
    const req = {
      headers,
      method: 'GET',
      originalUrl: '/api/klivo/v1/organizations',
    } as unknown as Request;

    const resHeaders: Record<string, string> = {};
    const res = {
      setHeader: jest.fn((key: string, value: string) => {
        resHeaders[key] = value;
      }),
      getHeader: (key: string) => resHeaders[key],
    } as unknown as Response;

    return { req, res, resHeaders };
  }

  it('should use existing X-Correlation-ID header when present', (done) => {
    const { req, res } = createMockReqRes({
      'x-correlation-id': 'existing-correlation-id',
    });

    middleware.use(req, res, () => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'x-correlation-id',
        'existing-correlation-id',
      );
      done();
    });
  });

  it('should generate new UUID when X-Correlation-ID header is missing', (done) => {
    const { req, res } = createMockReqRes();

    middleware.use(req, res, () => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'x-correlation-id',
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      );
      done();
    });
  });

  it('should set X-Correlation-ID on response header', (done) => {
    const { req, res } = createMockReqRes({
      'x-correlation-id': 'test-id',
    });

    middleware.use(req, res, () => {
      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'test-id');
      done();
    });
  });

  it('should store context in AsyncLocalStorage', (done) => {
    const { req, res } = createMockReqRes({
      'x-correlation-id': 'test-correlation',
    });

    middleware.use(req, res, () => {
      const store = requestContextStorage.getStore();
      expect(store).toBeDefined();
      expect(store!.correlationId).toBe('test-correlation');
      expect(store!.method).toBe('GET');
      expect(store!.url).toBe('/api/klivo/v1/organizations');
      expect(store!.userId).toBeUndefined();
      expect(store!.clerkId).toBeUndefined();
      done();
    });
  });

  it('should generate new UUID when header is an array', (done) => {
    const req = {
      headers: { 'x-correlation-id': ['id-1', 'id-2'] },
      method: 'GET',
      originalUrl: '/api/test',
    } as unknown as Request;

    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    middleware.use(req, res, () => {
      expect(res.setHeader).toHaveBeenCalledWith(
        'x-correlation-id',
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      );
      done();
    });
  });

  it('should not have context outside of middleware run', () => {
    const store = requestContextStorage.getStore();
    expect(store).toBeUndefined();
  });
});
