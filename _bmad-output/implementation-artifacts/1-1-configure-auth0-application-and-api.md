# Story 1.1: Configure Auth0 Application and API

Status: done

## Story

As a **developer**,
I want Auth0 properly configured for the platform,
So that users can authenticate securely.

## Acceptance Criteria

1. **Given** an Auth0 tenant exists
   **When** Auth0 is configured
   **Then** Auth0 Application (SPA) is created for dashboard

2. **And** Auth0 API is created for backend authorization

3. **And** Callback URLs are configured for local and production

4. **And** Allowed origins include all deployment environments

5. **And** Configuration values are documented in `.env.example`

## Tasks / Subtasks

- [ ] Task 1: Create Auth0 Application (SPA) (AC: 1)
  - [ ] Log into Auth0 Dashboard
  - [ ] Create new Application → Single Page Application
  - [ ] Name: "CodeWeaves Dashboard"
  - [ ] Note Application Client ID

- [ ] Task 2: Create Auth0 API (AC: 2)
  - [ ] Create new API in Auth0
  - [ ] Identifier: `https://api.codeweaves.com` (or your domain)
  - [ ] Name: "CodeWeaves API"
  - [ ] Signing Algorithm: RS256
  - [ ] Enable RBAC (optional for future)

- [ ] Task 3: Configure Application URLs (AC: 3, 4)
  - [ ] Allowed Callback URLs:
    - `http://localhost:3000/callback`
    - `https://app.codeweaves.com/callback`
  - [ ] Allowed Logout URLs:
    - `http://localhost:3000`
    - `https://app.codeweaves.com`
  - [ ] Allowed Web Origins:
    - `http://localhost:3000`
    - `https://app.codeweaves.com`
  - [ ] Allowed Origins (CORS):
    - `http://localhost:3001`
    - `https://api.codeweaves.com`

- [ ] Task 4: Document environment variables (AC: 5)
  - [ ] Update `apps/api/.env.example` with Auth0 vars
  - [ ] Update `apps/web/.env.example` with Auth0 vars
  - [ ] Create local `.env` files with actual values

- [ ] Task 5: Verify configuration
  - [ ] Test that Auth0 tenant is accessible
  - [ ] Verify JWKS endpoint is reachable
  - [ ] Document tenant domain format

## Dev Notes

### Auth0 Configuration Values

**For Backend (apps/api/.env):**
```env
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_AUDIENCE="https://api.codeweaves.com"
AUTH0_ISSUER_URL="https://your-tenant.auth0.com/"
```

**For Dashboard (apps/web/.env):**
```env
NEXT_PUBLIC_AUTH0_DOMAIN="your-tenant.auth0.com"
NEXT_PUBLIC_AUTH0_CLIENT_ID="your-spa-client-id"
NEXT_PUBLIC_AUTH0_AUDIENCE="https://api.codeweaves.com"
NEXT_PUBLIC_AUTH0_REDIRECT_URI="http://localhost:3000/callback"
```

### Auth0 Application Settings

| Setting | Value |
|---------|-------|
| Application Type | Single Page Application |
| Token Endpoint Auth Method | None |
| ID Token Expiration | 36000 seconds (10 hours) |
| Refresh Token Rotation | Enabled |
| Refresh Token Expiration | Enabled, 7 days |

### Auth0 API Settings

| Setting | Value |
|---------|-------|
| Identifier | `https://api.codeweaves.com` |
| Signing Algorithm | RS256 |
| Allow Offline Access | Yes (for refresh tokens) |
| Token Expiration | 86400 seconds (24 hours) |
| Token Expiration (Browser) | 7200 seconds (2 hours) |

### Architecture Compliance

- **ADR-005:** Auth0 for Authentication - NO Supabase Auth, JWT verification in NestJS
- **NFR12:** All user authentication must be handled via Auth0 (no password storage in application)
- **NFR76:** Auth0 integration must handle social logins (Google, GitHub, Microsoft)
- **NFR77:** Auth0 integration must support MFA (multi-factor authentication)

### JWKS Endpoint

The JWKS (JSON Web Key Set) endpoint for token verification:
```
https://{AUTH0_DOMAIN}/.well-known/jwks.json
```

### Testing Requirements

This story is configuration-only. Verification:
- Auth0 dashboard accessible
- Application and API created
- Environment variables documented
- JWKS endpoint returns valid keys

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#12-Authentication-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1]
- [Auth0 SPA Quickstart: https://auth0.com/docs/quickstart/spa/react]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to modify:
- `apps/api/.env.example`
- `apps/web/.env.example`
- `apps/api/.env` (create from example)
- `apps/web/.env` (create from example)
