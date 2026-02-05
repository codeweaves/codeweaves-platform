# Story 1.4: Implement User Model and Database Schema

Status: done

## Story

As a **backend developer**,
I want a User database model,
So that user information can be persisted and queried.

## Acceptance Criteria

1. **Given** Prisma is configured
   **When** creating the User model
   **Then** User table stores: id, email, name, role, organizationId, auth0Id

2. **And** Role enum includes: SUPER_ADMIN, ADMIN, CLIENT

3. **And** Foreign key to Organization is defined

4. **And** Unique constraint on email and auth0Id

5. **And** Migration creates the table successfully

## Tasks / Subtasks

- [x] Task 1: Update Prisma schema with User model (AC: 1, 2, 3, 4)
  - [x] Add Role enum to schema
  - [x] Add User model with all fields
  - [x] Define relationship to Organization
  - [x] Add unique constraints
  - [x] Add indexes for common queries

- [x] Task 2: Add UserInvitation model (AC: 1)
  - [x] Add InvitationStatus enum
  - [x] Add UserInvitation model
  - [x] Define fields: email, role, token, reissueToken, status, expiresAt
  - [x] Add indexes

- [x] Task 3: Run migration (AC: 5)
  - [x] Generate migration with `prisma migrate dev`
  - [x] Verify migration applies cleanly
  - [x] Check tables created in database

- [x] Task 4: Create Users module in NestJS
  - [x] Create `src/users/users.module.ts`
  - [x] Create `src/users/users.service.ts`
  - [x] Create `src/users/users.controller.ts`
  - [x] Create DTOs for user operations

- [x] Task 5: Test database operations
  - [x] Test user creation
  - [x] Test user retrieval by auth0Id
  - [x] Test user retrieval by email
  - [x] Test organization relationship

## Dev Notes

### Prisma Schema Updates

```prisma
// prisma/schema.prisma

enum Role {
  SUPER_ADMIN
  ADMIN
  CLIENT
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
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
  @@index([auth0Id])
  @@map("users")
}

model UserInvitation {
  id             String           @id @default(uuid())
  email          String
  role           Role             @default(CLIENT)
  organizationId String
  token          String           @unique @default(uuid())
  reissueToken   String           @unique @default(uuid())
  reissueCount   Int              @default(0)
  status         InvitationStatus @default(PENDING)
  expiresAt      DateTime
  createdAt      DateTime         @default(now())
  invitedBy      String?          // User ID who sent invitation

  @@index([email])
  @@index([organizationId])
  @@index([token])
  @@index([status])
  @@map("user_invitations")
}
```

### Users Service

```typescript
// apps/api/src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id },
      include: { organization: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createFromAuth0(data: {
    auth0Id: string;
    email: string;
    name?: string;
    role: Role;
    organizationId: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        auth0Id: data.auth0Id,
        email: data.email,
        name: data.name,
        role: data.role,
        organizationId: data.organizationId,
      },
    });
  }

  async updateProfile(userId: string, data: { name?: string }): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  async findByOrganization(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

### User DTOs

```typescript
// apps/api/src/users/dto/user.dto.ts
import { z } from 'zod';
import { Role } from '@prisma/client';

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
```

### Role Hierarchy

| Role | Permissions |
|------|-------------|
| SUPER_ADMIN | All operations, all organizations |
| ADMIN | All operations within assigned organizations |
| CLIENT | Read/write own organization's data only |

### Architecture Compliance

- **ADR-006:** Application-Level Data Access - organizationId in every query
- **NFR15:** Role-based access control must be enforced at application level
- **NFR49:** System must maintain referential integrity across all database relationships

### Database Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| users | organizationId | Tenant filtering |
| users | auth0Id | JWT validation lookup |
| users | email | Unique constraint + lookup |
| user_invitations | email | Invitation lookup |
| user_invitations | token | Invitation acceptance |
| user_invitations | status | Status filtering |

### Testing Requirements

```typescript
describe('UsersService', () => {
  it('should create user from Auth0 data', async () => {
    const user = await usersService.createFromAuth0({
      auth0Id: 'auth0|123',
      email: 'test@example.com',
      role: Role.CLIENT,
      organizationId: testOrg.id,
    });
    expect(user.auth0Id).toBe('auth0|123');
  });

  it('should find user by auth0Id', async () => {
    const user = await usersService.findByAuth0Id('auth0|123');
    expect(user).toBeDefined();
  });

  it('should enforce unique email constraint', async () => {
    await expect(
      usersService.createFromAuth0({
        auth0Id: 'auth0|456',
        email: 'test@example.com', // duplicate
        role: Role.CLIENT,
        organizationId: testOrg.id,
      })
    ).rejects.toThrow();
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#10-Database-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.4]
- [Prisma Relations: https://www.prisma.io/docs/concepts/components/prisma-schema/relations]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to modify:
- `apps/api/prisma/schema.prisma` (add User, UserInvitation models)

Files to create:
- `apps/api/src/users/users.module.ts`
- `apps/api/src/users/users.service.ts`
- `apps/api/src/users/users.controller.ts`
- `apps/api/src/users/dto/user.dto.ts`
- `apps/api/src/users/dto/index.ts`
- `apps/api/test/users/users.service.spec.ts`
