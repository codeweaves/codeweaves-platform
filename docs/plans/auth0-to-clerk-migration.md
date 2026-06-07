# Auth0 → Clerk Migration Plan

> Status: **Implemented (code complete, unverified at runtime)** · 2026-06-06 · Branch: `feature/clerk-migration`
> Owner: Dhruv

## Implementation status (2026-06-06)

**Done & verified locally (not committed):**
- ✅ Backend (`apps/api`): Clerk JWKS JWT strategy, `clerk-management.service` (@clerk/backend@3.5.0), Clerk-ticket invitations, user resolution = **match-by-clerkId → else create-from-invitation** (the email-auto-link bridge was built then **removed at user request 2026-06-06** — zero auto-claim logic), all `auth0Id`→`clerkId` renames, Prisma migration `20260606120000_auth0_to_clerk`. **`check-types` ✓ · `lint` ✓ · `build` ✓ · `test` 1642/1642 ✓.**
- ✅ Frontend (`apps/web`): `@clerk/nextjs@7.4.3` (Clerk **Core 3**), `proxy.ts` (Next 16 middleware), `ClerkProvider`, `use-auth` (same public API, normalized user), `api-client` (`getToken({template:'klivo-api'})`), custom **headless sign-in + ticket sign-up pages built on Core 3 hooks** (`useSignIn`/`useSignUp` — `@clerk/elements` was dropped, see note below), Sentry/sidebar/profile updated, `callback`+`login` routes deleted, `@auth0/auth0-react` removed. **`check-types` ✓ · `lint` ✓ · `build` ✓.**
- ⚠️ **Clerk Elements is NOT compatible with `@clerk/nextjs@7` (Core 3)** — it's deprecated and Core-2-only (pulls `@clerk/clerk-react@5`/`@clerk/shared@3`, causing a duplicate-context "useClerk can only be used within ClerkProvider" crash). Replaced with Core 3 custom-flow hooks. Do not reinstall `@clerk/elements`.

**Remaining (needs you / a live Clerk instance):**
1. **Clerk dashboard (Phase 0)** — create app, Email+Password on, public sign-up OFF, `klivo-api` JWT template (`email`+`aud` claims), custom domain → set `CLERK_ISSUER`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. **Apply the Prisma migration** to dev/prod DB: `bunx prisma migrate deploy` (or `migrate dev`).
3. **Runtime-test** (Clerk keys required, build was validated with a dummy key): sign-in, invitation→ticket→set-password→first-login link, password reset, role gating. Verify the ticket sign-up flow + the `invitation.url` property on the live API.
4. Cut over prod env, link/re-invite the 3 users, delete Auth0 tenant, docs sweep.

## 1. Why this is low-risk (read this first)

Two facts, verified against the current code, make this migration small:

