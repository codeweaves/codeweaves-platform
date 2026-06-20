import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { InternalSecretGuard } from '../../src/guards/internal-secret.guard';

const SECRET = 'super-secret-value';

function makeContext(
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret: string | undefined): InternalSecretGuard {
  const config = {
    get: jest.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
  return new InternalSecretGuard(config);
}

describe('InternalSecretGuard', () => {
  it('allows the request when the header matches the secret', () => {
    const guard = makeGuard(SECRET);
    const ctx = makeContext({ 'x-internal-secret': SECRET });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('fails closed when INTERNAL_API_SECRET is unset', () => {
    const guard = makeGuard(undefined);
    const ctx = makeContext({ 'x-internal-secret': SECRET });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects when the header is missing', () => {
    const guard = makeGuard(SECRET);
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong secret of the same length', () => {
    const guard = makeGuard(SECRET);
    const ctx = makeContext({ 'x-internal-secret': 'x'.repeat(SECRET.length) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong secret of a different length', () => {
    const guard = makeGuard(SECRET);
    const ctx = makeContext({ 'x-internal-secret': 'short' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('handles an array-valued header by taking the first entry', () => {
    const guard = makeGuard(SECRET);
    const ctx = makeContext({ 'x-internal-secret': [SECRET, 'other'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
