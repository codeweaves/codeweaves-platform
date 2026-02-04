import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// Generate a test RSA key pair for signing JWTs in tests
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export { publicKey };

export interface TestJwtPayload {
  sub?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
  nbf?: number;
  [key: string]: unknown;
}

export function generateTestToken(
  payload: Partial<TestJwtPayload> = {},
  options?: jwt.SignOptions,
): string {
  const defaultPayload: TestJwtPayload = {
    sub: 'auth0|test-user-id',
    email: 'test@example.com',
    iss: 'https://codeweaves.jp.auth0.com/',
    aud: 'https://api.codeweaves.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  };

  return jwt.sign(defaultPayload, privateKey, {
    algorithm: 'RS256',
    ...options,
  });
}

export function generateExpiredToken(): string {
  return generateTestToken(
    {
      exp: Math.floor(Date.now() / 1000) - 3600,
    },
    { expiresIn: undefined },
  );
}

export function generateNotYetValidToken(): string {
  return generateTestToken({
    nbf: Math.floor(Date.now() / 1000) + 3600,
  });
}

export function generateMalformedToken(): string {
  return 'not.a.valid.jwt.token';
}

export function generateWrongIssuerToken(): string {
  return generateTestToken({
    iss: 'https://wrong-issuer.auth0.com/',
  });
}

export function generateWrongAudienceToken(): string {
  return generateTestToken({
    aud: 'https://wrong-audience.com',
  });
}

export function generateHmacToken(): string {
  return jwt.sign(
    {
      sub: 'auth0|test-user-id',
      email: 'test@example.com',
      iss: 'https://codeweaves.jp.auth0.com/',
      aud: 'https://api.codeweaves.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    'secret-key',
    { algorithm: 'HS256' },
  );
}
