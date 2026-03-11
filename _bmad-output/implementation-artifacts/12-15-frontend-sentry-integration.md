# Story 12.15: Frontend Sentry Integration

Status: done

## Story

As a **developer**, I want client-side error tracking integrated into the Next.js frontend, so that frontend errors are captured and analyzed in Sentry alongside backend errors for full-stack observability.

## Acceptance Criteria

1. **Given** `@sentry/nextjs` is installed, **When** the Next.js app initializes (client and server), **Then** Sentry SDK is loaded with `NEXT_PUBLIC_SENTRY_DSN` env var, environment tag, and release version.
2. **Given** a client-side JavaScript error occurs (unhandled exception, promise rejection), **When** it happens, **Then** it is automatically captured and sent to Sentry with a stack trace.
3. **Given** a server-side rendering error occurs, **When** it happens in a server component or API route, **Then** it is captured by Sentry's server-side instrumentation.
4. **Given** a React component throws during render, **When** the error boundary catches it, **Then** a user-friendly fallback UI is shown AND the error is reported to Sentry.
5. **Given** user context is available (Auth0 session), **When** the user is logged in, **Then** Sentry events include `user.id`, `user.email`, `user.role` for correlation with backend errors.
6. **Given** `NEXT_PUBLIC_SENTRY_DSN` is empty or missing, **When** the app starts, **Then** Sentry is gracefully disabled (no errors, no performance impact).
7. **Given** source maps, **When** errors are captured in production, **Then** stack traces are readable (not minified) via source map upload during build.
8. **Given** sensitive data, **When** Sentry captures events, **Then** Auth tokens, cookies, and user passwords are scrubbed before sending.

## Tasks / Subtasks

