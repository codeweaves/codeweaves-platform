# Dashboard auth failures

## Symptom
Dashboard users get logged out or see 401 on every request. New invitees cannot sign in: "No valid invitation found", "Your email must be verified", or "Could not verify your email right now".

## Confirm
- Render logs: `[JwtAuthGuard] [handleRequest] - authentication rejected {reason: jwt-error | no-user}`.
- `SELECT "responseStatus", count(*) FROM event_logs WHERE channel = 'DASHBOARD' AND "responseStatus" IN (401, 403) AND "createdAt" > now() - interval '30 minutes' GROUP BY 1;`
- Clerk status page, and the JWKS URL `<CLERK_ISSUER>/.well-known/jwks.json` must return keys.

## Cause
- **All users 401:** `CLERK_ISSUER` does not match the `iss` claim on tokens (prod custom domain vs `*.clerk.accounts.dev`), or `CLERK_JWT_AUDIENCE` is set but the JWT template does not emit that `aud`. JWKS fetches are capped at 5 per minute, so a key rotation can take a minute to pick up.
- **One user 401 "Account has been deactivated":** their `users.deletedAt` is set.
- **Invitee cannot sign in:** provisioning is invitation-only and fail-closed. It needs a `PENDING`, unexpired `user_invitations` row for the exact email, AND Clerk confirming the email is verified on that account. If Clerk is unreachable, provisioning refuses rather than guessing.
- **403 "route declares no authorization":** a route shipped without `@Public`, `@SelfOnly` or `@RequirePermission`. Boot should have refused it (`RouteAuthorizationAssertion`).
- **Role change not applied for up to 60 s:** `UserSyncGuard` caches identity per instance. Role edits evict on the same instance; others wait out the TTL.

## Fix
1. Compare `CLERK_ISSUER` in Render with the `iss` claim of a real token (decode in browser devtools, not on a third-party site). Fix, redeploy.
2. Invitee: check the invitation row status and expiry, resend from Team, and make sure the invitee verified the email in Clerk before first login.
3. Deactivated user who should be active: platform admin, Users page.

## Prevent
- `CLERK_ISSUER`, `CLERK_JWT_AUDIENCE`, `CLERK_SECRET_KEY` on the release checklist. Boot fails fast only on a missing `CLERK_ISSUER`.
- After any Clerk instance or domain change, sign in once on staging before promoting.
