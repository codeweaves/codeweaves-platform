# Story 4.2: Create Theme API Endpoints

Status: done

## Story

As an **agent owner**,
I want API endpoints for theme management,
so that I can save, retrieve, and reset theme configurations for my agents.

## Acceptance Criteria

1. **AC1:** `GET /agents/:id/theme` returns the current theme config with version, or default theme if none saved
2. **AC2:** `PUT /agents/:id/theme` saves the entire theme config, increments version, returns updated theme
3. **AC3:** `PATCH /agents/:id/theme` merges partial theme updates into existing config, increments version
4. **AC4:** `POST /agents/:id/theme/reset` resets theme to defaults, increments version
5. **AC5:** Version is incremented on every PUT, PATCH, or reset operation (cache busting)
6. **AC6:** ETag header is set on GET response using the version number
7. **AC7:** Only ADMIN, SUPER_ADMIN, and CLIENT (own org) can access theme endpoints — same scoping as agent access
8. **AC8:** Theme config is validated against `widgetThemeSchema` on PUT, partial validation on PATCH
9. **AC9:** If agent has no theme record, GET returns default theme with version 0
10. **AC10:** Unit tests for service and controller are written and passing

## Tasks / Subtasks

- [x] **Task 1: Theme Service** (AC: 1-6, 9)
  - [x] 1.1 Create `apps/api/src/services/agent-themes.service.ts`
  - [x] 1.2 Inject `PrismaService`, `AgentLoggerService`
  - [x] 1.3 Implement `getTheme(agentId, user)` — return existing theme or default
  - [x] 1.4 Implement `updateTheme(agentId, config, user)` — full replace, increment version
  - [x] 1.5 Implement `patchTheme(agentId, partialConfig, user)` — deep merge with existing, increment version
  - [x] 1.6 Implement `resetTheme(agentId, user)` — set config to default, increment version
  - [x] 1.7 Add helper `ensureAgentAccess(agentId, user)` — reuse agent service's access checks
  - [x] 1.8 Use upsert for create-or-update pattern (agent may not have theme yet)

- [x] **Task 2: Theme Controller** (AC: 1-4, 6, 7, 8)
  - [x] 2.1 Create `apps/api/src/controllers/agents/agent-themes.controller.ts`
  - [x] 2.2 `GET /agents/:id/theme` — returns config + version, sets ETag header
  - [x] 2.3 `PUT /agents/:id/theme` — validates full config with `widgetThemeSchema`, returns updated
  - [x] 2.4 `PATCH /agents/:id/theme` — validates partial config with `widgetThemeSchema.deepPartial()`, returns updated
  - [x] 2.5 `POST /agents/:id/theme/reset` — returns default theme
  - [x] 2.6 Apply `@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)` to all endpoints
  - [x] 2.7 Full Swagger documentation on all endpoints

- [x] **Task 3: Validation Schemas** (AC: 8)
  - [x] 3.1 Add `updateThemeSchema` (full widgetThemeSchema) to `packages/validation/src/theme.ts`
  - [x] 3.2 Add `patchThemeSchema` (deepPartial of widgetThemeSchema) to `packages/validation/src/theme.ts`
  - [x] 3.3 Re-export from `packages/validation/src/index.ts`

- [x] **Task 4: Module Registration** (AC: all)
  - [x] 4.1 Create `apps/api/src/modules/agent-themes.module.ts` or register in `AgentsModule`
  - [x] 4.2 Register controller and service
  - [x] 4.3 Import in `AppModule` if separate module

- [x] **Task 5: Unit Tests** (AC: 10)
  - [x] 5.1 Create `apps/api/test/services/agent-themes/agent-themes.service.spec.ts`
  - [x] 5.2 Create `apps/api/test/controllers/agents/agent-themes.controller.spec.ts`
  - [x] 5.3 Test: GET returns default theme when no record exists
  - [x] 5.4 Test: PUT creates theme record if none exists (upsert)
  - [x] 5.5 Test: PUT replaces full config and increments version
  - [x] 5.6 Test: PATCH merges partial config into existing
  - [x] 5.7 Test: Reset sets config to defaults and increments version
  - [x] 5.8 Test: CLIENT can only access own org's agent theme
  - [x] 5.9 Test: Invalid config rejected by validation
  - [x] 5.10 Run `bun run test` and confirm all pass

## Dev Notes

### API Endpoint Patterns

Follow `AgentsController` patterns for auth, validation, and response formatting:

