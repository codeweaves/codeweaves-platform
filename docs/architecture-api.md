# Architecture - API Backend

> Generated: 2026-02-14 | Part: api | Type: backend

## Overview

The API is a **NestJS 11** REST backend serving the CodeWeaves Platform. It handles user authentication via Auth0 JWT tokens, manages multi-tenant data through Prisma ORM, and provides endpoints for the web dashboard and widget.

## Architecture Pattern

**Layered / Service-Oriented Architecture**

```
HTTP Request
    │
    ▼
┌──────────────────┐
│ Global Guards     │  1. JwtAuthGuard  — validates JWT, sets auth0Id/email/roles
│                   │  2. UserSyncGuard — syncs user from DB, adds id/role/organizationId
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Controller Guards │  RolesGuard — checks user.role against @Roles() decorator
│                   │  TenantGuard — validates org context for CLIENT users
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Controllers       │  Route handling + validation
└──────┬───────────┘
       ▼
┌──────────────────┐
│  Services         │  Business logic
└──────┬───────────┘
       ▼
┌──────────────────┐
│  Prisma ORM       │  Database access
└──────┬───────────┘
       ▼
┌──────────────────┐
│ PostgreSQL        │  Data persistence (Supabase)
└──────────────────┘
```

> **CRITICAL: Guard vs Interceptor ordering in NestJS**
>
> NestJS execution order: **Global Guards → Controller Guards → Interceptors → Route Handlers**
>
> The `UserSyncGuard` MUST be registered as an `APP_GUARD` (not `APP_INTERCEPTOR`).
> It enriches `request.user` with database fields (`id`, `role`, `organizationId`, `organization`)
> that controller-level guards (`RolesGuard`, `TenantGuard`) depend on.
>
> If user sync runs as an interceptor, `RolesGuard` will see `user.role` as `undefined`
> and return 403 Forbidden on every role-protected route.
>
> Registration order in `app.module.ts`:
> ```typescript
> providers: [
>   { provide: APP_GUARD, useClass: JwtAuthGuard },    // 1st: validates JWT
>   { provide: APP_GUARD, useClass: UserSyncGuard },   // 2nd: loads DB user data
> ]
> ```

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Framework | NestJS | 11.0.1 | REST API framework |
| ORM | Prisma | 7.3.0 | Database access layer |
| Database | PostgreSQL | 16 | Primary data store (via Supabase) |
| Auth | Passport + JWT | - | Request authentication |
| Auth Provider | Auth0 | - | Identity management (JWKS) |
| Validation | class-validator + Zod | - | Request/DTO validation |
| Serialization | class-transformer | 0.5.1 | Response transformation |
| Testing | Jest + Supertest | 29.x | Unit & E2E testing |
| E2E Infra | Testcontainers | 10.16.0 | Docker-based test databases |

## Module Structure

```
AppModule (root)
├── Global Guards (APP_GUARD, execution order matters!)
│   ├── JwtAuthGuard         (JWT validation via Auth0 JWKS)
│   └── UserSyncGuard        (DB user sync, enriches request.user)
├── AuthModule
│   ├── JwtStrategy          (Auth0 JWKS validation)
│   ├── JwtAuthGuard          (Route protection)
│   └── PassportModule        (JWT configuration)
├── UsersModule
│   ├── UsersController       (Profile endpoints: /auth/users/me)
│   └── UsersService          (User business logic + sync)
├── OrganizationsModule
│   ├── OrganizationsController        (Org CRUD, SUPER_ADMIN only)
│   └── OrganizationMembersController  (Member management)
├── InvitationsModule
│   ├── InvitationsController  (Invitation CRUD)
│   └── InvitationsService     (Invitation business logic)
└── PrismaModule
    └── PrismaService          (Database connection)
```

## Authentication Flow

1. Client sends request with `Authorization: Bearer <token>` header
2. `JwtAuthGuard` (global guard) validates the JWT via Auth0 JWKS
3. `JwtStrategy` verifies token signature, extracts `auth0Id`, `email`, `roles`
4. `UserSyncGuard` (global guard) syncs Auth0 user with local DB
   - If not found: creates user from pending invitation (or rejects with 401)
   - If found: enriches `request.user` with DB fields (`id`, `role`, `organizationId`, `organization`)
5. Controller-level guards run (`RolesGuard`, `TenantGuard`) using the enriched user data
6. `@CurrentUser()` decorator extracts user from request context
7. Controller processes the request with authenticated user context

## Data Architecture

### Schema (3 models)

**Organization** (Multi-tenant root)
- `id` (UUID, PK)
- `name` (String)
- `users` (1:N → User)

**User** (Platform user)
- `id` (UUID, PK)
- `email` (unique)
- `name` (optional)
- `role` (SUPER_ADMIN | ADMIN | CLIENT)
- `auth0Id` (unique, Auth0 subject)
- `organizationId` (FK → Organization)

**UserInvitation** (Invitation system)
- `id` (UUID, PK)
- `email`, `role`, `organizationId`
- `token` (unique, UUID)
- `reissueToken` (unique, UUID)
- `reissueCount` (Int)
- `status` (PENDING | ACCEPTED | EXPIRED)
- `expiresAt` (DateTime)
- `invitedBy` (optional)

### Indexes
- `users.organizationId`
- `users.auth0Id`
- `user_invitations.email`
- `user_invitations.organizationId`
- `user_invitations.token`
- `user_invitations.status`

## API Endpoints

| Method | Path | Auth | Controller | Description |
|--------|------|------|-----------|-------------|
| GET | `/health` | Public | HealthController | Health check |
| GET | `/users/me` | JWT | UsersController | Get current user profile |
| PATCH | `/users/me` | JWT | UsersController | Update current user profile |

## Testing Strategy

- **Unit Tests**: Jest with mocked dependencies (8 spec files)
- **E2E Tests**: Testcontainers with real PostgreSQL
- **Coverage**: Tracked via Codecov in CI
- **Test structure mirrors source**: `test/controllers/`, `test/services/`, etc.
- **Shared config**: `packages/jest-config/node.js`

## Entry Point

**File:** `apps/api/src/main.ts`

Bootstraps NestJS with:
- Express platform adapter
- Configured on `PORT` env var (default: 3001)

## Configuration

| Env Variable | Purpose | Default |
|-------------|---------|---------|
| `PORT` | API server port | 3001 |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `AUTH0_DOMAIN` | Auth0 tenant domain | - |
| `AUTH0_AUDIENCE` | Auth0 API audience | - |
| `REDIS_URL` | Redis connection (future) | - |