- [x] **Task 1: Install @sentry/nextjs** (AC: #1)
  - [x] Run `cd apps/web && bun add @sentry/nextjs`

- [x] **Task 2: Create sentry.client.config.ts** (AC: #1, #2, #6)
  - [x] Create `apps/web/sentry.client.config.ts`
  - [x] Call `Sentry.init()` with DSN from `process.env.NEXT_PUBLIC_SENTRY_DSN`
  - [x] Set `environment` from `process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT` (default to `process.env.NODE_ENV`)
  - [x] Set `release` from `process.env.NEXT_PUBLIC_SENTRY_RELEASE` or `npm_package_version`
  - [x] Set `tracesSampleRate: 0.1` (match backend from Story 12-1)
  - [x] Set `replaysSessionSampleRate: 0` (disabled, add later if needed)
  - [x] Set `replaysOnErrorSampleRate: 0` (disabled, add later if needed)
  - [x] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;` at the top for graceful disable

- [x] **Task 3: Create sentry.server.config.ts** (AC: #1, #3, #6)
  - [x] Create `apps/web/sentry.server.config.ts`
  - [x] Call `Sentry.init()` with DSN, environment, release (same pattern as client config)
  - [x] Set `tracesSampleRate: 0.1`
  - [x] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;`

- [x] **Task 4: Create sentry.edge.config.ts** (AC: #1, #3, #6)
  - [x] Create `apps/web/sentry.edge.config.ts`
  - [x] Call `Sentry.init()` with DSN, environment, release (same pattern, edge-compatible)
  - [x] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;`

- [x] **Task 5: Configure next.config.js with withSentryConfig** (AC: #1, #7)
  - [x] Modify `apps/web/next.config.js`
  - [x] Import `withSentryConfig` from `@sentry/nextjs`
  - [x] Wrap the existing `nextConfig` export with `withSentryConfig(nextConfig, sentryOptions)`
  - [x] Configure source map upload options: `org`, `project`, `authToken` from `process.env.SENTRY_AUTH_TOKEN`
  - [x] Set `silent: true` to suppress upload logs in local dev
  - [x] Set `hideSourceMaps: true` so source maps are uploaded but not publicly served
  - [x] Preserve existing config: `devIndicators: false`, `transpilePackages: ['@repo/validation']`

- [x] **Task 6: Create global-error.tsx** (AC: #4)
  - [x] Create `apps/web/app/global-error.tsx`
  - [x] Mark as `'use client'`
  - [x] Call `Sentry.captureException(error)` in a `useEffect` when `error` prop changes
  - [x] Render a full-page fallback UI with a "Try again" button that calls `reset()`
  - [x] Must include its own `<html>` and `<body>` tags (Next.js requirement for global-error)

- [x] **Task 7: Create route-level error.tsx** (AC: #4)
  - [x] Create `apps/web/app/error.tsx`
  - [x] Mark as `'use client'`
  - [x] Call `Sentry.captureException(error)` in a `useEffect`
  - [x] Render an in-page fallback UI with a "Try again" button that calls `reset()`
  - [x] Use existing Tailwind utility classes for consistent styling

- [x] **Task 8: Create SentryUserProvider** (AC: #5)
  - [x] Create `apps/web/providers/sentry-user-provider.tsx`
  - [x] Mark as `'use client'`
  - [x] Import `useAuth0` from `@auth0/auth0-react` to read current user
  - [x] In a `useEffect`, when `user` is available, call `Sentry.setUser({ id: user.sub, email: user.email })`
  - [x] When `user` is `undefined` (logged out), call `Sentry.setUser(null)` to clear context
  - [x] Render `{children}` pass-through (transparent wrapper)

- [x] **Task 9: Add SentryUserProvider to root layout** (AC: #5)
  - [x] Modify `apps/web/app/layout.tsx`
  - [x] Add `<SentryUserProvider>` inside `<Auth0ProviderWrapper>` (must be inside Auth0 so `useAuth0` works)
  - [x] Wrap the existing children: `<Auth0ProviderWrapper><SentryUserProvider>...children...</SentryUserProvider></Auth0ProviderWrapper>`

- [x] **Task 10: Configure data scrubbing** (AC: #8)
  - [x] Add `beforeSend` callback in `sentry.client.config.ts`
  - [x] Strip `Authorization` header from request breadcrumbs
  - [x] Strip `cookie` values from request data
  - [x] Strip `password`, `token`, `secret` fields from event extras/contexts
  - [x] Add `denyUrls` for common third-party scripts that generate noise (e.g., browser extensions)

- [x] **Task 11: Add environment variables** (AC: #1, #6, #7)
  - [x] Add `NEXT_PUBLIC_SENTRY_DSN=` to `apps/web/.env.example`
  - [x] Add `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development` to `apps/web/.env.example`
  - [x] Add `SENTRY_AUTH_TOKEN=` to `apps/web/.env.example` (for source map uploads in CI)
  - [x] Add the same vars to `apps/web/.env.local` with empty values (DSN left blank = disabled in local dev)

- [x] **Task 12: Verify build and lint** (AC: #1)
  - [x] Run `bun run lint` — no new warnings/errors
  - [x] Run `bun run check-types` — all types pass
  - [x] Run `bun run build` — build succeeds with Sentry config (DSN empty = no upload attempted)

## Dev Notes

### Architecture Compliance

**Sentry SDK auto-instrumentation** — `@sentry/nextjs` automatically instruments page navigations (as transactions), fetch/XHR requests, React component renders, and Web Vitals (LCP, FID, CLS). No manual span creation is needed for this story.

**Config file placement** — `sentry.client.config.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts` must be placed at the root of `apps/web/` (not inside `src/` or `app/`). This is a `@sentry/nextjs` requirement — the SDK automatically loads these files based on their location.

**withSentryConfig wraps next.config.js** — The `withSentryConfig()` wrapper in `next.config.js` handles source map upload during `next build` and adds auto-instrumentation hooks. The existing config properties (`devIndicators`, `transpilePackages`) are preserved.

**Distributed tracing** — Setting `tracesSampleRate: 0.1` to match the backend (Story 12-1) enables correlated distributed traces. When the frontend makes an API call, Sentry propagates trace headers so frontend and backend spans appear in the same trace.

### Existing Patterns to Follow

**Provider pattern** — Follow the existing providers in `apps/web/providers/`:
```
apps/web/providers/
├── auth0-provider.tsx    # 'use client', wraps Auth0Provider
├── query-provider.tsx    # 'use client', wraps QueryClientProvider
├── api-gate.tsx          # 'use client', wraps API readiness check
└── sentry-user-provider.tsx  # NEW — 'use client', sets Sentry user context
```

**Root layout provider nesting** — Current layout nests providers as:
```tsx
<QueryProvider>
  <ApiGate>
    <Auth0ProviderWrapper>
      {children}
    </Auth0ProviderWrapper>
  </ApiGate>
</QueryProvider>
```
`SentryUserProvider` goes inside `Auth0ProviderWrapper` since it depends on `useAuth0`:
```tsx
<Auth0ProviderWrapper>
  <SentryUserProvider>
    {children}
  </SentryUserProvider>
</Auth0ProviderWrapper>
```

**Auth0 user access** — Use `useAuth0()` from `@auth0/auth0-react` (not `@auth0/nextjs-auth0`, which is not used in this project). The user object has `sub` (Auth0 ID), `email`, and custom claims.

### What This Story Does NOT Include

- **Session replay** — Expensive feature, disabled via `replaysSessionSampleRate: 0`. Add later if needed.
- **Custom performance spans** — No manual `Sentry.startSpan()` calls for individual components.
- **Frontend alerting rules** — Covered by existing Story 12-8/12-9 Sentry alerts which work for both platforms.
- **Sentry feedback widget** — Not in scope for initial integration.
- **Backend Sentry setup** — Already covered by Story 12-1 (`@sentry/nestjs`).
- **Frontend unit tests** — Per project rules, NO frontend unit tests. Manual testing only.

### Project Structure Notes

New files to create:
```
apps/web/
├── sentry.client.config.ts       # Client-side Sentry.init()
├── sentry.server.config.ts       # Server-side Sentry.init()
├── sentry.edge.config.ts         # Edge runtime Sentry.init()
├── providers/
│   └── sentry-user-provider.tsx  # Sets Sentry user context from Auth0
└── app/
    ├── global-error.tsx          # Root-level error boundary with Sentry capture
    └── error.tsx                 # Route-level error boundary with Sentry capture
```

Modified files:
```
apps/web/next.config.js           # Wrap with withSentryConfig()
apps/web/app/layout.tsx           # Add SentryUserProvider inside Auth0ProviderWrapper
apps/web/.env.example             # Add NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN
apps/web/.env.local               # Add empty NEXT_PUBLIC_SENTRY_DSN (disabled locally)
```

### Testing Approach

- **NO frontend unit tests** per project rules — manual testing only
- **Manual test 1:** Trigger a client-side error (e.g., add a temporary `throw new Error('test-sentry')` in a component), verify it appears in the Sentry dashboard with stack trace
- **Manual test 2:** Verify the error boundary UI renders when a component throws — check both `global-error.tsx` and `error.tsx` fallback UIs appear correctly
- **Manual test 3:** Log in via Auth0, trigger an error, verify the Sentry event includes `user.id` and `user.email`
- **Manual test 4:** Remove `NEXT_PUBLIC_SENTRY_DSN` from `.env.local`, restart the app, verify no console errors and no Sentry calls
- **Manual test 5:** Run `bun run build` and verify source map upload is attempted when `SENTRY_AUTH_TOKEN` is set (check build output)
- **Manual test 6:** Trigger an error while logged in, check Sentry event does NOT contain `Authorization` header or cookie values

### References

- [Source: apps/web/next.config.js — existing config with `devIndicators` and `transpilePackages`]
- [Source: apps/web/app/layout.tsx — root layout with Auth0ProviderWrapper, QueryProvider, ApiGate nesting]
- [Source: apps/web/providers/auth0-provider.tsx — Auth0Provider wrapper using `@auth0/auth0-react`]
- [Source: apps/web/.env.example — existing env vars for Auth0 and API URL]
- [Source: _bmad-output/implementation-artifacts/12-1-sentry-sdk-integration.md — backend Sentry setup story]
- [Source: _bmad-output/planning-artifacts/architecture.md — NFR51-63 Observability, Epic 12 scope]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Lint initially failed with 9 warnings: `turbo/no-undeclared-env-vars` for SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN, NODE_ENV and `no-undef` for `process` in next.config.js
- Fixed by adding env vars to `turbo.json` globalEnv and adding `/* eslint-disable no-undef */` to next.config.js

### Completion Notes List
- Installed `@sentry/nextjs@10.43.0`
- Created three Sentry config files (client, server, edge) with DSN guard for graceful disable (AC #6)
- All three Sentry configs include `beforeSend` data scrubbing (AC #8): strips Authorization headers, cookies, password/token/secret fields
- Client config includes `denyUrls` for browser extension noise filtering
- Wrapped `next.config.js` with `withSentryConfig` for source map upload support (AC #7)
- Created `global-error.tsx` with own `<html>/<body>` tags and `error.tsx` with Tailwind styling — both capture exceptions via `Sentry.captureException` (AC #4)
- Created `SentryUserProvider` using `useAuth0()` + `useProfile()` to set Sentry user context (id, email, role) on login/logout (AC #5)
- Added `SentryUserProvider` inside `Auth0ProviderWrapper` in root layout (AC #5)
- Added Sentry env vars to `.env.example` and `.env.local` (DSN empty = disabled locally) (AC #1, #6)
- Added `NODE_ENV`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` to `turbo.json` globalEnv
- All validations pass: lint (0 warnings), check-types, build, test:cov (959/959 pass)
- No frontend unit tests per project rules — manual testing only

### File List
- `apps/web/sentry.client.config.ts` (new)
- `apps/web/sentry.server.config.ts` (new)
- `apps/web/sentry.edge.config.ts` (new)
- `apps/web/app/global-error.tsx` (new)
- `apps/web/app/error.tsx` (new)
- `apps/web/providers/sentry-user-provider.tsx` (new)
- `apps/web/next.config.js` (modified)
- `apps/web/app/layout.tsx` (modified)
- `apps/web/.env.example` (modified)
- `apps/web/.env.local` (modified)
- `turbo.json` (modified)
- `apps/web/package.json` (modified — dependency added)
- `bun.lock` (modified — lockfile updated)

## Change Log
- 2026-03-11: Implemented frontend Sentry integration — SDK init (client/server/edge), error boundaries, user context provider, data scrubbing, source map config, env vars
- 2026-03-11: Code review fixes — added user.role to Sentry context (AC #5), added beforeSend scrubbing to server/edge configs (AC #8), documented missing env vars (SENTRY_RELEASE, SENTRY_ORG, SENTRY_PROJECT), targeted eslint-disable, added bun.lock to File List
