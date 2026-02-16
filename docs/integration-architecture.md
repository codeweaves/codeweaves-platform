# Integration Architecture - CodeWeaves Platform

> Generated: 2026-02-14 | Type: Monorepo Multi-Part

## Overview

The CodeWeaves Platform consists of three application parts that communicate through Auth0 and REST APIs. This document describes the integration points, data flow, and communication patterns between parts.

## Integration Diagram

```
                        ┌──────────────────┐
                        │      Auth0       │
                        │  (Identity Mgmt) │
                        └──┬───────────┬───┘
                   JWKS    │           │  OAuth2/OIDC
                   Verify  │           │  Login Flow
                           │           │
┌──────────────────┐       │    ┌──────▼───────────┐
│   Widget (Preact)│       │    │   Web (Next.js)   │
│   apps/widget    │       │    │   apps/web         │
│                  │       │    │                    │
│  (Future: will   │       │    │  Auth0Provider     │
│   call API)      │       │    │  → useAuth hook    │
└──────────────────┘       │    │  → api-client.ts ──┼──── REST API ────┐
                           │    └───────────────────┘                   │
                           │                                            │
                    ┌──────▼───────────────────────────────────────────▼──┐
                    │                 API (NestJS)                         │
                    │                 apps/api                             │
                    │                                                     │
                    │  JWT Strategy ─── Auth0 JWKS Validation             │
                    │  UserSync Interceptor ─── Auto-create DB users      │
                    │  Controllers ─── REST endpoints                     │
                    │  Services ─── Business logic                        │
                    │  Prisma ─── Database access                         │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │              PostgreSQL (Supabase)                   │
                    │              Redis (Docker/Local)                    │
                    └─────────────────────────────────────────────────────┘
```

## Integration Points

### 1. Web → API (REST API)

| Property | Value |
|----------|-------|
| **From** | `apps/web` |
| **To** | `apps/api` |
| **Type** | REST API (HTTP) |
| **Client** | `apps/web/lib/api-client.ts` |
| **Auth** | Auth0 JWT Bearer token |
| **Protocol** | HTTP/HTTPS |
| **Format** | JSON |

**Flow:**
1. Web app authenticates user via Auth0 (`@auth0/auth0-react`)
2. `api-client.ts` attaches JWT token to HTTP requests
3. API validates JWT via `JwtAuthGuard` + `JwtStrategy`
4. `UserSyncInterceptor` ensures user exists in local DB
5. Controller processes request and returns JSON response

---

### 2. Web ↔ Auth0 (OAuth2/OIDC)

| Property | Value |
|----------|-------|
| **From** | `apps/web` |
| **To** | Auth0 |
| **Type** | OAuth2/OIDC |
| **Client** | `@auth0/auth0-react` |
| **Callback** | `/callback` page |

**Flow:**
1. User clicks Login → redirected to Auth0
2. Auth0 authenticates user (email/password, social, etc.)
3. Auth0 redirects back to `/callback` with authorization code
4. `@auth0/auth0-react` exchanges code for tokens
5. JWT stored in memory, used for API requests

---

### 3. API ↔ Auth0 (JWKS Verification)

| Property | Value |
|----------|-------|
| **From** | `apps/api` |
| **To** | Auth0 |
| **Type** | JWKS (JSON Web Key Set) |
| **Client** | `jwks-rsa` library |
| **Strategy** | `apps/api/src/strategies/jwt.strategy.ts` |

**Flow:**
1. API receives JWT token in request header
2. `JwtStrategy` fetches public keys from Auth0's JWKS endpoint
3. Validates token signature, expiry, audience, and issuer
4. Extracts `sub` (Auth0 user ID) from token payload

---

### 4. Widget → API (Planned)

| Property | Value |
|----------|-------|
| **From** | `apps/widget` |
| **To** | `apps/api` |
| **Type** | REST API (HTTP) |
| **Status** | Not yet implemented |

The widget will communicate with the API for customer-facing features. Authentication strategy TBD (likely API key or limited JWT).

## Shared Dependencies

### packages/validation
- **Used by:** api, web (planned)
- **Purpose:** Shared Zod validation schemas
- **Ensures:** Consistent validation rules across frontend and backend

### packages/typescript-config
- **Used by:** api, web, widget
- **Purpose:** Shared TypeScript compiler options

### packages/eslint-config
- **Used by:** api, web, widget
- **Purpose:** Shared linting rules

### packages/jest-config
- **Used by:** api (web testing not yet configured)
- **Purpose:** Shared test configuration

## Data Flow Summary

```
User Browser
    │
    ├── Auth0 Login (OAuth2) ──── Auth0 Tenant
    │                                  │
    ├── GET /users/me ────────────── API ──── PostgreSQL
    │    (JWT Bearer)                  │        (Supabase)
    │                                  │
    └── PATCH /users/me ──────────── API ──── PostgreSQL
         (JWT Bearer)
```

## Environment Configuration Coupling

Both `web` and `api` depend on matching Auth0 configuration:
- `AUTH0_DOMAIN` must match across both apps
- `AUTH0_AUDIENCE` must match API identifier in Auth0
- `AUTH0_CLIENT_ID` (web) must be registered in the same Auth0 tenant
