# Security patterns

Security decisions and the mechanism behind each. Read before touching the code named here.

## Client IP and rate-limit keys

**Rule.** The client IP is `clientIp(request)` from `apps/api/src/utils/client-ip.ts`, which returns `request.ip` only. The raw `X-Forwarded-For` header is never read: a client can rotate it per request to mint fresh rate-limit buckets or forge its visitor identity.

`request.ip` is only as good as Express `trust proxy`, which is set from `TRUST_PROXY_HOPS` (default 1). Too low and `request.ip` is a shared proxy address, so unrelated visitors share one bucket. Too high and, if the origin can be reached without the CDN, a client can forge its IP through `X-Forwarded-For` again. Raise it only after checking that a forged header sent straight to the origin does not change `request.ip`.

## Dashboard response headers

`apps/web/next.config.js` sets the baseline headers on every route: a Content-Security-Policy built from the configured origins (API, Clerk Frontend API, Sentry, Supabase, widget), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (microphone allowed for the voice preview) and `Cross-Origin-Opener-Policy`. Vercel adds HSTS.

`script-src` keeps `'unsafe-inline'` because Next's inline bootstrap needs it without nonces, and nonces would force every page to render dynamically. A new third-party origin in the dashboard needs a matching CSP entry, or the browser blocks it.
