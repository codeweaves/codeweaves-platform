# Story 12.5: Request Correlation IDs

Status: done

## Story

As a **developer**,
I want every request to have a correlation ID stored in AsyncLocalStorage,
So that I can trace requests across services, link audit logs, and debug issues end-to-end.

## Acceptance Criteria

1. **Given** a request is received **When** it has `X-Correlation-ID` header **Then** that value is used as the correlation ID
2. **Given** a request is received **When** it does NOT have `X-Correlation-ID` header **Then** a new UUID v4 is generated
3. **Given** a correlation ID exists **When** the response is sent **Then** `X-Correlation-ID` header is set on the response
4. **Given** the correlation ID is set **When** any code runs in the request context **Then** it can access correlationId, userId, auth0Id via AsyncLocalStorage
5. **Given** a request arrives **When** middleware processes it **Then** incoming request is logged: `→ GET /api/codeweaves/v1/organizations`
6. **Given** the middleware runs **When** userId is not yet available (set later by interceptor) **Then** correlationId is still available immediately

## Tasks / Subtasks

- [x] Task 1: Create AsyncLocalStorage singleton (AC: #4)
  - [x] Create `apps/api/src/common/tracer/correlation.storage.ts`
  - [x] Define `RequestContext` interface: `{ correlationId: string; userId?: string; auth0Id?: string; method?: string; url?: string }`
  - [x] Export `requestContextStorage` as `new AsyncLocalStorage<RequestContext>()`
  - [x] Export helper: `getRequestContext(): RequestContext | undefined`
- [x] Task 2: Create correlation ID middleware (AC: #1, #2, #3, #5)
  - [x] Create `apps/api/src/middleware/correlation-id.middleware.ts`
  - [x] Implement NestJS `NestMiddleware` interface
  - [x] Read `x-correlation-id` header or generate UUID v4
  - [x] Set `x-correlation-id` on response header
  - [x] Wrap `next()` inside `requestContextStorage.run()` with initial context
  - [x] Log incoming request: `→ ${method} ${url}`
- [x] Task 3: Register middleware in AppModule (AC: #1, #6)
  - [x] Modify `apps/api/src/modules/app.module.ts` to implement `NestModule`
  - [x] Apply `CorrelationIdMiddleware` for all routes via `consumer.apply().forRoutes('*')`
  - [x] Create `apps/api/src/common/tracer/tracer.module.ts` as `@Global()` module (empty for now, will house TracerService in Story 12.6)
  - [x] Import TracerModule into AppModule
- [x] Task 4: Write unit tests (AC: #1, #2, #3)
  - [x] Create `apps/api/test/middleware/correlation-id.middleware.spec.ts`
  - [x] Test: uses existing `X-Correlation-ID` header when present
  - [x] Test: generates new UUID when header missing
  - [x] Test: sets `X-Correlation-ID` on response
  - [x] Test: stores context in AsyncLocalStorage
  - [x] Test: logs incoming request line

## Dev Notes

### AsyncLocalStorage Pattern

```typescript
// apps/api/src/common/tracer/correlation.storage.ts
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  userId?: string;      // Set later by LoggingInterceptor from request.user.id
  auth0Id?: string;     // Set later by LoggingInterceptor from request.user.auth0Id
  method?: string;
  url?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
```

### Middleware Pattern

```typescript
// apps/api/src/middleware/correlation-id.middleware.ts
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContextStorage, RequestContext } from '../common/tracer/correlation.storage';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    res.setHeader('x-correlation-id', correlationId);

    const context: RequestContext = {
      correlationId,
      method: req.method,
      url: req.originalUrl,
    };

    this.logger.log(`→ ${req.method} ${req.originalUrl} [${correlationId.slice(0, 8)}]`);

    requestContextStorage.run(context, () => next());
  }
}
```

### AppModule Wiring

- `apps/api/src/modules/app.module.ts` currently does NOT implement `NestModule`
- Add `implements NestModule` and `configure(consumer: MiddlewareConsumer)` method
- Apply middleware for all routes: `consumer.apply(CorrelationIdMiddleware).forRoutes('*')`
- No existing middleware directory — create `apps/api/src/middleware/`
- No existing `common/` directory — create `apps/api/src/common/tracer/`

### Existing Codebase Patterns

- NestJS modules use constructor-based DI: `@Module({ imports: [], providers: [], exports: [] })`
- Guards exist at `apps/api/src/guards/` (JwtAuthGuard, RolesGuard, UserSyncGuard)
- Interceptors exist at `apps/api/src/interceptors/` (UserSyncInterceptor)
- `import { randomUUID } from 'crypto'` — use Node.js built-in, no external UUID library needed

### CRITICAL: Execution Order

NestJS request lifecycle: **Middleware → Guards → Interceptors → Pipes → Controllers**
- Middleware runs FIRST — correlationId is available to everything downstream
- Guards (JwtAuthGuard, UserSyncGuard) run AFTER — `request.user` is NOT available in middleware
- Interceptors run AFTER guards — this is where we enrich context with userId (Story 12.13)

### Project Structure Notes

- New directories to create: `apps/api/src/middleware/`, `apps/api/src/common/tracer/`
- Test file: `apps/api/test/middleware/correlation-id.middleware.spec.ts`
- Follows existing test pattern using `Test.createTestingModule()` from `@nestjs/testing`

### References

- [Source: docs/plans/logger-tracer-plan.md#Phase 2a, Phase 4a]
- [Source: _bmad-output/planning-artifacts/architecture.md#Section 17.2 - Logging Strategy]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.5]
- [Source: apps/api/src/modules/app.module.ts - module wiring pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- AsyncLocalStorage singleton with RequestContext interface created
- CorrelationIdMiddleware reads/generates correlation ID, sets response header, wraps next() in storage.run()
- TracerModule (empty @Global shell) created for Story 12.6
- AppModule updated: implements NestModule, applies CorrelationIdMiddleware for all routes, imports TracerModule
- 5 unit tests passing

### File List
- `apps/api/src/common/tracer/correlation.storage.ts` (CREATED)
- `apps/api/src/common/tracer/tracer.module.ts` (CREATED)
- `apps/api/src/middleware/correlation-id.middleware.ts` (CREATED)
- `apps/api/src/modules/app.module.ts` (MODIFIED)
- `apps/api/test/middleware/correlation-id.middleware.spec.ts` (CREATED)
