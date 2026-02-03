# Story 0.9: Set Up Environment Configuration

Status: done

## Story

As a **developer**,
I want environment variable management,
So that configuration is externalized and secure.

## Acceptance Criteria

1. **Given** multiple applications needing configuration
   **When** I set up environment management
   **Then** `.env.example` files document required variables

2. **And** `.env` files are gitignored

3. **And** Each app has its own `.env` with app-specific variables

4. **And** Shared variables are documented

5. **And** Environment validation fails fast on missing required variables

## Tasks / Subtasks

- [ ] Task 1: Create root .env.example (AC: 1, 4)
  - [ ] Document all shared environment variables
  - [ ] Include comments explaining each variable
  - [ ] Group variables by service/purpose

- [ ] Task 2: Create app-specific .env.example files (AC: 3)
  - [ ] Create `apps/api/.env.example`
  - [ ] Create `apps/web/.env.example`
  - [ ] Document app-specific variables

- [ ] Task 3: Update .gitignore (AC: 2)
  - [ ] Ensure `.env` is ignored
  - [ ] Ensure `.env.local` is ignored
  - [ ] Ensure `.env.*.local` patterns are ignored
  - [ ] Keep `.env.example` files tracked

- [ ] Task 4: Set up NestJS ConfigModule (AC: 5)
  - [ ] Install `@nestjs/config` in apps/api
  - [ ] Create config validation schema with Zod
  - [ ] Configure ConfigModule in AppModule
  - [ ] Fail startup on missing required vars

- [ ] Task 5: Set up Next.js env validation (AC: 5)
  - [ ] Create `env.ts` validation file
  - [ ] Validate env at build time
  - [ ] Document NEXT_PUBLIC_ prefix requirements

## Dev Notes

### Root .env.example

```env
# ============================================
# CodeWeaves Platform - Environment Variables
# ============================================
# Copy this file to .env and fill in values

# ============================================
# Database (Supabase PostgreSQL)
# ============================================
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"

# ============================================
# Redis
# ============================================
REDIS_URL="redis://localhost:6379"

# ============================================
# Auth0
# ============================================
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"
AUTH0_AUDIENCE="https://api.codeweaves.com"

# ============================================
# Sentry (Error Tracking)
# ============================================
SENTRY_DSN="https://xxx@xxx.ingest.sentry.io/xxx"
SENTRY_ENVIRONMENT="development"

# ============================================
# n8n (AI Workflows)
# ============================================
N8N_WEBHOOK_URL="https://your-n8n-instance.com/webhook/xxx"
```

### API .env.example

```env
# apps/api/.env.example

# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/codeweaves"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/codeweaves"

# Redis
REDIS_URL="redis://localhost:6379"

# Auth0
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_AUDIENCE="https://api.codeweaves.com"
AUTH0_ISSUER_URL="https://your-tenant.auth0.com/"

# Encryption
ENCRYPTION_KEY="32-byte-hex-key-for-secrets-encryption"

# Sentry
SENTRY_DSN=""

# n8n
N8N_DEFAULT_WEBHOOK_URL="https://your-n8n-instance.com/webhook/xxx"
```

### Web .env.example

```env
# apps/web/.env.example

# Next.js Public Variables (exposed to browser)
NEXT_PUBLIC_API_URL="http://localhost:3001"
NEXT_PUBLIC_AUTH0_DOMAIN="your-tenant.auth0.com"
NEXT_PUBLIC_AUTH0_CLIENT_ID="your-client-id"
NEXT_PUBLIC_AUTH0_AUDIENCE="https://api.codeweaves.com"
NEXT_PUBLIC_SENTRY_DSN=""

# Server-only Variables
AUTH0_CLIENT_SECRET="your-client-secret"
```

### NestJS Config Validation

```typescript
// apps/api/src/config/configuration.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  AUTH0_DOMAIN: z.string(),
  AUTH0_AUDIENCE: z.string(),
  AUTH0_ISSUER_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(32),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export default () => validateEnv();
```

### Architecture Compliance

- **NFR19:** Sensitive data must never be logged or exposed in error messages

### Environment Variable Categories

| Category | Prefix | Example |
|----------|--------|---------|
| Database | DATABASE_ | DATABASE_URL |
| Auth | AUTH0_ | AUTH0_DOMAIN |
| Redis | REDIS_ | REDIS_URL |
| External | N8N_, SENTRY_ | N8N_WEBHOOK_URL |
| Next.js Public | NEXT_PUBLIC_ | NEXT_PUBLIC_API_URL |

### Testing Requirements

- App must fail to start if required vars missing
- Validation errors must be clear and actionable
- No secrets in git history

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#15-Infrastructure-DevOps]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.9]
- [NestJS Config: https://docs.nestjs.com/techniques/configuration]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `.env.example` (root)
- `apps/api/.env.example`
- `apps/web/.env.example`
- `apps/api/src/config/configuration.ts`

Files to modify:
- `.gitignore`
- `apps/api/src/app.module.ts` (add ConfigModule)
