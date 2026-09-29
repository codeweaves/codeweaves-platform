# ADR-0008: Clerk session token for the API

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Dhruv (founder), Claude (implementation)

## Context

The dashboard sent the API a token from a custom Clerk JWT template, `klivo-api`, which added two claims: `email` and `aud: klivo-api`. The API needs the email to provision invited users. It checked the audience when `CLERK_JWT_AUDIENCE` was set.

Clerk issues the normal session token as part of signing in, and it is held in the browser. A template token is extra: Clerk mints it on request, so every page load waited for one more round trip to Clerk before any API call could start. Measured on the development instance: the session token is ready in 1 ms, the template token takes 310 ms. On a dashboard load that chain was: page JS, then Clerk sign-in state, then the template token, then `/users/me`, then the data. The template step was about a quarter of the time before any data was requested.

The socket gateway already verified plain Clerk tokens (issuer and signature, no audience).

## The four questions

- **Blast radius:** every authenticated dashboard request. A wrong change logs everyone out. It does not touch the widget, which does not use Clerk.
- **One-way or two-way door:** two-way. The `klivo-api` template stays in Clerk, so going back is a two-line revert in the web app.
- **Couples us to:** a Clerk setting. Each Clerk instance (development, production) must add the `email` claim to its session token.
- **Cost of waiting:** 300 ms on every dashboard page load, for every user.

## Decision

The dashboard sends Clerk's session token. The API verifies issuer and signature, and accepts only session tokens: it requires the `sid` claim, which JWT-template tokens do not have. The HTTP strategy and the socket gateway apply the same rule.

- In the Clerk dashboard, each instance adds the claim under Configure, Sessions, Customize session token: `{ "email": "{{user.primary_email_address}}" }`. Done for development on 2026-09-29. Production needs the same before it goes live.
- `getToken()` is called without a template everywhere in the web app.
- The API no longer reads `CLERK_JWT_AUDIENCE`. The environment variable can be deleted.
- The session token lives 60 seconds and Clerk refreshes it in the background. Nothing changes for callers: they already ask for a token per request, and the socket asks on every reconnect.

## Options rejected

### Keep the template and cache its token

**Good:** no Clerk setting and no API change.

**Rejected because:** the first request on every page load still waits for Clerk to mint it, and it expires after 60 seconds like the session token, so the cache helps only within one minute.

### Session token plus an `azp` (authorized party) check

**Good:** Clerk recommends checking `azp` against the allowed dashboard origins. It narrows which frontends a token is accepted from.

**Rejected because:** we have one frontend per Clerk instance, so every session token is for our app. The old audience check did one real job, rejecting tokens from other JWT templates. The `sid` rule now does that. An `azp` check would add an environment variable listing origins per environment. **Revisit if:** a second frontend shares the Clerk instance.

## Consequences

- Dashboard data requests start about 300 ms sooner on every page load.
- A new Clerk instance must have the session-token `email` claim, or invited users cannot be provisioned. It is on the release checklist in `docs/runbooks/auth-failures.md`.
- Deploying this can log users out briefly: the web app deploys before the API, and the old API still asks for the audience while `CLERK_JWT_AUDIENCE` is set. Accepted for develop; signing in again fixes it.
