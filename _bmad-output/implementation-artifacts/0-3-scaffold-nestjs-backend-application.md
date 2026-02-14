# Story 0.3: Scaffold NestJS Backend Application

Status: done

## Story

As a **developer**,
I want a NestJS v11+ backend application in `apps/api`,
So that I can build the REST API with proper structure.

## Acceptance Criteria

1. **Given** the monorepo structure exists
   **When** I create the backend application
   **Then** `apps/api` contains a NestJS application

2. **And** TypeScript strict mode is enabled

3. **And** Swagger/OpenAPI documentation is configured

4. **And** ESLint configuration extends shared config

5. **And** `pnpm dev --filter=api` starts the development server

## Tasks / Subtasks

- [ ] Task 1: Verify/Complete NestJS application structure (AC: 1)
  - [ ] Verify `apps/api` has proper NestJS structure
  - [ ] Ensure `src/main.ts` entry point exists
  - [ ] Ensure `src/app.module.ts` root module exists
  - [ ] Verify NestJS v11+ is installed

- [ ] Task 2: Configure TypeScript strict mode (AC: 2)
  - [ ] Verify `tsconfig.json` extends `@repo/typescript-config/nestjs.json`
  - [ ] Ensure `strict: true` is enabled
  - [ ] Verify `strictNullChecks`, `strictPropertyInitialization` are enabled

- [x] Task 3: Set up Swagger/OpenAPI (AC: 3)
  - [x] Install `@nestjs/swagger` package
  - [x] Configure Swagger in `main.ts`
  - [x] Set up API documentation at `/api/docs`
  - [x] Configure bearer auth in Swagger
  - [x] Add API tags for organization

- [ ] Task 4: Configure ESLint (AC: 4)
  - [ ] Ensure `eslint.config.js` extends `@repo/eslint-config/nest.js`
  - [ ] Verify linting passes with `pnpm lint --filter=api`

- [ ] Task 5: Verify dev server starts (AC: 5)
  - [ ] Run `pnpm dev --filter=api`
  - [ ] Verify server starts on port 3001
  - [ ] Verify Swagger docs accessible at http://localhost:3001/api/docs

## Dev Notes

### Current State Analysis

The `apps/api` directory already exists with basic NestJS scaffolding. This story ensures it meets all architecture requirements.

### Required NestJS Structure

Per architecture document section 5:

```
apps/api/
├── src/
│   ├── modules/           # Feature modules (auth, users, agents, etc.)
│   ├── common/            # Shared utilities
│   │   ├── filters/       # Exception filters
│   │   ├── interceptors/  # Logging, transform
│   │   ├── middleware/    # Tenant, rate-limit
│   │   ├── decorators/    # Custom decorators
│   │   └── pipes/         # Zod validation pipe
│   ├── config/            # Configuration
│   ├── prisma/            # Prisma module
│   ├── app.module.ts
│   └── main.ts
├── prisma/
│   └── schema.prisma
├── test/
├── nest-cli.json
├── tsconfig.json
└── package.json
```

### Swagger Configuration

```typescript
// apps/api/src/main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('CodeWeaves API')
  .setDescription('AI Chat Widget Platform API')
  .setVersion('1.0')
  .addBearerAuth()
  .addTag('auth', 'Authentication endpoints')
  .addTag('agents', 'Agent management')
  .addTag('themes', 'Theme customization')
  .addTag('chat', 'Chat messaging')
  .addTag('analytics', 'Analytics and metrics')
  .addTag('widget', 'Widget configuration')
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);
```

### Package Dependencies Required

```json
{
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/swagger": "^8.0.0",
    "@nestjs/config": "^4.0.0"
  }
}
```

### Architecture Compliance

- **ADR-002:** NestJS for Backend - Dependency injection, Swagger support, Prisma ORM
- **ADR-007:** Backend-Proxied AI Responses - All AI requests through NestJS

### Testing Requirements

- Server must start without errors
- Swagger UI must be accessible
- TypeScript compilation must pass with strict mode

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#5-Backend-Architecture-NestJS]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-0.3]
- [NestJS Documentation: https://docs.nestjs.com]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create/modify:
- `apps/api/src/main.ts` - Add Swagger configuration
- `apps/api/tsconfig.json` - Verify strict mode
- `apps/api/eslint.config.js` - Extend shared config
- `apps/api/nest-cli.json` - CLI configuration