```typescript
@Controller('agents/:id/theme')
@ApiTags('Agent Themes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserSyncGuard, RolesGuard)
export class AgentThemesController {

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Get agent theme configuration' })
  async getTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const theme = await this.themesService.getTheme(agentId, user);
    res.setHeader('ETag', `"${theme.version}"`);
    return theme;
  }
}
```

### Deep Merge Strategy for PATCH

Use a recursive merge — nested objects are merged, arrays are replaced:

```typescript
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

### Upsert Pattern

```typescript
await this.prisma.agentTheme.upsert({
  where: { agentId },
  create: { agentId, config, version: 1 },
  update: { config, version: { increment: 1 } },
});
```

### Project Structure Notes

- Controller nested under `/agents/:id/theme` — same path structure as agent secrets
- Service can reuse `AgentsService.findByIdRaw()` for agent access validation
- Consider registering theme controller in the existing `AgentsModule` to share service dependencies
- ETag uses version number for simple cache validation

### References

- [Source: `_bmad-output/planning-artifacts/architecture.md`] — Theme API endpoints (section 10.2), cache config
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1465-1480] — Story 4.2 acceptance criteria
- [Source: `apps/api/src/controllers/agents/agents.controller.ts`] — controller patterns
- [Source: `apps/api/src/services/agents.service.ts`] — service patterns, access control
- [Source: `apps/api/src/controllers/agents/agent-secrets.controller.ts`] — nested route pattern

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Fixed Prisma type casting: `Record<string, unknown>` → `Prisma.InputJsonValue` for JSON column compatibility
- Removed unused `Logger` field flagged by IDE diagnostics
- Prisma client regeneration required after Story 4-1 migration (AgentTheme model)

### Completion Notes List
- Task 1: Created `AgentThemesService` with `getTheme`, `updateTheme`, `patchTheme`, `resetTheme` methods. Uses `ensureAgentAccess` for tenant-scoped access control (CLIENT users restricted to own org). All mutations use upsert pattern with version increment.
- Task 2: Created `AgentThemesController` at route `agents/:id/theme` with GET (ETag header), PUT (full validation), PATCH (partial validation via `partialWidgetThemeSchema`), POST /reset. All endpoints have `@Roles(ADMIN, SUPER_ADMIN, CLIENT)` and full Swagger docs.
- Task 3: Already satisfied — `widgetThemeSchema`, `partialWidgetThemeSchema`, `defaultWidgetTheme` pre-existed in `packages/validation/src/theme.ts`, re-exported via `index.ts` and `agent-theme.dto.ts`.
- Task 4: Registered `AgentThemesService` and `AgentThemesController` in existing `AgentsModule` — no separate module or `AppModule` changes needed.
- Task 5: 27 unit tests across 2 spec files. Service: 18 tests covering all CRUD operations, default theme fallback, deep merge, version increment, tenant scoping, SUPER_ADMIN access, validation rejection. Controller: 9 tests covering delegation, ETag header, error propagation. All 655 project tests pass with zero regressions.
- Added `logThemeUpdated` and `logThemeReset` audit log methods to `AgentLoggerService`.

### Code Review Fixes Applied
- **[HIGH] Race condition in patchTheme**: Wrapped read-then-write in `prisma.$transaction()` for atomicity
- **[MEDIUM] Prototype pollution in deepMerge**: Added `UNSAFE_KEYS` set (`__proto__`, `constructor`, `prototype`) guard
- **[MEDIUM] Missing SUPER_ADMIN scoping test**: Added test verifying SUPER_ADMIN is not org-scoped
- **[MEDIUM] Missing validation rejection test (Task 5.9)**: Added test using `ZodValidationPipe` to reject invalid config
- **[MEDIUM] Unsafe Prisma.InputJsonValue casting**: Replaced double-cast with `toJsonValue()` helper using `JSON.parse(JSON.stringify())`
- **[LOW] Missing 403 Swagger docs**: Added `@ApiResponse({ status: 403 })` to all 4 endpoints

### File List
- `apps/api/src/services/agent-themes.service.ts` (new)
- `apps/api/src/controllers/agents/agent-themes.controller.ts` (new)
- `apps/api/src/modules/agents.module.ts` (modified)
- `apps/api/src/common/logger/agent.logger.ts` (modified)
- `apps/api/test/services/agents/agent-themes.service.spec.ts` (new)
- `apps/api/test/controllers/agents/agent-themes.controller.spec.ts` (new)
