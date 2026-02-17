# Story 12.13: Request/Response Logging

Status: done

## Story

As a **developer**,
I want request/response logging via a NestJS interceptor and a global exception filter,
So that I can troubleshoot API issues with duration metrics, user context, and structured error responses.

## Acceptance Criteria

1. **Given** an API request completes **When** the logging interceptor runs **Then** it logs: `← GET /api/codeweaves/v1/organizations 200 45ms`
2. **Given** a user is authenticated **When** the interceptor runs **Then** it enriches the AsyncLocalStorage context with `userId` from `request.user.id` and `auth0Id` from `request.user.auth0Id`
3. **Given** an unauthenticated route **When** the interceptor runs **Then** userId and auth0Id remain `undefined` — no error is thrown
4. **Given** an unhandled exception occurs **When** the global exception filter catches it **Then** it returns `{ statusCode, message, correlationId, timestamp }` in the response body
5. **Given** a 5xx server error **When** the exception filter processes it **Then** the full stack trace is logged to NestJS Logger (but NOT returned to the client)
6. **Given** a known HttpException **When** the exception filter processes it **Then** the original status code and message are preserved
7. **Given** logging configuration **When** in production **Then** request body logging is disabled; in development, sanitized request body may be logged

## Tasks / Subtasks

- [x] Task 1: Create LoggingInterceptor (AC: #1, #2, #3)
  - [x] Create `apps/api/src/interceptors/logging.interceptor.ts`
  - [x] Implement `NestInterceptor` interface
  - [x] Record start time with `Date.now()`
  - [x] Read `request.user?.id` and `request.user?.auth0Id` — enrich AsyncLocalStorage context (mutate the existing store)
  - [x] On response: log `← ${method} ${url} ${statusCode} ${duration}ms`
  - [x] On error: log with error message and duration
- [x] Task 2: Create AllExceptionsFilter (AC: #4, #5, #6)
  - [x] Create `apps/api/src/filters/all-exceptions.filter.ts`
  - [x] Implement `ExceptionFilter` with `@Catch()` decorator
  - [x] Read correlationId from `getRequestContext()`
  - [x] For HttpException: extract status and message
  - [x] For unknown errors: return 500 with generic message
  - [x] Log stack trace for 5xx errors only
  - [x] Return body: `{ statusCode, message, correlationId, timestamp }`
- [x] Task 3: Register in AppModule (AC: #1, #4)
  - [x] In `apps/api/src/modules/app.module.ts`, register `LoggingInterceptor` as `APP_INTERCEPTOR`
  - [x] Register `AllExceptionsFilter` as `APP_FILTER`
  - [x] Both use `{ provide: APP_INTERCEPTOR/APP_FILTER, useClass: ... }` pattern in providers array
- [x] Task 4: Update main.ts (AC: #7)
  - [x] In `apps/api/src/main.ts`, add `bufferLogs: true` to `NestFactory.create()`
  - [x] Replace any `console.log` startup messages with NestJS `Logger`
- [x] Task 5: Write unit tests (AC: #1, #2, #4, #5, #6)
  - [x] Create `apps/api/test/interceptors/logging.interceptor.spec.ts`
  - [x] Test: logs response with status code and duration
  - [x] Test: enriches AsyncLocalStorage with userId when user exists
  - [x] Test: does not error when request.user is undefined
  - [x] Create `apps/api/test/filters/all-exceptions.filter.spec.ts`
  - [x] Test: returns correlationId in error response body
  - [x] Test: HttpException preserves original status/message
  - [x] Test: unknown error returns 500 with generic message
  - [x] Test: 5xx errors log stack trace

## Dev Notes

### LoggingInterceptor Pattern

```typescript
// apps/api/src/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, user } = request;
    const now = Date.now();

    // Enrich AsyncLocalStorage with user context (Guards have already run)
    const store = getRequestContext();
    if (store && user) {
      store.userId = user.id;
      store.auth0Id = user.auth0Id;
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          this.logger.log(`← ${method} ${originalUrl} ${res.statusCode} ${Date.now() - now}ms`);
        },
        error: (err) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          this.logger.error(`← ${method} ${originalUrl} ${status} ${Date.now() - now}ms — ${err.message}`);
        },
      }),
    );
  }
}
```

### AllExceptionsFilter Pattern

```typescript
// apps/api/src/filters/all-exceptions.filter.ts
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const context = getRequestContext();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof HttpException
      ? exception.message
      : 'Internal server error';

    if (status >= 500) {
      this.logger.error(`[${context?.correlationId?.slice(0, 8)}] ${request.method} ${request.originalUrl} — ${exception}`,
        exception instanceof Error ? exception.stack : undefined);
    }

    response.status(status).json({
      statusCode: status,
      message,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
```

### AppModule Registration

```typescript
// In providers array of AppModule
{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
{ provide: APP_FILTER, useClass: AllExceptionsFilter },
```

Import from: `import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';`

### CRITICAL: AsyncLocalStorage Mutation

The LoggingInterceptor MUTATES the existing AsyncLocalStorage store (set by middleware) to add userId/auth0Id. This works because interceptors run inside the same async context started by the middleware's `requestContextStorage.run()`. Do NOT create a new `run()` — just modify the existing store object.

### CRITICAL: Interceptor runs AFTER Guards

NestJS lifecycle: Middleware → Guards → **Interceptors** → Pipes → Controllers
- By the time LoggingInterceptor runs, `UserSyncGuard` has already set `request.user.id` (internal DB UUID)
- For unauthenticated routes (like health check), `request.user` is undefined — handle gracefully

### Existing Codebase

- `apps/api/src/interceptors/` already exists with `user-sync.interceptor.ts` — add new file alongside
- `apps/api/src/filters/` does NOT exist — create directory
- `apps/api/src/main.ts` currently uses `await NestFactory.create(AppModule)` — add `{ bufferLogs: true }` option
- AppModule at `apps/api/src/modules/app.module.ts` — add providers for APP_INTERCEPTOR and APP_FILTER

### Dependencies

- **Depends on Story 12.5**: `getRequestContext()` and `requestContextStorage` must exist
- **Depends on Story 11.6**: AuditLog model (indirectly, for error filter logging)

### References

- [Source: docs/plans/logger-tracer-plan.md#Phase 4b, Phase 4c, Phase 5]
- [Source: _bmad-output/planning-artifacts/architecture.md#Section 17.2 - LoggingInterceptor reference code]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.13]
- [Source: apps/api/src/interceptors/user-sync.interceptor.ts - existing interceptor pattern]
- [Source: apps/api/src/modules/app.module.ts - module registration pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- LoggingInterceptor: enriches AsyncLocalStorage with userId/auth0Id, logs response with status + duration
- AllExceptionsFilter: returns correlationId in error body, logs 5xx stack traces, generic message for unknown errors
- AppModule: registered APP_INTERCEPTOR + APP_FILTER
- main.ts: bufferLogs: true, console.log → NestJS Logger
- 9 unit tests passing (4 interceptor + 5 filter)

### File List
- `apps/api/src/interceptors/logging.interceptor.ts` (CREATED)
- `apps/api/src/filters/all-exceptions.filter.ts` (CREATED)
- `apps/api/src/modules/app.module.ts` (MODIFIED)
- `apps/api/src/main.ts` (MODIFIED)
- `apps/api/test/interceptors/logging.interceptor.spec.ts` (CREATED)
- `apps/api/test/filters/all-exceptions.filter.spec.ts` (CREATED)
