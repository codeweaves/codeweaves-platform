import type { HelmetOptions } from 'helmet';

/**
 * Returns helmet options based on environment.
 *
 * CSP `default-src 'none'` is production-only because Swagger UI
 * (served in non-production at /api/docs) requires scripts, styles, and images.
 * HSTS is production-only to avoid HTTPS enforcement on localhost.
 */
export function getHelmetOptions(nodeEnv?: string): HelmetOptions {
  const isProduction = nodeEnv === 'production';
  return {
    contentSecurityPolicy: isProduction
      ? { directives: { defaultSrc: ["'none'"] } }
      : false,
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    hidePoweredBy: true,
  };
}
