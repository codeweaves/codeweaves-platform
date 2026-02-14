# Story 1.8: Implement User Profile API

Status: review

## Story

As a **user**,
I want to view and update my profile,
So that I can manage my account information.

## Acceptance Criteria

1. **Given** I am authenticated
   **When** I call GET `/api/users/me`
   **Then** my profile information is returned

2. **And** when I call PATCH `/api/users/me`
   **Then** my display name is updated

3. **And** email cannot be changed (managed by Auth0)

4. **And** role cannot be self-modified

## Tasks / Subtasks

- [x] Task 1: Implement GET /api/users/me endpoint (AC: 1)
  - [x] Return current user profile
  - [x] Include organization details
  - [x] Exclude sensitive fields (auth0Id, organizationId)

- [x] Task 2: Implement PATCH /api/users/me endpoint (AC: 2, 3, 4)
  - [x] Accept only name field for update
  - [x] Validate input with Zod schema
  - [x] Reject attempts to change email/role (Zod strips unknown fields)
  - [x] Return updated profile

- [x] Task 3: Create User DTOs
  - [x] UserProfileResponse DTO (shared via @repo/validation)
  - [x] UpdateUserProfileDto (shared via @repo/validation)
  - [x] Add Swagger decorators (@nestjs/swagger installed and configured)

- [x] Task 4: Add input validation
  - [x] Name must be 2-100 characters
  - [x] Strip HTML from name
  - [x] Use Zod validation pipe

- [x] Task 5: Test profile endpoints
  - [x] Test GET returns correct user
  - [x] Test PATCH updates name
  - [x] Test PATCH rejects email change (ZodValidationPipe strips email field)
  - [x] Test PATCH rejects role change (ZodValidationPipe strips role field)
  - [x] Test sensitive fields excluded from response
  - [x] Test HTML sanitization and whitespace trimming
  - [x] Test ZodValidationPipe (7 tests including AC3/AC4 specific tests)

## Dev Notes

> **Note:** Code snippets below are original story reference designs. Actual implementation differs in paths and patterns (Zod types via @repo/validation instead of class-based DTOs, `@Controller('auth/users')` instead of `@Controller('users')`). See File List for actual files.

### Users Controller

```typescript
// apps/api/src/users/users.controller.ts
import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { UpdateUserProfileDto, UserProfileResponse } from './dto/user.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { updateUserProfileSchema } from './dto/user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile', type: UserProfileResponse })
  async getProfile(@CurrentUser() user: CurrentUserData): Promise<UserProfileResponse> {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Updated profile', type: UserProfileResponse })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body(new ZodValidationPipe(updateUserProfileSchema)) dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    return this.usersService.updateProfile(user.id, dto);
  }
}
```

### Users Service Methods

```typescript
// apps/api/src/users/users.service.ts

async getProfile(userId: string): Promise<UserProfileResponse> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organization: user.organization,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async updateProfile(userId: string, dto: UpdateUserProfileDto): Promise<UserProfileResponse> {
  // Sanitize name (strip HTML)
  const sanitizedName = dto.name ? this.sanitizeName(dto.name) : undefined;

  const user = await this.prisma.user.update({
    where: { id: userId },
    data: {
      name: sanitizedName,
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organization: user.organization,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

private sanitizeName(name: string): string {
  // Remove HTML tags
  return name.replace(/<[^>]*>/g, '').trim();
}
```

### User DTOs

```typescript
// apps/api/src/users/dto/user.dto.ts
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

// Zod schemas for validation
export const updateUserProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
});

export type UpdateUserProfileDto = z.infer<typeof updateUserProfileSchema>;

// Response DTOs with Swagger decorators
export class OrganizationSummary {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class UserProfileResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional()
  name: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ type: OrganizationSummary })
  organization: OrganizationSummary;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

### Zod Validation Pipe

```typescript
// apps/api/src/common/pipes/zod-validation.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new BadRequestException({
        message: 'Validation failed',
        errors,
      });
    }

    return result.data;
  }
}
```

### API Response Examples

**GET /api/users/me**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "CLIENT",
  "organization": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp"
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:45:00.000Z"
}
```

