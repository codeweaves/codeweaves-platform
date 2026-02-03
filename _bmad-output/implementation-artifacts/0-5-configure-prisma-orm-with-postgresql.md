# Story 0.5: Configure Prisma ORM with PostgreSQL

Status: done

## Story

As a **developer**,
I want Prisma ORM configured for database access,
So that I can interact with PostgreSQL using type-safe queries.

## Acceptance Criteria

1. **Given** the NestJS backend exists
   **When** I configure Prisma
   **Then** `prisma/schema.prisma` defines the initial database schema

2. **And** Prisma Client is generated with TypeScript types

3. **And** Database connection uses environment variables

4. **And** Migration workflow is documented

5. **And** `pnpm db:migrate` runs migrations successfully

## Tasks / Subtasks

- [ ] Task 1: Install and initialize Prisma (AC: 1, 2)
  - [ ] Install `prisma` and `@prisma/client`
  - [ ] Run `npx prisma init` if not already done
  - [ ] Configure `prisma/schema.prisma`

- [ ] Task 2: Define initial database schema (AC: 1)
  - [ ] Create Organization model
  - [ ] Create User model with role enum
  - [ ] Create UserInvitation model
  - [ ] Create Agent model
  - [ ] Create AgentTheme model (JSONB)
  - [ ] Create AgentSecret model
  - [ ] Define relationships and indexes

- [ ] Task 3: Configure database connection (AC: 3)
  - [ ] Set up DATABASE_URL in `.env`
  - [ ] Configure connection pooling settings
  - [ ] Add Supabase connection string format

- [ ] Task 4: Create Prisma module for NestJS (AC: 2)
  - [ ] Create `src/prisma/prisma.module.ts`
  - [ ] Create `src/prisma/prisma.service.ts`
  - [ ] Export PrismaService for injection

- [ ] Task 5: Set up migration scripts (AC: 4, 5)
  - [ ] Add `db:migrate` script to package.json
  - [ ] Add `db:generate` script
  - [ ] Add `db:push` script for development
  - [ ] Add `db:studio` script for Prisma Studio
  - [ ] Document migration workflow

- [ ] Task 6: Verify migration runs (AC: 5)
  - [ ] Run initial migration
  - [ ] Verify tables created in database
  - [ ] Test Prisma Client generation

## Dev Notes

### Prisma Schema (Initial Models)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum Role {
  SUPER_ADMIN
  ADMIN
  CLIENT
}

enum AgentStatus {
  ACTIVE
  INACTIVE
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
}

model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users  User[]
  agents Agent[]

  @@map("organizations")
}

model User {
  id             String       @id @default(uuid())
  email          String       @unique
  name           String?
  role           Role         @default(CLIENT)
  auth0Id        String       @unique
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
  @@map("users")
}

model UserInvitation {
  id             String           @id @default(uuid())
  email          String
  role           Role
  organizationId String
  token          String           @unique
  reissueToken   String           @unique
  reissueCount   Int              @default(0)
  status         InvitationStatus @default(PENDING)
  expiresAt      DateTime
  createdAt      DateTime         @default(now())

  @@index([email])
  @@index([organizationId])
  @@map("user_invitations")
}

model Agent {
  id             String       @id @default(uuid())
  publicId       String       @unique @db.VarChar(8)
  name           String
  status         AgentStatus  @default(ACTIVE)
  allowedDomains String[]     @default([])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?

  theme   AgentTheme?
  secrets AgentSecret?

  @@index([organizationId])
  @@index([publicId])
  @@map("agents")
}

model AgentTheme {
  id        String   @id @default(uuid())
  agentId   String   @unique
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  config    Json     @default("{}")
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("agent_themes")
}

model AgentSecret {
  id              String   @id @default(uuid())
  agentId         String   @unique
  agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  webhookUrl      String?  @db.Text
  webhookHeaders  Json?
  encryptionKey   String   @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("agent_secrets")
}
```

### PrismaService for NestJS

```typescript
// apps/api/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### Package.json Scripts

```json
{
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "db:migrate:dev": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "db:seed": "prisma db seed"
  }
}
```

### Environment Variables

```env
# Supabase PostgreSQL
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"
```

### Architecture Compliance

- **ADR-006:** Application-Level Data Access (No RLS) - All filtering at service layer
- **NFR78:** Supabase integration must use connection pooling

### Testing Requirements

- Prisma Client must generate without errors
- Migrations must apply cleanly
- PrismaService must connect in NestJS app

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#10-Database-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.5]
- [Prisma Documentation: https://www.prisma.io/docs]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create/modify:
- `apps/api/prisma/schema.prisma`
- `apps/api/src/prisma/prisma.module.ts`
- `apps/api/src/prisma/prisma.service.ts`
- `apps/api/package.json` (add scripts)
- `apps/api/.env.example` (add DATABASE_URL)
