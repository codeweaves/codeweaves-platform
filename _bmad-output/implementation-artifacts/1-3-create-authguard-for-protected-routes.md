# Story 1.3: Create AuthGuard for Protected Routes

Status: done

## Story

As a **backend developer**,
I want an authentication guard for protected endpoints,
So that unauthenticated requests are blocked.

## Acceptance Criteria

1. **Given** JWT strategy is implemented
   **When** creating the AuthGuard
   **Then** `@UseGuards(AuthGuard)` decorator protects endpoints

2. **And** Guard extracts user info from validated token

3. **And** User context is available in request object

4. **And** Public endpoints can bypass guard with `@Public()` decorator

5. **And** Guard integrates with NestJS dependency injection

## Tasks / Subtasks

- [ ] Task 1: Create JwtAuthGuard (AC: 1, 5)
  - [ ] Create `src/auth/guards/jwt-auth.guard.ts`
  - [ ] Extend AuthGuard('jwt') from Passport
  - [ ] Handle authentication errors gracefully

- [ ] Task 2: Create Public decorator (AC: 4)
  - [ ] Create `src/auth/decorators/public.decorator.ts`
  - [ ] Use SetMetadata to mark public routes
  - [ ] Update guard to check for public metadata

- [ ] Task 3: Create CurrentUser decorator (AC: 2, 3)
  - [ ] Create `src/auth/decorators/current-user.decorator.ts`
  - [ ] Extract user from request object
  - [ ] Make user info easily accessible in controllers

- [ ] Task 4: Configure global guard (AC: 1)
  - [ ] Register JwtAuthGuard as global guard in AppModule
  - [ ] All routes protected by default
  - [ ] Public routes opt-out with decorator

- [ ] Task 5: Test guard functionality
  - [ ] Test protected route without token returns 401
  - [ ] Test protected route with valid token returns 200
  - [ ] Test @Public() decorated route works without token
  - [ ] Test @CurrentUser() extracts correct user info

## Dev Notes

### JwtAuthGuard Implementation

```typescript
// apps/api/src/auth/guards/jwt-auth.guard.ts
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
```

### Public Decorator

```typescript
// apps/api/src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### CurrentUser Decorator

```typescript
// apps/api/src/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  auth0Id: string;
  email: string;
  roles: string[];
  organizationId?: string;
  userId?: string;  // Our internal user ID (populated after sync)
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext): CurrentUserData | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserData;

    return data ? user?.[data] : user;
  },
);
```

### Global Guard Registration

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
```

### Usage Example

```typescript
// Example controller usage
@Controller('agents')
export class AgentsController {
  @Get()
  findAll(@CurrentUser() user: CurrentUserData) {
    // user is automatically extracted from JWT
    return this.agentsService.findAll(user.organizationId);
  }

  @Public()
  @Get('health')
  health() {
    // This endpoint is accessible without authentication
    return { status: 'ok' };
  }
}
```

### Public Routes (Default)

These routes should be marked as `@Public()`:
- `GET /health` - Health check
- `GET /health/ready` - Readiness check
- `POST /widget/:agentId/config` - Widget configuration (uses agentId auth)
- `POST /widget/:agentId/message` - Widget messages (uses agentId auth)

### Architecture Compliance

- **ADR-005:** Auth0 for Authentication - JWT verification in NestJS
- **NFR13:** API requests must be authenticated with JWT tokens
- **NFR15:** Role-based access control must be enforced at application level

### Testing Requirements

```typescript
// Test: Protected route returns 401 without token
describe('JwtAuthGuard', () => {
  it('should return 401 for protected route without token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/agents')
      .expect(401);
  });

  it('should return 200 for protected route with valid token', async () => {
    const token = generateTestToken({ sub: 'auth0|user1' });
    const response = await request(app.getHttpServer())
      .get('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('should allow access to @Public() route without token', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#12-Authentication-Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3]
- [NestJS Guards: https://docs.nestjs.com/guards]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/api/src/auth/guards/jwt-auth.guard.ts`
- `apps/api/src/auth/decorators/public.decorator.ts`
- `apps/api/src/auth/decorators/current-user.decorator.ts`
- `apps/api/src/auth/decorators/index.ts`
- `apps/api/test/auth/jwt-auth.guard.spec.ts`

Files to modify:
- `apps/api/src/auth/auth.module.ts` (export guards, decorators)
- `apps/api/src/app.module.ts` (register global guard)
