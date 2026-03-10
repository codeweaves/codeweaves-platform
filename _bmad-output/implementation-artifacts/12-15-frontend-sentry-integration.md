# Story 12.15: Frontend Sentry Integration

Status: ready-for-dev

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

- [ ] **Task 1: Install @sentry/nextjs** (AC: #1)
  - [ ] Run `cd apps/web && bun add @sentry/nextjs`

- [ ] **Task 2: Create sentry.client.config.ts** (AC: #1, #2, #6)
  - [ ] Create `apps/web/sentry.client.config.ts`
  - [ ] Call `Sentry.init()` with DSN from `process.env.NEXT_PUBLIC_SENTRY_DSN`
  - [ ] Set `environment` from `process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT` (default to `process.env.NODE_ENV`)
  - [ ] Set `release` from `process.env.NEXT_PUBLIC_SENTRY_RELEASE` or `npm_package_version`
  - [ ] Set `tracesSampleRate: 0.1` (match backend from Story 12-1)
  - [ ] Set `replaysSessionSampleRate: 0` (disabled, add later if needed)
  - [ ] Set `replaysOnErrorSampleRate: 0` (disabled, add later if needed)
  - [ ] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;` at the top for graceful disable

- [ ] **Task 3: Create sentry.server.config.ts** (AC: #1, #3, #6)
  - [ ] Create `apps/web/sentry.server.config.ts`
  - [ ] Call `Sentry.init()` with DSN, environment, release (same pattern as client config)
  - [ ] Set `tracesSampleRate: 0.1`
  - [ ] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;`

- [ ] **Task 4: Create sentry.edge.config.ts** (AC: #1, #3, #6)
  - [ ] Create `apps/web/sentry.edge.config.ts`
  - [ ] Call `Sentry.init()` with DSN, environment, release (same pattern, edge-compatible)
  - [ ] Guard with `if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;`

- [ ] **Task 5: Configure next.config.js with withSentryConfig** (AC: #1, #7)
  - [ ] Modify `apps/web/next.config.js`
  - [ ] Import `withSentryConfig` from `@sentry/nextjs`
  - [ ] Wrap the existing `nextConfig` export with `withSentryConfig(nextConfig, sentryOptions)`
  - [ ] Configure source map upload options: `org`, `project`, `authToken` from `process.env.SENTRY_AUTH_TOKEN`
  - [ ] Set `silent: true` to suppress upload logs in local dev
  - [ ] Set `hideSourceMaps: true` so source maps are uploaded but not publicly served
  - [ ] Preserve existing config: `devIndicators: false`, `transpilePackages: ['@repo/validation']`

- [ ] **Task 6: Create global-error.tsx** (AC: #4)
  - [ ] Create `apps/web/app/global-error.tsx`
  - [ ] Mark as `'use client'`
  - [ ] Call `Sentry.captureException(error)` in a `useEffect` when `error` prop changes
  - [ ] Render a full-page fallback UI with a "Try again" button that calls `reset()`
  - [ ] Must include its own `<html>` and `<body>` tags (Next.js requirement for global-error)

- [ ] **Task 7: Create route-level error.tsx** (AC: #4)
  - [ ] Create `apps/web/app/error.tsx`
  - [ ] Mark as `'use client'`
  - [ ] Call `Sentry.captureException(error)` in a `useEffect`
  - [ ] Render an in-page fallback UI with a "Try again" button that calls `reset()`
  - [ ] Use existing Tailwind utility classes for consistent styling

- [ ] **Task 8: Create SentryUserProvider** (AC: #5)
  - [ ] Create `apps/web/providers/sentry-user-provider.tsx`
  - [ ] Mark as `'use client'`
  - [ ] Import `useAuth0` from `@auth0/auth0-react` to read current user
  - [ ] In a `useEffect`, when `user` is available, call `Sentry.setUser({ id: user.sub, email: user.email })`
  - [ ] When `user` is `undefined` (logged out), call `Sentry.setUser(null)` to clear context
  - [ ] Render `{children}` pass-through (transparent wrapper)

- [ ] **Task 9: Add SentryUserProvider to root layout** (AC: #5)
  - [ ] Modify `apps/web/app/layout.tsx`
  - [ ] Add `<SentryUserProvider>` inside `<Auth0ProviderWrapper>` (must be inside Auth0 so `useAuth0` works)
  - [ ] Wrap the existing children: `<Auth0ProviderWrapper><SentryUserProvider>...children...</SentryUserProvider></Auth0ProviderWrapper>`

- [ ] **Task 10: Configure data scrubbing** (AC: #8)
  - [ ] Add `beforeSend` callback in `sentry.client.config.ts`
  - [ ] Strip `Authorization` header from request breadcrumbs
  - [ ] Strip `cookie` values from request data
  - [ ] Strip `password`, `token`, `secret` fields from event extras/contexts
  - [ ] Add `denyUrls` for common third-party scripts that generate noise (e.g., browser extensions)

- [ ] **Task 11: Add environment variables** (AC: #1, #6, #7)
  - [ ] Add `NEXT_PUBLIC_SENTRY_DSN=` to `apps/web/.env.example`
  - [ ] Add `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development` to `apps/web/.env.example`
  - [ ] Add `SENTRY_AUTH_TOKEN=` to `apps/web/.env.example` (for source map uploads in CI)
  - [ ] Add the same vars to `apps/web/.env.local` with empty values (DSN left blank = disabled in local dev)

- [ ] **Task 12: Verify build and lint** (AC: #1)
  - [ ] Run `bun run lint` — no new warnings/errors
  - [ ] Run `bun run check-types` — all types pass
  - [ ] Run `bun run build` — build succeeds with Sentry config (DSN empty = no upload attempted)

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

### Debug Log References

### Completion Notes List

### File List
