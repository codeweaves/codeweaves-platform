# Story 1.5: Create User Sync on First Login

Status: ready-for-dev

## Story

As a **system**,
I want user records created automatically on first login,
So that Auth0 users are synced to our database.

## Acceptance Criteria

1. **Given** a user logs in via Auth0 for the first time
   **When** their JWT is verified
   **Then** User record is created if not exists

2. **And** Auth0 user ID is stored for future lookups

3. **And** Default role is assigned based on invitation

4. **And** Organization association is set from invitation

5. **And** Subsequent logins find existing user

## Tasks / Subtasks

- [ ] Task 1: Create user sync interceptor (AC: 1, 2, 5)
  - [ ] Create `src/auth/interceptors/user-sync.interceptor.ts`
  - [ ] Check if user exists by auth0Id after JWT validation
  - [ ] Create user if not exists
  - [ ] Attach full user object to request

- [ ] Task 2: Handle first-time users with invitation (AC: 3, 4)
  - [ ] Look up pending invitation by email
  - [ ] Use invitation's role and organizationId
  - [ ] Mark invitation as accepted
  - [ ] Handle case where no invitation exists (error)

- [ ] Task 3: Handle existing users (AC: 5)
  - [ ] Find user by auth0Id
  - [ ] Attach user to request without DB write
  - [ ] Update lastLoginAt if tracking

- [ ] Task 4: Update CurrentUser decorator
  - [ ] Include full user object with internal ID
  - [ ] Include organization details
  - [ ] Type properly for controller usage

- [ ] Task 5: Test user sync flow
  - [ ] Test first login creates user
  - [ ] Test first login without invitation fails
  - [ ] Test subsequent login finds existing user
  - [ ] Test invitation is marked accepted

## Dev Notes

### User Sync Interceptor

```typescript
// apps/api/src/auth/interceptors/user-sync.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationStatus } from '@prisma/client';

@Injectable()
export class UserSyncInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    // Skip if no user (public route)
    if (!jwtUser) {
      return next.handle();
    }

    // Try to find existing user
    let user = await this.prisma.user.findUnique({
      where: { auth0Id: jwtUser.auth0Id },
      include: { organization: true },
    });

    if (!user) {
      // First login - need to create user from invitation
      user = await this.createUserFromInvitation(jwtUser);
    }

    // Attach full user to request
    request.user = {
      ...jwtUser,
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
    };

    return next.handle();
  }

  private async createUserFromInvitation(jwtUser: { auth0Id: string; email: string }) {
    // Find pending invitation
    const invitation = await this.prisma.userInvitation.findFirst({
      where: {
        email: jwtUser.email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      throw new UnauthorizedException(
        'No valid invitation found. Please contact your administrator.'
      );
    }

    // Create user and mark invitation as accepted in transaction
    const user = await this.prisma.$transaction(async (tx) => {
      // Create user
      const newUser = await tx.user.create({
        data: {
          auth0Id: jwtUser.auth0Id,
          email: jwtUser.email,
          role: invitation.role,
          organizationId: invitation.organizationId,
        },
        include: { organization: true },
      });

      // Mark invitation as accepted
      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });

      return newUser;
    });

    return user;
  }
}
```

### Register Interceptor Globally

```typescript
// apps/api/src/app.module.ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UserSyncInterceptor } from './auth/interceptors/user-sync.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: UserSyncInterceptor,
    },
  ],
})
export class AppModule {}
```

### Updated CurrentUser Type

```typescript
// apps/api/src/auth/decorators/current-user.decorator.ts
export interface CurrentUserData {
  // From JWT
  auth0Id: string;
  email: string;

  // From database (after sync)
  id: string;              // Internal user ID
  role: Role;
  organizationId: string;
  organization: {
    id: string;
    name: string;
  };
}
```

### Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Request   │────▶│  JwtAuthGuard │────▶│ UserSyncInterceptor│
│ with JWT    │     │  (validates)  │     │  (syncs user)   │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                           ┌───────────────────────┴───────────────────────┐
                           │                                               │
                           ▼                                               ▼
                    ┌─────────────┐                               ┌─────────────┐
                    │ User Exists │                               │ First Login │
                    │  by auth0Id │                               │ (no user)   │
                    └──────┬──────┘                               └──────┬──────┘
                           │                                             │
                           │                                             ▼
                           │                                    ┌─────────────────┐
                           │                                    │ Find Invitation │
                           │                                    │   by email      │
                           │                                    └────────┬────────┘
                           │                                             │
                           │                              ┌──────────────┴──────────────┐
                           │                              │                             │
                           │                              ▼                             ▼
                           │                       ┌─────────────┐              ┌─────────────┐
                           │                       │ Invitation  │              │ No Invite   │
                           │                       │   Found     │              │  401 Error  │
                           │                       └──────┬──────┘              └─────────────┘
                           │                              │
                           │                              ▼
                           │                       ┌─────────────┐
                           │                       │ Create User │
                           │                       │ Mark Accepted│
                           │                       └──────┬──────┘
                           │                              │
                           ▼                              ▼
                    ┌─────────────────────────────────────────────┐
                    │        Attach User to Request               │
                    │  (id, role, organizationId, organization)   │
                    └─────────────────────────────────────────────┘
```

### Architecture Compliance

- **ADR-005:** Auth0 for Authentication - User sync after JWT validation
- **NFR15:** Role-based access control - Role from invitation
- **FR5:** Invited users system

### Error Handling

| Scenario | Response |
|----------|----------|
| No invitation found | 401 "No valid invitation found" |
| Expired invitation | 401 "Invitation has expired" |
| Already accepted | Normal login (user exists) |

### Testing Requirements

```typescript
describe('UserSyncInterceptor', () => {
  it('should create user on first login with valid invitation', async () => {
    // Setup: Create invitation
    const invitation = await createInvitation({
      email: 'new@example.com',
      role: Role.CLIENT,
      organizationId: testOrg.id,
    });

    // Act: Make authenticated request
    const response = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${tokenForEmail('new@example.com')}`);

    // Assert: User created
    expect(response.status).toBe(200);
    expect(response.body.email).toBe('new@example.com');
    expect(response.body.role).toBe('CLIENT');
  });

  it('should reject first login without invitation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${tokenForEmail('unknown@example.com')}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('No valid invitation');
  });

  it('should find existing user on subsequent login', async () => {
    // User already exists from previous test
    const response = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${tokenForEmail('existing@example.com')}`);

    expect(response.status).toBe(200);
    // No new user created
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#12-Authentication-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.5]
- [NestJS Interceptors: https://docs.nestjs.com/interceptors]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/api/src/auth/interceptors/user-sync.interceptor.ts`
- `apps/api/test/auth/user-sync.interceptor.spec.ts`

Files to modify:
- `apps/api/src/app.module.ts` (register interceptor)
- `apps/api/src/auth/decorators/current-user.decorator.ts` (update types)
- `apps/api/src/auth/auth.module.ts` (export interceptor)
