# Story 1.2: Implement JWT Verification Strategy in NestJS

Status: done

## Story

As a **backend developer**,
I want JWT tokens verified on every API request,
So that only authenticated users can access protected endpoints.

## Acceptance Criteria

1. **Given** Auth0 issues JWT tokens
   **When** implementing JWT verification
   **Then** `JwtStrategy` validates tokens against Auth0 JWKS

2. **And** Invalid tokens return 401 Unauthorized

3. **And** Expired tokens return 401 with clear message

4. **And** Malformed tokens are rejected

5. **And** Token audience and issuer are validated

6. **And** 9 test cases pass per Test Design specification

## Tasks / Subtasks

- [ ] Task 1: Install required packages (AC: 1)
  - [ ] Install `@nestjs/passport`
  - [ ] Install `passport`
  - [ ] Install `passport-jwt`
  - [ ] Install `jwks-rsa`
  - [ ] Install `@types/passport-jwt`

- [ ] Task 2: Create JWT Strategy (AC: 1, 5)
  - [ ] Create `src/auth/strategies/jwt.strategy.ts`
  - [ ] Configure JWKS client for Auth0
  - [ ] Validate issuer matches Auth0 domain
  - [ ] Validate audience matches API identifier
  - [ ] Extract user info from token payload

- [ ] Task 3: Create Auth Module (AC: 1)
  - [ ] Create `src/auth/auth.module.ts`
  - [ ] Register PassportModule
  - [ ] Register JwtStrategy as provider
  - [ ] Export AuthModule for use in AppModule

- [ ] Task 4: Handle error cases (AC: 2, 3, 4)
  - [ ] Create custom exception filter for auth errors
  - [ ] Return clear 401 messages for invalid tokens
  - [ ] Return clear 401 messages for expired tokens
  - [ ] Handle malformed token format

- [ ] Task 5: Write JWT verification tests (AC: 6)
  - [ ] Test: Valid token passes
  - [ ] Test: Expired token returns 401
  - [ ] Test: Malformed token returns 401
  - [ ] Test: Wrong issuer returns 401
  - [ ] Test: Wrong audience returns 401
  - [ ] Test: Tampered signature returns 401
  - [ ] Test: Missing token returns 401
  - [ ] Test: Invalid algorithm returns 401
  - [ ] Test: Token not yet valid returns 401

## Dev Notes

### JWT Strategy Implementation

```typescript
// apps/api/src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;           // Auth0 user ID
  email: string;
  'https://codeweaves.com/roles'?: string[];
  'https://codeweaves.com/organizationId'?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    const domain = configService.get<string>('AUTH0_DOMAIN');
    const audience = configService.get<string>('AUTH0_AUDIENCE');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: `https://${domain}/`,
      audience: audience,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${domain}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: JwtPayload) {
    return {
      auth0Id: payload.sub,
      email: payload.email,
      roles: payload['https://codeweaves.com/roles'] || [],
      organizationId: payload['https://codeweaves.com/organizationId'],
    };
  }
}
```

### Auth Module

```typescript
// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [JwtStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
```

### Test Cases (P0 Priority)

Per test-design-architecture.md, these 9 test cases are critical:

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Valid token | 200 OK, user extracted |
| 2 | Expired token | 401 "Token expired" |
| 3 | Malformed token | 401 "Invalid token" |
| 4 | Wrong issuer | 401 "Invalid issuer" |
| 5 | Wrong audience | 401 "Invalid audience" |
| 6 | Tampered signature | 401 "Invalid signature" |
| 7 | Missing token | 401 "No token provided" |
| 8 | Invalid algorithm (HS256) | 401 "Invalid algorithm" |
| 9 | Token not yet valid (nbf) | 401 "Token not yet valid" |

### Test Helper for JWT Generation

```typescript
// apps/api/test/utils/jwt.helper.ts
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export function generateTestToken(payload: Partial<JwtPayload>, options?: jwt.SignOptions) {
  return jwt.sign(
    {
      sub: 'auth0|test-user-id',
      email: 'test@example.com',
      iss: 'https://test-tenant.auth0.com/',
      aud: 'https://api.codeweaves.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    },
    privateKey,
    { algorithm: 'RS256', ...options }
  );
}

export function generateExpiredToken() {
  return generateTestToken({}, { expiresIn: '-1h' });
}

export function generateMalformedToken() {
  return 'not.a.valid.jwt.token';
}
```

### Architecture Compliance

- **ADR-005:** Auth0 for Authentication - JWT verification in NestJS
- **NFR13:** API requests must be authenticated with JWT tokens
- **NFR14:** JWT tokens must expire after 7 days with refresh token support
- **Test Priority:** P0 - JWT verification suite (9 test cases)

### Error Response Format

```json
{
  "statusCode": 401,
  "message": "Token expired",
  "error": "Unauthorized"
}
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#12-Authentication-Architecture]
- [Source: _bmad-output/planning-artifacts/test-design-architecture.md#JWT-Verification-Tests]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.2]
- [Passport JWT Strategy: https://docs.nestjs.com/security/authentication]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/strategies/jwt.strategy.ts`
- `apps/api/src/auth/interfaces/jwt-payload.interface.ts`
- `apps/api/test/auth/jwt.strategy.spec.ts`
- `apps/api/test/utils/jwt.helper.ts`

Files to modify:
- `apps/api/src/app.module.ts` (import AuthModule)
- `apps/api/package.json` (add dependencies)