**PATCH /api/users/me**
```json
// Request
{
  "name": "Jane Doe"
}

// Response
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "CLIENT",
  "organization": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp"
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T15:00:00.000Z"
}
```

### Error Responses

**Validation Error (400)**
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "name",
      "message": "String must contain at least 2 character(s)"
    }
  ]
}
```

### Architecture Compliance

- **FR6:** Users can update their display name
- **NFR22:** System must validate and sanitize all user input
- **NFR89:** Shared validation schemas must use Zod

### Security Considerations

1. **Email immutability:** Email is managed by Auth0, not editable via API
2. **Role immutability:** Users cannot self-promote; only Super Admin can change roles
3. **Input sanitization:** HTML stripped from name to prevent XSS
4. **Length limits:** Name limited to 100 characters

### Testing Requirements

```typescript
describe('UsersController', () => {
  describe('GET /api/users/me', () => {
    it('should return current user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: testUser.email,
        role: testUser.role,
        organization: {
          id: testOrg.id,
          name: testOrg.name,
        },
      });
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me')
        .expect(401);
    });
  });

  describe('PATCH /api/users/me', () => {
    it('should update user name', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
    });

    it('should reject name that is too short', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'A' })
        .expect(400);
    });

    it('should strip HTML from name', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: '<script>alert("xss")</script>John' })
        .expect(200);

      expect(response.body.name).toBe('John');
    });

    it('should ignore email field', async () => {
      const response = await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Test', email: 'hacker@evil.com' })
        .expect(200);

      expect(response.body.email).toBe(testUser.email); // Unchanged
    });
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.8]
- [NestJS Controllers: https://docs.nestjs.com/controllers]
- [Zod Validation: https://zod.dev]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Completion Notes List

- DTOs moved to shared `@repo/validation` package for frontend reuse (roleEnum, updateUserProfileSchema, userProfileResponseSchema, organizationSummarySchema)
- Added `@repo/validation` as workspace dependency to `apps/api/package.json`
- Swagger/OpenAPI fully configured: `@nestjs/swagger` installed, DocumentBuilder in `main.ts`, decorators on all controllers. Docs at `/api/docs`.
- Response excludes `auth0Id` and `organizationId` (sensitive/redundant since org is nested). Organization accessible via `response.organization.id`.
- ZodValidationPipe strips all unknown fields (email, role, etc.) ensuring AC3 and AC4 compliance.

### Change Log

- 2026-02-14: Initial implementation of profile endpoints, shared validation schemas, Zod pipe
- 2026-02-14: Code review fixes - extracted response helper, added AC3/AC4 specific tests, auth0Id exclusion test
- 2026-02-14: Added Swagger/OpenAPI - installed @nestjs/swagger, configured DocumentBuilder, added decorators to all controllers
- 2026-02-14: Code review #2 fixes - production Swagger guard, P2025 error handling, improved HTML sanitization regex, updated File List

### File List

Files created:
- `apps/api/src/pipes/zod-validation.pipe.ts` (reusable Zod validation pipe)
- `apps/api/test/pipes/zod-validation.pipe.spec.ts` (10 tests including AC3/AC4)

Files modified:
- `apps/api/src/main.ts` (Swagger/OpenAPI config with production guard)
- `apps/api/src/controllers/auth/users.controller.ts` (GET/PATCH profile endpoints with Swagger + ZodValidationPipe)
- `apps/api/src/controllers/invitations/invitations.controller.ts` (Swagger decorators)
- `apps/api/src/controllers/public/health.controller.ts` (Swagger decorators)
- `apps/api/src/services/users.service.ts` (getProfile, updateProfile with P2025 handling, sanitization, toProfileResponse helper)
- `apps/api/src/models/user.dto.ts` (re-exports from @repo/validation)
- `apps/api/test/controllers/auth/users.controller.spec.ts` (updated for new getProfile/updateProfile)
- `apps/api/test/services/users/users.service.spec.ts` (added getProfile, sanitization, auth0Id exclusion tests)
- `packages/validation/src/index.ts` (added roleEnum, user profile schemas)
- `apps/api/package.json` (added @repo/validation, @nestjs/swagger dependencies)