1. **Authorization is 100% database-driven, not token-driven.** `RolesGuard`
   ([roles.guard.ts:44-50](../../apps/api/src/guards/roles.guard.ts#L44-L50)) and the
   permission matrix read `request.user.role`, which `UserSyncGuard`
   ([user-sync.guard.ts:52-66](../../apps/api/src/guards/user-sync.guard.ts#L52-L66)) loads
   from Postgres. The Auth0 namespaced claims (`https://codeweaves.com/roles`,
   `/organizationId`) are parsed in [jwt.strategy.ts:36-37](../../apps/api/src/strategies/jwt.strategy.ts#L36-L37)
   but **never used in any decision.** → We replicate **zero** Auth0 Rules / custom claims / Orgs in Clerk.

2. **DB user rows are created lazily by email, not pre-created.** Invitations only pre-create an
   *Auth0* user to mint a password ticket. The real `users` row is created on first API call by
   [`createFromInvitation`](../../apps/api/src/services/users.service.ts#L171-L228), matching the
   pending invitation **by email** and stamping `auth0Id = jwt.sub`.

So the backend only needs a **stable `sub`** + **`email`** from the IdP. Everything else is ours.

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend token verify | **Keep `passport-jwt` + JWKS**, add Clerk JWT template `klivo-api` | ~10-line change; guards/decorators/tests untouched |
| Existing 3 prod users | **Manual link** — paste each user's Clerk user id into `users.clerkId` after the migration. (An email-link bridge was built then removed at the user's request — they wanted no auto-claim.) | Fully explicit; matches old Auth0 behavior |
| Sign-in / set-password UI | **Custom headless pages via Core 3 hooks** (`useSignIn`/`useSignUp`) + Shadcn | No Clerk branding. (Elements was the original pick but is deprecated / Core-2-only — incompatible with `@clerk/nextjs@7`.) |
| Invitations | **Keep `UserInvitation` table + our branded emails**; Clerk only mints the `__clerk_ticket` | Near 1:1 swap of `getOrCreateAuth0UserAndTicket()`; keep reissue/resend/email logic |
| Frontend integration depth | **Client-side parity** — keep `AuthGuard`, keep `use-auth.ts` API surface; add pass-through `proxy.ts` | Backend is the real authz boundary; minimal churn |

## 3. Environment (Next.js 16.1.0, React 19.2, no existing middleware)

> Next 16 ⇒ Clerk middleware file is **`apps/web/proxy.ts`** (not `middleware.ts`).

### Env var mapping
| Auth0 (remove) | Clerk (add) |
|---|---|
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER_URL` | `CLERK_ISSUER` (= Frontend API URL, e.g. `https://clerk.klivo.<tld>`), `CLERK_JWT_AUDIENCE=klivo-api` |
| `AUTH0_M2M_CLIENT_ID`, `AUTH0_M2M_CLIENT_SECRET` | `CLERK_SECRET_KEY` |
| `AUTH0_SPA_CLIENT_ID` | — (not needed) |
| `NEXT_PUBLIC_AUTH0_DOMAIN`, `_CLIENT_ID`, `_AUDIENCE`, `_REDIRECT_URI` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` |

---

## Phase 0 — Clerk dashboard setup (no code)

1. Create Clerk application. **Enable Email + Password.** **Disable public sign-up** (invitation-only).
2. **JWT template** named `klivo-api`: claims `{ "email": "{{user.primary_email_address}}", "aud": "klivo-api" }`. (If `aud` is rejected as reserved, drop the audience check in the strategy and validate `iss` only.)
3. Configure **custom domain** `clerk.klivo.<tld>` (Frontend API) → this becomes `CLERK_ISSUER`.
4. Copy `Publishable key` + `Secret key`. Note JWKS at `${CLERK_ISSUER}/.well-known/jwks.json`.

---

## Phase 1 — Database migration

`apps/api/prisma/schema.prisma`:

```prisma
model User {
  // ...
  clerkId        String?   @unique   // was: auth0Id String @unique — now NULLABLE for the bridge
  // ...
  @@index([clerkId])                 // was @@index([auth0Id])
}

model UserInvitation {
  // ...
  clerkInvitationId String?          // was: auth0UserId String?
}
```

- One Prisma migration (`bunx prisma migrate dev --name auth0_to_clerk`).
- Data step (3 prod users): the migration runs `UPDATE users SET "clerkId" = NULL;`. Then link each user manually — Clerk dashboard → Users → copy their User ID (`user_…`) → `UPDATE users SET "clerkId"='user_…' WHERE email='…';`.
- After cutover is verified, a follow-up migration can make `clerkId` `NOT NULL` again.

---

## Phase 2 — Backend (`apps/api`)

### 2.1 `interfaces/jwt-payload.interface.ts`
Drop the namespace fields. New shape:
```ts
export interface JwtPayload { sub: string; email?: string; aud?: string | string[]; }
export interface ValidatedUser { clerkId: string; email: string; }
```

### 2.2 `strategies/jwt.strategy.ts` (the whole diff)
```ts
const issuer = configService.get<string>('CLERK_ISSUER');
const audience = configService.get<string>('CLERK_JWT_AUDIENCE'); // 'klivo-api'
super({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  issuer,
  audience,                          // omit if template can't set aud
  algorithms: ['RS256'],
  secretOrKeyProvider: passportJwtSecret({
    cache: true, rateLimit: true, jwksRequestsPerMinute: 5,
    jwksUri: `${issuer}/.well-known/jwks.json`,
  }),
});
// validate():
return { clerkId: payload.sub, email: payload.email ?? '' };
```

### 2.3 `auth0-management.service.ts` → `clerk-management.service.ts`
Replace the Auth0 M2M REST calls with **`@clerk/backend`** (`createClerkClient({ secretKey })`):
| Old (Auth0) | New (Clerk) |
|---|---|
| `getManagementToken()` + `/oauth/token` | (none — SDK uses secret key) |
| `createUser()` / `getUserByEmail()` / `createPasswordChangeTicket()` | `clerk.invitations.createInvitation({ emailAddress, redirectUrl, ignoreExisting:true })` → returns invite + ticket URL |
| `deleteUser()` | `clerk.invitations.revokeInvitation(id)` (and `clerk.users.deleteUser(id)` if a Clerk user exists) |
- Rename `common/logger/auth0.logger.ts` → `clerk.logger.ts` (event names `CLERK_*`).
- Rename modules: `auth0-management.module.ts` → `clerk-management.module.ts`; update imports in `invitations.module.ts`, `users.module.ts`.

### 2.4 `invitations.service.ts`
- `getOrCreateAuth0UserAndTicket()` → `createClerkInvitationTicket()`: calls `clerkManagement.createInvitation()`, stores returned id in `clerkInvitationId`, returns the ticket URL. **Branded email + reissue/resend/expiry logic unchanged.**
- `cancel()`: replace `auth0Management.deleteUser()` with `clerkManagement.revokeInvitation(invitation.clerkInvitationId)`.
- `sendInvitationEmail()`: action URL becomes the Clerk ticket link (lands on `klivo.<tld>/sign-up?__clerk_ticket=...`); keep the `/signup?token=` fallback.

### 2.5 `users.service.ts` — 3-step resolution (the bridge)
```ts
async syncOrCreateUser(jwtUser: { clerkId: string; email: string }) {
  // 1) by clerkId
  const byClerk = await this.prisma.user.findUnique({ where: { clerkId: jwtUser.clerkId }, include:{organization:true} });
  if (byClerk) { if (byClerk.deletedAt) throw new UnauthorizedException('Account deactivated'); return byClerk; }
  // 2) bridge: existing user, verified email, no clerkId yet → claim it
  const byEmail = await this.prisma.user.findUnique({ where: { email: jwtUser.email.toLowerCase() }, include:{organization:true} });
  if (byEmail && !byEmail.clerkId && !byEmail.deletedAt)
    return this.prisma.user.update({ where:{id:byEmail.id}, data:{clerkId:jwtUser.clerkId}, include:{organization:true} });
  // 3) new invite → createFromInvitation (unchanged except field name)
  return this.createFromInvitation(jwtUser);
}
```
- `findByAuth0Id` → `findByClerkId`; `createFromAuth0` → `createFromClerk`; `requestPasswordReset` → **remove** (handled client-side by Clerk) or proxy to `clerk.users` if a server endpoint is desired.

### 2.6 Field renames (`auth0Id`→`clerkId`) in:
`decorators/current-user.decorator.ts`, `common/tracer/tracer.service.ts`, `common/tracer/correlation.storage.ts`, `interceptors/logging.interceptor.ts`, `controllers/auth/users.controller.ts` (password-reset endpoint → remove or repoint).

### 2.7 Tests (CLAUDE.md mandates — run `test:cov`)
Rewrite: `test/strategies/jwt.strategy.spec.ts`, `test/services/auth0-management/*` → `clerk-management`, `test/guards/user-sync.guard.spec.ts` (add bridge cases), `test/services/invitations/*`, `test/services/users/*`, `test/utils/jwt.helper.ts` (mint Clerk-shaped tokens), `test/helpers/tenant-test.helper.ts`.

---

## Phase 3 — Frontend (`apps/web`)

1. `bun add @clerk/nextjs @clerk/elements` · `bun remove @auth0/auth0-react`.
2. **New `apps/web/proxy.ts`** — pass-through `clerkMiddleware()` (required for Clerk on Next 16; no `protect()` needed since `AuthGuard` + backend enforce access):
   ```ts
   import { clerkMiddleware } from '@clerk/nextjs/server';
   export default clerkMiddleware();
   export const config = { matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'] };
   ```
3. `providers/auth0-provider.tsx` → `ClerkProvider` (or inline in `app/layout.tsx`, replacing `Auth0ProviderWrapper` in the tree).
4. **`hooks/use-auth.ts` — keep the public API identical** (`isAuthenticated`, `isLoading`, `user`, `login`, `logout`, `getToken`, `error`) so `sidebar`, `auth-guard`, `login-button`, `user-menu`, `page.tsx` need ~no change. Back it with Clerk `useAuth()` (`isLoaded`, `isSignedIn`, `getToken`, `signOut`) + `useUser()`.
   - `getToken()` → `getToken({ template: 'klivo-api' })`.
   - `login()` → `router.push('/sign-in?redirect_url=...')`.
5. `lib/api-client.ts` — replace `getAccessTokenSilently()` with the hook's `getToken({template:'klivo-api'})`; header logic unchanged.
6. **New custom UI with Core 3 hooks** (headless — no Clerk-rendered components):
   - `app/(auth)/sign-in/page.tsx` — `useSignIn`: `signIn.password({emailAddress,password})` → check `signIn.status==='complete'` → `signIn.finalize({navigate})`. Shadcn `Input`/`Button`/`Card`.
   - `app/(auth)/sign-up/page.tsx` — `useSignUp`: read `__clerk_ticket` → `signUp.ticket({ticket})` → `signUp.password({password})` → `signUp.finalize({navigate})`.
7. `app/(auth)/signup/invitation-content.tsx` — keep `/invitations/validate/:token` UI; the action now routes to the Clerk ticket sign-up. Replace Auth0 `login_hint`.
8. Delete `app/(auth)/callback/page.tsx` (Clerk needs no callback page).
9. `providers/sentry-user-provider.tsx` — `useUser()`: `id: user?.id`, `email: user?.primaryEmailAddress?.emailAddress`.
10. `components/layout/sidebar.tsx` — read name/email from Clerk `useUser()` (still prefer backend `profile`); drop the Auth0 "name === email" quirk.
11. `app/(protected)/dashboard/profile-settings/page.tsx` — replace "Change your password via Auth0" + reset button with Clerk's reset flow (Elements `reset_password_email_code` or a `<UserProfile>` link).
12. `components/features/auth/README.md` — rewrite for Clerk.

---

## Phase 4 — Cutover & cleanup

1. Set prod env (`CLERK_*`, `NEXT_PUBLIC_CLERK_*`); remove `AUTH0_*`.
2. After the migration nulls `clerkId`, set each user's Clerk user id in `users.clerkId` (paste from Clerk dashboard), or re-invite them.
3. Smoke test: sign-in → token → API → logout · create invite → email → ticket → set password → first-login link · password reset · role/org gating intact.
4. Optional follow-up migration: `clerkId` → `NOT NULL`.
5. Delete Auth0 tenant. Docs sweep: ~20 files under `docs/` and `_bmad-output/` mention Auth0 (`integration-architecture.md`, `architecture-api.md`, `data-models-api.md`, `api-contracts-api.md`, security audit, etc.).

## Rollback
Phases 1–3 live on `feature/clerk-migration` behind unchanged prod env until Phase 4. The DB change is additive/nullable (not destructive), so reverting prod env vars + the branch restores Auth0 with no data loss.

## Risk register
| Risk | Mitigation |
|---|---|
| Clerk Core 3 custom-flow hooks | Isolated to 2 page files; type-checked against `@clerk/nextjs@7`; fallback = prebuilt `<SignIn>` + `appearance` |
| JWT template `aud` reserved-claim quirk | Validate `iss` only if `aud` can't be set; both are supported by the strategy |
| 60s Clerk token lifetime | `getToken()` auto-refreshes; api-client already fetches per request |
| Email-bridge claims wrong row | `email` is `@unique` and Clerk-verified; only claims rows with `clerkId IS NULL` |
| Invitation email deliverability | Keep our existing `EmailService`; Clerk only mints the ticket, doesn't send |
```
